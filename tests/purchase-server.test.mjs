import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScaleModule } from './helpers/scale-harness.mjs';
import { createHmac } from 'node:crypto';
import { fakePurchaseRedis } from './helpers/purchase-server-fake.mjs';
import { loadPurchaseRoute } from './helpers/purchase-route-harness.mjs';
const load = () => loadScaleModule('lib/analytics/purchase.ts');
const order = '202610150000000001';
const fixture = () => ({ id: 'evt_synthetic_only', type: 'payment.completed', version: '2026-04-30', occurredAt: new Date().toISOString(), data: { object: { merchantUid: order, content: { id: 'RJczGx', type: 'DOCUMENT' }, pricing: { currency: 'KRW', finalAmount: 12345 }, paymentMethod: { type: 'CARD' }, buyer: { email: 'synthetic@example.invalid' } } } });
test('eligibility uses documented paid amount and exact completed/order/product; unknown pricing fails closed', () => {
  const { classifyPurchase } = load();
  const p = fixture();
  assert.equal(classifyPurchase(p, ['RJczGx']).value, 12345);
  p.data.object.content.type = 'SERVICE'; assert.equal(classifyPurchase(p, ['RJczGx']).value, 12345);
  for (const mutate of [p => p.type = 'unknown.completed', p => p.data.object.merchantUid = 'order-' + order, p => p.data.object.content.id = 'old', p => delete p.data.object.pricing.finalAmount, p => p.data.object.pricing.finalAmount = '12345', p => p.data.object.pricing.finalAmount = 0, p => p.data.object.pricing.currency = 'USD', p => p.id = 'evt_test_sample', p => p.data.object.paymentMethod.type = 'FREE']) {
    const bad = fixture(); mutate(bad);
    assert.equal(classifyPurchase(bad, ['RJczGx']).ok, false);
  }
});

const env = { VERCEL_ENV: 'production', GA4_PURCHASE_MODE: 'server_exclusive', GA4_MP_API_SECRET: 'synthetic-not-a-secret', GROBLE_WEBHOOK_SIGNING_SECRET: 'synthetic-signature' };
const reference = 'ddak_00000000-0000-4000-8000-000000000001';
function signed(p = fixture()) {
  p.data.object.sellerReference = reference;
  const rawBody = Buffer.from(JSON.stringify(p)); const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', env.GROBLE_WEBHOOK_SIGNING_SECRET).update(timestamp + '.').update(rawBody).digest('hex');
  return { payload: p, rawBody, headers: new Headers({ 'X-Groble-Timestamp': timestamp, 'X-Groble-Signature': signature }) };
}
async function ready() {
  const redis = fakePurchaseRedis();
  await redis.set(`gp:validorder:${order}`, { status: 'valid', productId: 'RJczGx' });
  await redis.set(`gp:analytics:checkout:${reference}`, { client_id: '12345.67890', session_id: '1792000000', createdAt: Date.now() }, { ex: 86400 });
  return redis;
}
test('signed real payment travels to fixed shared GA stream with safe transaction and per-app scope', async () => {
  const redis = await ready(); const calls = [];
  const server = loadScaleModule('lib/analytics/server.ts', {}, env);
  const http = async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); };
  assert.equal((await server.reportPurchase({ ...signed(), redis }, http)).status, 'sent');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].options.body), params = body.events[0].params;
  assert.match(calls[0].url, /^https:\/\/www.google-analytics.com\/mp\/collect\?measurement_id=G-5TN5XW0T2J&api_secret=/);
  assert.equal(body.events[0].name, 'purchase'); assert.equal(params.value, 12345); assert.equal(params.currency, 'KRW');
  assert.equal(params.site_id, 'ddakfit'); assert.equal(params.app_id, 'ddakfit');
  assert.equal(body.client_id, '12345.67890'); assert.equal(params.session_id, '1792000000');
  assert.match(params.transaction_id, /^ddak_tx_[a-f0-9-]{36}$/);
  for (const forbidden of [order, 'synthetic@example.invalid', reference, 'buyer', 'email', 'merchantUid', 'Threads', 'user_id']) assert.equal(calls[0].options.body.includes(forbidden), false);
  assert.equal((await server.reportPurchase({ ...signed(), redis }, http)).status, 'duplicate'); assert.equal(calls.length, 1);
});

