// Server only. Groble official schema: help/guides/webhook-events (2026-10-15).
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function classifyPurchase(payload: unknown, products: string[]) {
  const p = record(payload), obj = record(record(p.data).object);
  const content = record(obj.content), pricing = record(obj.pricing);
  const no = { ok: false as const, reason: 'ineligible' };
  if (p.type !== 'payment.completed' || p.version !== '2026-04-30' || typeof p.id !== 'string' || !p.id.startsWith('evt_') || p.id.startsWith('evt_test_')) return no;
  if (typeof obj.merchantUid !== 'string' || !/^\d{18,19}$/.test(obj.merchantUid)) return no;
  if (typeof content.id !== 'string' || !products.includes(content.id) || !['DOCUMENT', 'SERVICE'].includes(String(content.type))) return no;
  if (pricing.currency !== 'KRW' || typeof pricing.finalAmount !== 'number' || !Number.isSafeInteger(pricing.finalAmount) || pricing.finalAmount <= 0) return { ok: false as const, reason: 'unknown_pricing' };
  if (record(obj.paymentMethod).type !== 'CARD') return no;
  return { ok: true as const, orderNo: obj.merchantUid, productId: content.id, value: pricing.finalAmount, currency: 'KRW' as const,
    occurredAt: typeof p.occurredAt === 'string' ? Date.parse(p.occurredAt) : NaN,
    reference: typeof obj.sellerReference === 'string' ? obj.sellerReference : '' };
}
