import type { Redis } from "@upstash/redis";

// These keys retain the existing production contract. Scripts run on one Redis
// database; migration to Redis Cluster requires co-locating the account keys.
export const PAID_KEY = (userId: string) => `gp:paid:${userId}`;
export const PRESENTATION_PAID_KEY = (userId: string) => `gp:presentation-paid:${userId}`;
export const ORDER_USED_KEY = (orderNo: string) => `gp:orderused:${orderNo}`;
export const VALID_ORDER_KEY = (orderNo: string) => `gp:validorder:${orderNo}`;

// Return 0=new, 1=idempotent, -1=invalid/cancelled/product changed,
// -2=historical/other owner's order, -3=another unused entitlement, -4=no Word.
export const CLAIM_ORDER_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {-1, ''} end
local valid = cjson.decode(raw)
local product = type(valid.productId) == 'string' and valid.productId or ''
if valid.status ~= 'valid' or product ~= ARGV[4] then return {-1, ''} end
local record = cjson.decode(ARGV[2])
local key = ARGV[3] == 'word' and KEYS[3] or KEYS[4]
local currentRaw = redis.call('GET', key)
local current = currentRaw and cjson.decode(currentRaw) or nil
local owner = redis.call('GET', KEYS[2])
local grantKey = ARGV[3] == 'word' and KEYS[5] or KEYS[6]
local presentationRaw = redis.call('GET', KEYS[4])
local presentation = presentationRaw and cjson.decode(presentationRaw) or nil
local crossLane = false
if owner then
  if owner ~= ARGV[1] then return {-2, ''} end
  if current and current.orderNo == record.orderNo then
    redis.call('SET', grantKey, '1')
    return {1, currentRaw}
  end
  crossLane = ARGV[3] == 'word' and ARGV[5] == '1'
    and not redis.call('GET', KEYS[5]) and redis.call('GET', KEYS[6])
    and presentation and presentation.orderNo == record.orderNo
  if not crossLane then return {-2, ''} end
end
if current and current.orderNo == record.orderNo then
  redis.call('SET', KEYS[2], ARGV[1])
  redis.call('SET', grantKey, '1')
  return {1, currentRaw}
end
if current and not current.usedProgramId then return {-3, ''} end
if ARGV[3] == 'word' and ARGV[5] == '1' and not crossLane
  and presentation and presentation.orderNo ~= record.orderNo
  and not presentation.usedProgramId then return {-3, ''} end
if ARGV[3] == 'presentation' and not redis.call('GET', KEYS[3]) then return {-4, ''} end
redis.call('SET', KEYS[2], ARGV[1])
if crossLane and presentation.usedProgramId then
  record.usedProgramId = presentation.usedProgramId
  record.usedAt = presentation.usedAt
end
local grantedRaw = cjson.encode(record)
redis.call('SET', key, grantedRaw)
redis.call('SET', grantKey, '1')
if ARGV[3] == 'word' and ARGV[5] == '1' then
  if not crossLane then
    record.source = 'bundle'
    redis.call('SET', KEYS[4], cjson.encode(record))
  end
  redis.call('SET', KEYS[6], '1')
end
return {0, grantedRaw}`;

export async function claimOrder(
  redis: Redis,
  args: {
    userId: string;
    record: { orderNo: string; email: string; verifiedAt: string; source?: string };
    mode: "word" | "presentation";
    productId?: string;
    bundle?: boolean;
  },
): Promise<{ status: number; record: string }> {
  const result = await redis.eval(CLAIM_ORDER_SCRIPT,
    [VALID_ORDER_KEY(args.record.orderNo), ORDER_USED_KEY(args.record.orderNo), PAID_KEY(args.userId), PRESENTATION_PAID_KEY(args.userId), `gp:ordergrant:${args.record.orderNo}:word`, `gp:ordergrant:${args.record.orderNo}:presentation`],
    [args.userId, JSON.stringify(args.record), args.mode, args.productId ?? "", args.bundle ? "1" : "0"]) as [number, unknown];
  return { status: Number(result[0]), record: typeof result[1] === "string" ? result[1] : JSON.stringify(result[1]) };
}

// Cancellation is terminal for automated completed-event retries and recovery.
export const REGISTER_ORDER_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw then return raw end
redis.call('SET', KEYS[1], ARGV[1])
return ARGV[1]`;
export async function registerOrder<T extends { orderNo: string }>(redis: Redis, record: T): Promise<T> {
  const result = await redis.eval(REGISTER_ORDER_SCRIPT, [VALID_ORDER_KEY(record.orderNo)], [JSON.stringify(record)]);
  return (typeof result === "string" ? JSON.parse(result) : result) as T;
}

export const CANCEL_ORDER_SCRIPT = `
local incoming = cjson.decode(ARGV[1])
local raw = redis.call('GET', KEYS[1])
if raw then
  local existing = cjson.decode(raw)
  incoming.registeredAt = existing.registeredAt
  incoming.via = existing.via
  if not incoming.productId then incoming.productId = existing.productId end
end
incoming.status = 'cancelled'
redis.call('SET', KEYS[1], cjson.encode(incoming))
local owner = redis.call('GET', KEYS[2])
local revoked = 0
if owner then
  for _, prefix in ipairs({'gp:paid:', 'gp:presentation-paid:'}) do
    local key = prefix .. owner
    local paid = redis.call('GET', key)
    if paid and cjson.decode(paid).orderNo == incoming.orderNo then
      redis.call('DEL', key)
      revoked = revoked + 1
    end
  end
end
return revoked`;
export async function cancelOrder(redis: Redis, record: { orderNo: string; registeredAt: string; via: string; status: string; productId?: string }): Promise<number> {
  return Number(await redis.eval(CANCEL_ORDER_SCRIPT, [VALID_ORDER_KEY(record.orderNo), ORDER_USED_KEY(record.orderNo)], [JSON.stringify(record)]));
}

// Bind/consent only the entitlement observed by the caller. A refund or a
// repurchase between the access check and this operation cannot be overwritten.
export const UPDATE_ENTITLEMENT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local paid = cjson.decode(raw)
if ARGV[1] ~= '' and paid.orderNo ~= ARGV[1] then return 0 end
if not paid.isQa then
  local validRaw = redis.call('GET', 'gp:validorder:' .. paid.orderNo)
  if not validRaw or cjson.decode(validRaw).status ~= 'valid' then return 0 end
end
if ARGV[2] == 'bind' then
  if paid.usedProgramId then return paid.usedProgramId == ARGV[3] and 1 or 0 end
  paid.usedProgramId = ARGV[3]
  paid.usedAt = ARGV[4]
else
  if paid.consentedAt then return 1 end
  paid.consentedAt = ARGV[4]
end
redis.call('SET', KEYS[1], cjson.encode(paid))
return 1`;
export async function updateEntitlement(redis: Redis, key: string, expectedOrderNo: string | undefined, kind: "bind" | "consent", programId = ""): Promise<boolean> {
  return (await redis.eval(UPDATE_ENTITLEMENT_SCRIPT, [key], [expectedOrderNo ?? "", kind, programId, new Date().toISOString()])) === 1;
}