test('server purchase follows the same configured stream as browser, invalid targets write nothing', async () => {
  for (const id of ['G-APPONLY', 'invalid']) {
    const redis = await ready();
    const calls = [];
    const server = loadScaleModule('lib/analytics/server.ts', {}, { ...env, NEXT_PUBLIC_GA_ID: id });
    const result = await server.reportPurchase({ ...signed(), redis }, async url => {
      calls.push(url);
      return new Response(null, { status: 204 });
    });
    if (id === 'invalid') {
      assert.equal(result.status, 'unconfigured');
      assert.equal(calls.length, 0);
      assert.equal(redis.data.has(`gp:analytics:purchase:${order}`), false);
    } else {
      assert.equal(result.status, 'sent');
      assert.equal(new URL(calls[0]).searchParams.get('measurement_id'), id);
    }
  }
});

test('purchase requires exact explicit server-exclusive opt-in even with both secrets', async () => {
  for (const mode of [undefined, '', 'native', 'server_exclusiv', 'SERVER_EXCLUSIVE', ' server_exclusive']) {
    let redisCalls = 0, httpCalls = 0;
    const redis = { async eval() { redisCalls++; throw Error('registry forbidden'); } };
    const server = loadScaleModule('lib/analytics/server.ts', {}, { ...env, GA4_PURCHASE_MODE: mode });
    const result = await server.reportPurchase({ ...signed(), redis }, async () => { httpCalls++; return new Response(null, { status: 204 }); });
    assert.equal(result.status, 'disabled', `mode=${mode}`);
    assert.equal(redisCalls, 0); assert.equal(httpCalls, 0);
  }
});

test('configuration and exclusion gates fail closed without GA or registry writes', async () => {
  for (const [vars, status] of [[{ GA4_MP_API_SECRET: '' }, 'unconfigured'], [{ GROBLE_WEBHOOK_SIGNING_SECRET: '' }, 'unconfigured'], [{ VERCEL_ENV: 'preview' }, 'excluded'], [{ QA_MODE: 'true' }, 'excluded']]) {
    const redis = await ready(); const server = loadScaleModule('lib/analytics/server.ts', {}, { ...env, ...vars });
    assert.equal((await server.reportPurchase({ ...signed(), redis }, () => { throw Error('network forbidden'); })).status, status);
    assert.equal(redis.data.has(`gp:analytics:purchase:${order}`), false);
  }
});

test('HMAC raw bytes, freshness, rotation, event age and unattributed gates', async () => {
  const server = loadScaleModule('lib/analytics/server.ts', {}, env);
  const noHTTP = () => { throw Error('network forbidden'); };
  for (const mutate of [s => s.rawBody = Buffer.from('{}'), s => s.headers.set('x-groble-signature', '0'.repeat(64)), s => s.headers.set('x-groble-timestamp', '1')]) {
    const s = signed(); mutate(s); assert.equal((await server.reportPurchase({ ...s, redis: await ready() }, noHTTP)).status, 'unverified');
  }
  const old = signed(); old.payload.occurredAt = '2020-01-01T00:00:00Z';
  assert.equal((await server.reportPurchase({ ...signed(old.payload), redis: await ready() }, noHTTP)).status, 'expired');
  const redis = await ready(); redis.data.delete(`gp:analytics:checkout:${reference}`);
  assert.equal((await server.reportPurchase({ ...signed(), redis }, noHTTP)).status, 'unattributed');
  const rot = signed(); rot.headers.set('x-groble-signature-previous', rot.headers.get('x-groble-signature')); rot.headers.set('x-groble-signature', '0'.repeat(64));
  assert.equal((await server.reportPurchase({ ...rot, redis: await ready() }, async () => new Response(null, { status: 204 }))).status, 'sent');
});

