import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Redis } from '@upstash/redis';
import { GROBLE_PRODUCT_ID, GROBLE_PRESENTATION_PRODUCT_ID, GROBLE_BUNDLE_PRODUCT_ID } from '@/lib/config';
import { classifyPurchase } from './purchase';
import { CONTEXT_KEY } from './checkoutContext';

// Private registry: raw order key never leaves Redis. A random transaction ID is
// persisted atomically before POST and reused after uncertain HTTP delivery.
export const ACQUIRE_PURCHASE_SCRIPT = `-- analytics-acquire
local raw = redis.call('GET', KEYS[1])
local row = raw and cjson.decode(raw) or nil
if row and row.state == 'sent' then return cjson.encode({result='duplicate'}) end
local now = tonumber(ARGV[8])
if row and row.leaseUntil > now then return cjson.encode({result='busy'}) end
local validRaw = redis.call('GET', KEYS[2])
local valid = validRaw and cjson.decode(validRaw) or nil
if not valid or valid.status ~= 'valid' or valid.productId ~= ARGV[5] then return cjson.encode({result='invalid_order'}) end
if not row then
  local contextRaw = redis.call('GET', KEYS[3])
  local context = contextRaw and cjson.decode(contextRaw) or nil
  if not context or context.createdAt > now or now - context.createdAt > 86400000 or (context.orderNo and context.orderNo ~= ARGV[4]) then return cjson.encode({result='unattributed'}) end
  row = {transaction=ARGV[2], client_id=context.client_id, session_id=context.session_id, value=tonumber(ARGV[6]), timestamp=tonumber(ARGV[7]), productId=ARGV[5]}
  context.orderNo = ARGV[4]
  local ttl = redis.call('TTL', KEYS[3])
  if ttl <= 0 then return cjson.encode({result='unattributed'}) end
  redis.call('SET', KEYS[3], cjson.encode(context), 'EX', ttl)
end
row.state = 'pending'
row.lease = ARGV[1]
row.leaseUntil = now + 30000
redis.call('SET', KEYS[1], cjson.encode(row), 'EX', 7776000)
row.result = 'acquired'
return cjson.encode(row)`;
export const FINISH_PURCHASE_SCRIPT = `-- analytics-finish
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local row = cjson.decode(raw)
if row.lease ~= ARGV[1] then return 0 end
row.state = ARGV[2]
row.leaseUntil = 0
redis.call('SET', KEYS[1], cjson.encode(row), 'EX', 7776000)
return 1`;

export type PurchaseOutcome = { status: string; retry?: boolean };
interface PurchaseRow { result: string; transaction: string; client_id: string; session_id: string; value: number; timestamp: number; productId: string }
export async function reportPurchase(input: { payload: unknown; rawBody: Uint8Array; headers: Headers; redis: Pick<Redis, 'eval'> }, http: typeof fetch = fetch): Promise<PurchaseOutcome> {
  if (process.env.GA4_PURCHASE_MODE !== 'server_exclusive') return { status: 'disabled' };
  const { payload, rawBody, headers, redis } = input;
  if (process.env.VERCEL_ENV !== 'production' || process.env.QA_MODE === 'true') return { status: 'excluded' };
  if (!process.env.GA4_MP_API_SECRET || !process.env.GROBLE_WEBHOOK_SIGNING_SECRET) return { status: 'unconfigured' };
  const measurementId = process.env.NEXT_PUBLIC_GA_ID || 'G-5TN5XW0T2J';
  if (!/^G-[A-Z0-9]+$/.test(measurementId)) return { status: 'unconfigured' };
  const parsed = classifyPurchase(payload, [GROBLE_PRODUCT_ID, GROBLE_PRESENTATION_PRODUCT_ID, GROBLE_BUNDLE_PRODUCT_ID].filter(Boolean));
  if (!parsed.ok) return { status: parsed.reason };
  const timestamp = headers.get('x-groble-timestamp') ?? '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp) * 1000) > 300000) return { status: 'unverified' };
  const expected = createHmac('sha256', process.env.GROBLE_WEBHOOK_SIGNING_SECRET ?? '').update(timestamp + '.').update(rawBody).digest();
  const signatures = [headers.get('x-groble-signature'), headers.get('x-groble-signature-previous')];
  if (!headers.get('x-groble-signature') || !signatures.some(signature => signature && /^[a-f0-9]{64}$/i.test(signature) && timingSafeEqual(expected, Buffer.from(signature, 'hex')))) return { status: 'unverified' };
  if (!Number.isFinite(parsed.occurredAt) || parsed.occurredAt > Date.now() + 300000 || Date.now() - parsed.occurredAt > 72 * 3600000) return { status: 'expired' };
  if (!/^ddak_[a-f0-9-]{36}$/.test(parsed.reference)) return { status: 'unattributed' };
  const lease = randomUUID(), key = `gp:analytics:purchase:${parsed.orderNo}`;
  const acquired = await redis.eval(ACQUIRE_PURCHASE_SCRIPT, [key, `gp:validorder:${parsed.orderNo}`, CONTEXT_KEY(parsed.reference)], [lease, `ddak_tx_${randomUUID()}`, '', parsed.orderNo, parsed.productId, parsed.value, parsed.occurredAt, Date.now()]);
  const row: PurchaseRow = typeof acquired === 'string' ? JSON.parse(acquired) : acquired;
  if (row.result !== 'acquired') return { status: row.result, ...(row.result === 'busy' ? { retry: true } : {}) };
  const body = { client_id: row.client_id, timestamp_micros: row.timestamp * 1000,
    events: [{ name: 'purchase', params: { transaction_id: row.transaction, value: row.value, currency: 'KRW', session_id: row.session_id, engagement_time_msec: 1,
      site_id: 'ddakfit', app_id: 'ddakfit', items: [{ item_id: row.productId, item_name: 'ddakfit', quantity: 1, price: row.value }] } }] };
  try {
    const response = await http(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(process.env.GA4_MP_API_SECRET ?? '')}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (!response.ok) throw new Error('mp_rejected');
    const finished = await redis.eval(FINISH_PURCHASE_SCRIPT, [key], [lease, 'sent']);
    return finished === 1 ? { status: 'sent' } : { status: 'retry', retry: true };
  } catch {
    // Includes ambiguous delivery and post-send storage failure. Preserve the
    // transaction ID; GA's transaction dedupe is still required for this window.
    await redis.eval(FINISH_PURCHASE_SCRIPT, [key], [lease, 'pending']).catch(() => undefined);
    return { status: 'retry', retry: true };
  }
}
