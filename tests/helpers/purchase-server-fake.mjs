// In-memory synthetic Redis. No environment connection and no production I/O.
// Models atomic EVAL transactions, with expiration controlled by a test clock.
export function fakePurchaseRedis(now = () => Date.now()) {
  const data = new Map(), ttl = new Map();
  const get = k => { if (ttl.get(k) <= now()) { data.delete(k); ttl.delete(k); } return data.get(k) ?? null; };
  return { data, ttl, async get(k) { return get(k); }, async set(k, v, o = {}) { data.set(k, v); if (o.ex) ttl.set(k, now() + o.ex * 1000); return 'OK'; },
    async lpush() {}, async ltrim() {},
    async eval(script, keys, args) {
      if (script.includes('analytics-acquire')) {
        let row = get(keys[0]);
        if (row?.state === 'sent') return JSON.stringify({ result: 'duplicate' });
        if (row?.leaseUntil > now()) return JSON.stringify({ result: 'busy' });
        if (!row) {
          const valid = get(keys[1]), context = get(keys[2]);
          if (valid?.status !== 'valid' || valid.productId !== args[4]) return JSON.stringify({ result: 'invalid_order' });
          if (!context || !ttl.has(keys[2]) || context.createdAt > now() || now() - context.createdAt > 86400000 || (context.orderNo && context.orderNo !== args[3])) return JSON.stringify({ result: 'unattributed' });
          row = { transaction: args[1], client_id: context.client_id, session_id: context.session_id, value: Number(args[5]), timestamp: Number(args[6]), productId: args[4] };
          context.orderNo = args[3];
        }
        if (get(keys[1])?.status !== 'valid') return JSON.stringify({ result: 'invalid_order' });
        row.state = 'pending'; row.lease = args[0]; row.leaseUntil = now() + 30000;
        data.set(keys[0], row); ttl.set(keys[0], now() + 90 * 86400000);
        return JSON.stringify({ result: 'acquired', ...row });
      }
      if (script.includes('analytics-finish')) {
        const row = get(keys[0]); if (!row || row.lease !== args[0]) return 0;
        row.state = args[1]; row.leaseUntil = 0; return 1;
      }
      throw new Error('Unexpected script in fake Redis');
    },
  };
}