test('atomic concurrency and failed/uncertain POST retry retain one private transaction and frozen price', async () => {
  const redis = await ready(), server = loadScaleModule('lib/analytics/server.ts', {}, env), bodies = [];
  let release; const hold = new Promise(resolve => { release = resolve; });
  const first = server.reportPurchase({ ...signed(), redis }, async (_url, o) => { bodies.push(JSON.parse(o.body)); await hold; return new Response(null, { status: 500 }); });
  await new Promise(resolve => setImmediate(resolve));
  const concurrent = await Promise.all(Array.from({ length: 12 }, () => server.reportPurchase({ ...signed(), redis }, () => { throw Error('concurrent HTTP forbidden'); })));
  assert.equal(concurrent.every(x => x.status === 'busy' && x.retry === true), true); release();
  assert.equal((await first).retry, true);
  const changed = fixture(); changed.data.object.pricing.finalAmount = 999;
  assert.equal((await server.reportPurchase({ ...signed(changed), redis }, async (_url, o) => { bodies.push(JSON.parse(o.body)); throw new Error('uncertain timeout'); })).retry, true);
  assert.equal((await server.reportPurchase({ ...signed(), redis }, async (_url, o) => { bodies.push(JSON.parse(o.body)); return new Response(null, { status: 204 }); })).status, 'sent');
  assert.equal(new Set(bodies.map(b => b.events[0].params.transaction_id)).size, 1);
  assert.equal(bodies.every(b => b.events[0].params.value === 12345), true);
});

