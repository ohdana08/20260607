import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Redis } from '@upstash/redis';
export const CONTEXT_TTL = 86400;
export const CONTEXT_KEY = (ref: string) => `gp:analytics:checkout:${ref}`;
export interface CheckoutContext { client_id: string; session_id: string; createdAt: number; orderNo?: string }
export const CONTEXT_RATE_SCRIPT = `-- analytics-context-rate
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
return n`;
export async function createCheckoutContext(req: Request, user: { id: string; isAdmin: boolean } | null, redis: Pick<Redis, 'eval' | 'set'>) {
  const reply = (body: object, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (!user) return reply({ error: 'login_required' }, 401);
  const url = new URL(req.url);
  if (process.env.VERCEL_ENV !== 'production' || process.env.QA_MODE === 'true' || user.isAdmin || url.origin !== 'https://ddakfit.bccconsulting.kr' || req.headers.get('origin') !== url.origin) return reply({ error: 'excluded' }, 403);
  if (!req.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'invalid_context' }, 400);
  // Bound actual bytes, not just untrusted Content-Length. Never persist unknown input.
  const reader = req.body?.getReader(); let bytes = 0; let raw = '';
  if (!reader) return reply({ error: 'invalid_context' }, 400);
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 512) { await reader.cancel(); return reply({ error: 'too_large' }, 413); }
    raw += Buffer.from(value).toString('utf8');
  }
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply({ error: 'invalid_context' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['client_id', 'session_id'].includes(k)) || typeof body.client_id !== 'string' || !/^\d{1,20}\.\d{1,20}$/.test(body.client_id) || typeof body.session_id !== 'string' || !/^[1-9]\d{0,12}$/.test(body.session_id)) return reply({ error: 'invalid_context' }, 400);
  const rateKey = `gp:analytics:context-rate:${createHash('sha256').update(user.id).digest('hex')}`;
  if (Number(await redis.eval(CONTEXT_RATE_SCRIPT, [rateKey], [])) > 10) return reply({ error: 'rate_limited' }, 429);
  const reference = `ddak_${randomUUID()}`;
  await redis.set(CONTEXT_KEY(reference), { client_id: body.client_id, session_id: body.session_id, createdAt: Date.now() } satisfies CheckoutContext, { ex: CONTEXT_TTL });
  return reply({ reference, expires_in: CONTEXT_TTL }, 200);
}
