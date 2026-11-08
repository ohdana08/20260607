import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScaleModule } from './helpers/scale-harness.mjs';
const env = { VERCEL_ENV: 'production', QA_MODE: 'false', GA4_PURCHASE_MODE: 'server_exclusive', GA4_MP_API_SECRET: 'synthetic-not-a-secret', GROBLE_WEBHOOK_SIGNING_SECRET: 'synthetic-signature' };
function setup(overrides = {}, user = { id: 'synthetic-user', isAdmin: false }) {
  const data = new Map(); const options = [];
  const redis = { async eval(script, keys) { const n = (data.get(keys[0]) ?? 0) + 1; data.set(keys[0], n); return n; }, async set(k, v, o) { data.set(k, v); options.push(o); } };
  return { data, options, api: loadScaleModule('lib/analytics/checkoutContext.ts', {}, { ...env, ...overrides }), redis, user };
}
const req = (body = { client_id: '12345.67890', session_id: '1792000000' }, url = 'https://ddakfit.bccconsulting.kr/api/analytics/checkout') => new Request(url, { method: 'POST', headers: { origin: 'https://ddakfit.bccconsulting.kr', 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('checkout route stays disabled before auth or Redis for every non-opt-in mode', async () => {
  for (const mode of [undefined, '', 'native', 'server_exclusiv', 'SERVER_EXCLUSIVE', 'server_exclusive ']) {
    let authCalls = 0, redisCalls = 0, contextCalls = 0;
    const route = loadScaleModule('app/api/analytics/checkout/route.ts', {
      '@/lib/auth/googleUser': { getGoogleUser: async () => { authCalls++; return { id: 'synthetic-user' }; } },
      '@upstash/redis': { Redis: class { constructor() { redisCalls++; } } },
      '@/lib/analytics/checkoutContext': { createCheckoutContext: async () => { contextCalls++; return Response.json({ reference: 'forbidden' }); } },
    }, { ...env, GA4_PURCHASE_MODE: mode, UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic' });
    const res = await route.POST(req());
    assert.equal(res.status, 503, `mode=${mode}`); assert.equal((await res.json()).error, 'disabled');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(authCalls, 0); assert.equal(redisCalls, 0); assert.equal(contextCalls, 0);
  }
});

test('context is authenticated, bounded, non-PII and rate limited', async () => {
  const s = setup();
  assert.equal((await s.api.createCheckoutContext(req(), null, s.redis)).status, 401);
  const res = await s.api.createCheckoutContext(req(), s.user, s.redis);
  assert.equal(res.status, 200);
  const body = await res.json(); assert.match(body.reference, /^ddak_[a-f0-9-]{36}$/);
  assert.equal(body.expires_in, 86400);
  assert.equal(JSON.stringify([...s.data.values()]).includes(s.user.id), false);
  assert.equal(s.options[0].ex, 86400);
  for (let i = 0; i < 9; i++) assert.equal((await s.api.createCheckoutContext(req(), s.user, s.redis)).status, 200);
  assert.equal((await s.api.createCheckoutContext(req(), s.user, s.redis)).status, 429);
  assert.equal((await setup().api.createCheckoutContext(req({ client_id: 'email@example.invalid', session_id: '1' }), s.user, s.redis)).status, 400);
  assert.equal((await s.api.createCheckoutContext(req({ client_id: '123.456', session_id: '1', email: 'private' }), s.user, s.redis)).status, 400);
});

test('context excludes QA/admin/preview/local and oversize; real route uses auth and catches storage failure', async () => {
  for (const [vars, user, url] of [[{ QA_MODE: 'true' }], [{ VERCEL_ENV: 'preview' }], [{}, { id: 'admin', isAdmin: true }], [{}, undefined, 'http://localhost:3000/api/analytics/checkout']]) {
    const s = setup(vars, user); assert.equal((await s.api.createCheckoutContext(req(undefined, url), s.user, s.redis)).status, 403);
  }
  const s = setup(); assert.equal((await s.api.createCheckoutContext(req({ extra: 'x'.repeat(600) }), s.user, s.redis)).status, 413);
  let authed = 0;
  const route = loadScaleModule('app/api/analytics/checkout/route.ts', {
    '@/lib/auth/googleUser': { getGoogleUser: async () => { authed++; return s.user; } },
    '@upstash/redis': { Redis: class { constructor() { return s.redis; } } },
  }, { ...env, UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic' });
  assert.equal((await route.POST(req())).status, 200); assert.equal(authed, 1);
  s.redis.set = async () => { throw new Error('synthetic'); };
  assert.equal((await route.POST(req())).status, 503);
});