test('actual webhook calls real analytics after registration and surfaces retry; cancel/security/unknown stay unchanged', async () => {
  const redis = await ready(), server = loadScaleModule('lib/analytics/server.ts', {}, env), calls = [];
  const makeRoute = (analyticsEnv = env) => loadScaleModule('app/api/groble/webhook/route.ts', {
    '@upstash/redis': { Redis: class { constructor() { return redis; } } },
    '@/lib/plan/access': { isMasterCode: () => false },
    '@/lib/plan/paidAccess': { GROBLE_RAW_EVENTS: 'raw', ORDER_NO_RE: /^\d{18,19}$/, VALID_ORDER_KEY: n => `gp:validorder:${n}` },
    '@/lib/plan/paymentState': { registerOrder: async (r, row) => { await r.set(`gp:validorder:${row.orderNo}`, row); return row; }, cancelOrder: async () => { calls.push('cancel'); return 0; } },
    '@/lib/analytics/server': { reportPurchase: input => server.reportPurchase(input, async (url, o) => { calls.push({ url, body: o.body }); return new Response(null, { status: 503 }); }) },
  }, { ...analyticsEnv, GROBLE_WEBHOOK_KEY: 'synthetic-key', UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic' });
  const route = makeRoute();
  const request = (s = signed(), key = 'synthetic-key') => new Request(`https://ddakfit.bccconsulting.kr/api/groble/webhook?key=${key}`, { method: 'POST', headers: s.headers, body: s.rawBody });
  assert.equal((await route.POST(request(undefined, 'wrong'))).status, 403);
  const completed = await route.POST(request()); assert.equal(completed.status, 503); assert.equal(calls.length, 1);
  const cancelled = signed(); cancelled.payload.type = 'payment.refunded';
  assert.equal((await route.POST(request(signed(cancelled.payload)))).status, 200); assert.equal(calls[1], 'cancel'); assert.equal(calls.length, 2);
  const unknown = signed(); unknown.payload.type = 'payment.pending';
  assert.equal((await (await route.POST(request(signed(unknown.payload)))).json()).action, 'ignored');
});

test('Claude101 HTTP forwarding remains before analytics; payload/headers/timeout/cancel/error preserved', async () => {
  const redis = await ready(), forwarded = [], events = [];
  const imports = {
    '@upstash/redis': { Redis: class { constructor() { return redis; } } },
    '@/lib/plan/access': { isMasterCode: () => false },
    '@/lib/plan/paidAccess': { GROBLE_RAW_EVENTS: 'raw', ORDER_NO_RE: /^\d{18,19}$/, VALID_ORDER_KEY: n => `gp:validorder:${n}` },
    '@/lib/plan/paymentState': { registerOrder: async (_r, row) => row, cancelOrder: async () => { events.push('cancel'); return 0; } },
    '@/lib/analytics/server': { reportPurchase: async () => { events.push('analytics'); return { status: 'ineligible' }; } },
  };
  let status = 204;
  const route = loadPurchaseRoute(imports, { ...env, GROBLE_WEBHOOK_KEY: 'synthetic-key', UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic', BCC_CLAUDE101_GROBLE_CONTENT_ID: 'claude-synthetic', BCC_GROBLE_FORWARD_URL: 'https://forward.invalid', BCC_GROBLE_FORWARD_SECRET: 'synthetic-forward' }, async (url, options) => { events.push('forward'); forwarded.push({ url, options }); return new Response(null, { status }); });
  const p = fixture(); p.data.object.content.id = 'claude-synthetic';
  const req = () => new Request('https://ddakfit.bccconsulting.kr/api/groble/webhook?key=synthetic-key', { method: 'POST', body: JSON.stringify(p) });
  assert.equal((await route.POST(req())).status, 200);
  assert.deepEqual(events, ['forward', 'analytics']);
  assert.equal(forwarded[0].url, 'https://forward.invalid');
  assert.equal(forwarded[0].options.headers['X-BCC-Groble-Secret'], 'synthetic-forward');
  assert.equal(forwarded[0].options.body, JSON.stringify(p)); assert.ok(forwarded[0].options.signal);
  p.type = 'payment.refunded'; assert.equal((await route.POST(req())).status, 200);
  assert.deepEqual(events.slice(2), ['cancel', 'forward']);
  status = 500; assert.equal((await route.POST(req())).status, 502);
  imports['@/lib/plan/paymentState'].registerOrder = async (_r, row) => ({ ...row, status: 'cancelled' });
  p.type = 'payment.completed'; const before = forwarded.length;
  assert.equal((await (await route.POST(req())).json()).action, 'cancelled'); assert.equal(forwarded.length, before);
});

test('registered cancellation, stale signature and post-HTTP commit failure never fabricate a fresh transaction', async () => {
  const server = loadScaleModule('lib/analytics/server.ts', {}, env);
  const noHTTP = () => { throw Error('network forbidden'); };
  const redis = await ready(); await redis.set(`gp:validorder:${order}`, { status: 'cancelled', productId: 'RJczGx' });
  assert.equal((await server.reportPurchase({ ...signed(), redis }, noHTTP)).status, 'invalid_order');
  const stale = signed(); const ts = String(Math.floor(Date.now() / 1000) - 301);
  stale.headers.set('x-groble-timestamp', ts); stale.headers.set('x-groble-signature', createHmac('sha256', env.GROBLE_WEBHOOK_SIGNING_SECRET).update(ts + '.').update(stale.rawBody).digest('hex'));
  assert.equal((await server.reportPurchase({ ...stale, redis: await ready() }, noHTTP)).status, 'unverified');
  const db = await ready(); const originalEval = db.eval.bind(db); let lostCommit = true; const txs = [];
  db.eval = async (script, keys, args) => { if (script.includes('analytics-finish') && args[1] === 'sent' && lostCommit) { lostCommit = false; throw Error('synthetic storage failure'); } return originalEval(script, keys, args); };
  const http = async (_url, o) => { txs.push(JSON.parse(o.body).events[0].params.transaction_id); return new Response(null, { status: 204 }); };
  assert.equal((await server.reportPurchase({ ...signed(), redis: db }, http)).retry, true);
  assert.equal((await server.reportPurchase({ ...signed(), redis: db }, http)).status, 'sent');
  assert.equal(txs[0], txs[1]);
});

test('webhook non-opt-in modes preserve registration cancellation and forward without importing analytics', async () => {
  for (const mode of [undefined, '', 'native', 'server_exclusiv', 'SERVER_EXCLUSIVE', 'server_exclusive ']) {
    const redis = await ready(); let analyticsLoads = 0, registryCalls = 0, registered = 0, cancelled = 0, forwarded = 0;
    redis.eval = async () => { registryCalls++; throw Error('analytics registry forbidden'); };
    const imports = {
      '@upstash/redis': { Redis: class { constructor() { return redis; } } },
      '@/lib/plan/access': { isMasterCode: () => false },
      '@/lib/plan/paidAccess': { GROBLE_RAW_EVENTS: 'raw', ORDER_NO_RE: /^\d{18,19}$/, VALID_ORDER_KEY: n => `gp:validorder:${n}` },
      '@/lib/plan/paymentState': {
        registerOrder: async (r, row) => { registered++; await r.set(`gp:validorder:${row.orderNo}`, row); return row; },
        cancelOrder: async () => { cancelled++; return 0; },
      },
    };
    Object.defineProperty(imports, '@/lib/analytics/server', { get() { analyticsLoads++; throw Error('analytics import forbidden'); } });
    const route = loadPurchaseRoute(imports, { ...env, GA4_PURCHASE_MODE: mode, GROBLE_WEBHOOK_KEY: 'synthetic-key', UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic', BCC_CLAUDE101_GROBLE_CONTENT_ID: 'claude-synthetic', BCC_GROBLE_FORWARD_URL: 'https://forward.invalid', BCC_GROBLE_FORWARD_SECRET: 'synthetic-forward' }, async url => { assert.equal(url, 'https://forward.invalid'); forwarded++; return new Response(null, { status: 204 }); });
    for (const product of ['RJczGx', 'claude-synthetic']) {
      const p = fixture(); p.data.object.content.id = product;
      for (const [type, action] of [['payment.completed', 'registered'], ['payment.refunded', 'cancelled']]) {
        p.type = type;
        const res = await route.POST(new Request('https://ddakfit.bccconsulting.kr/api/groble/webhook?key=synthetic-key', { method: 'POST', body: JSON.stringify(p) }));
        assert.equal(res.status, 200, `mode=${mode}, action=${action}`); assert.equal((await res.json()).action, action);
      }
    }
    assert.equal(registered, 2); assert.equal(cancelled, 2); assert.equal(forwarded, 2);
    assert.equal(analyticsLoads, 0); assert.equal(registryCalls, 0);
    assert.equal(redis.data.has(`gp:analytics:purchase:${order}`), false);
  }
});

test('unconfigured webhook preserves registration without loading analytics or touching a new dependency', async () => {
  const redis = await ready();
  const route = loadPurchaseRoute({
    '@upstash/redis': { Redis: class { constructor() { return redis; } } },
    '@/lib/plan/access': { isMasterCode: () => false },
    '@/lib/plan/paidAccess': { GROBLE_RAW_EVENTS: 'raw', ORDER_NO_RE: /^\d{18,19}$/, VALID_ORDER_KEY: n => `gp:validorder:${n}` },
    '@/lib/plan/paymentState': { registerOrder: async (_r, row) => row },
  }, { GROBLE_WEBHOOK_KEY: 'synthetic-key', UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic' }, () => { throw Error('network forbidden'); });
  const res = await route.POST(new Request('https://ddakfit.bccconsulting.kr/api/groble/webhook?key=synthetic-key', { method: 'POST', body: JSON.stringify(fixture()) }));
  assert.equal(res.status, 200); assert.equal((await res.json()).action, 'registered');
});
