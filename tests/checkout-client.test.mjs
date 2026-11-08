import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const reference = 'ddak_12345678-1234-4234-8234-123456789abc';
const checkout = 'https://www.groble.im/payment/RJczGx';
function load(allowed = true, window = {}, stream = 'G-5TN5XW0T2J', purchaseMode = 'server_exclusive') {
  const loaded = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(new URL('../lib/analytics/checkoutClient.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module: loaded, exports: loaded.exports, require: name => {
    assert.equal(name, '../ga'); return { analyticsAllowed: () => allowed, BCC_GA_ID: 'G-5TN5XW0T2J', measurementIds: () => stream ? [stream] : [] };
  }, process: { env: { NEXT_PUBLIC_GA4_PURCHASE_MODE: purchaseMode === null ? undefined : purchaseMode } }, window, URL, AbortController, setTimeout, clearTimeout, fetch: () => { throw new Error('No real network in this test'); } });
  return loaded.exports;
}
const headers = async () => ({ Authorization: 'Bearer synthetic-test-token' });
const ids = async () => ({ client_id: '123.456', session_id: '1234567890' });

test('authenticated checkout appends only opaque server reference and sends exact GA identifiers', async () => {
  const calls = [];
  const { attributedCheckoutUrl } = load();
  const result = await attributedCheckoutUrl(checkout, headers, { getIds: ids, http: async (url, options) => {
    calls.push({ url, options }); return { ok: true, json: async () => ({ reference, expires_in: 86400 }) };
  } });
  assert.equal(new URL(result).searchParams.get('ref'), reference);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/analytics/checkout');
  assert.deepEqual(JSON.parse(calls[0].options.body), { client_id: '123.456', session_id: '1234567890' });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-test-token');
  assert.doesNotMatch(result, /synthetic|123\.456|1234567890/);
});

test('checkout identity comes only from the configured stream, not the old shared stream', async () => {
  for (const stream of ['G-APPONLY', '']) {
    const tags = [];
    let requests = 0;
    const helper = load(true, { gtag: (_cmd, tag, key, callback) => {
      tags.push(tag);
      callback(key === 'client_id' ? '123.456' : '1234567890');
    } }, stream);
    const result = await helper.attributedCheckoutUrl(checkout, headers, { http: async () => {
      requests++;
      return { ok: true, json: async () => ({ reference }) };
    } });
    assert.deepEqual(tags, stream ? [stream, stream] : []);
    assert.equal(requests, stream ? 1 : 0);
    assert.equal(new URL(result).searchParams.has('ref'), Boolean(stream));
  }
});

test('native mode keeps the real anchor and linker intact with zero context or popup work', async () => {
  for (const mode of [null, '', 'native', 'server_exclusiv']) {
    let work = 0;
    const forbidden = () => { work++; throw new Error('native navigation must not be intercepted'); };
    const helper = load(true, { open: forbidden }, 'G-NATIVE', mode);
    const auth = async () => { forbidden(); };
    const options = { getIds: async () => { forbidden(); }, http: async () => { forbidden(); } };
    assert.equal(await helper.attributedCheckoutUrl(checkout, auth, options), checkout);
    await helper.openAttributedCheckout({ currentTarget: { href: checkout, target: '_blank' }, button: 0, preventDefault: forbidden }, auth, options);
    assert.equal(work, 0, String(mode));
  }
});

test('measurement failures never prevent checkout or send private/unsupported input', async () => {
  for (const scenario of ['excluded', 'guest', 'http_error', 'network_error', 'bad_reference', 'bad_ids', 'other_host', 'existing_ref']) {
    let calls = 0;
    const original = scenario === 'other_host' ? 'https://example.invalid/payment/RJczGx' : scenario === 'existing_ref' ? `${checkout}?ref=keep_existing` : checkout;
    const helper = load(scenario !== 'excluded');
    const result = await helper.attributedCheckoutUrl(original, scenario === 'guest' ? async () => ({}) : headers, {
      getIds: scenario === 'bad_ids' ? async () => ({ client_id: 'private@example.invalid', session_id: '123' }) : ids,
      http: async () => { calls++; if (scenario === 'network_error') throw new Error('synthetic failure'); return { ok: scenario !== 'http_error', json: async () => ({ reference: scenario === 'bad_reference' ? 'https://attacker.invalid' : reference }) }; },
    });
    assert.equal(result, original, scenario);
    if (['excluded', 'guest', 'bad_ids', 'other_host', 'existing_ref'].includes(scenario)) assert.equal(calls, 0, scenario);
  }
});

test('late GA callbacks have a deadline and never start a checkout API request afterwards', async () => {
  let calls = 0;
  const result = await load().attributedCheckoutUrl(checkout, headers, {
    timeoutMs: 5,
    getIds: () => new Promise(resolve => setTimeout(() => resolve({ client_id: '123.456', session_id: '1234567890' }), 20)),
    http: async () => { calls++; return { ok: true, json: async () => ({ reference }) }; },
  });
  assert.equal(result, checkout);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(calls, 0);
});

test('checkout reserves user gesture synchronously, removes opener, and falls back without blocking', async () => {
  const navigations = [];
  const tab = { opener: {}, closed: false, location: { replace: url => navigations.push(url) } };
  let opened = 0; let prevented = 0;
  const window = { open: () => { opened++; return tab; } };
  const event = { currentTarget: { href: checkout, target: '_blank' }, button: 0, preventDefault: () => prevented++ };
  const helper = load(true, window);
  const pending = helper.openAttributedCheckout(event, headers, { getIds: ids, http: async () => ({ ok: true, json: async () => ({ reference }) }) });
  assert.equal(opened, 1);
  assert.equal(prevented, 1);
  assert.equal(tab.opener, null);
  await pending;
  assert.equal(new URL(navigations[0]).searchParams.get('ref'), reference);
  await helper.openAttributedCheckout(event, async () => { throw new Error('auth failed'); });
  assert.equal(navigations.at(-1), checkout);
});

test('modified click, prevented click, excluded analytics and blocked popup retain native navigation', async () => {
  for (const scenario of ['modified', 'prevented', 'excluded', 'popup_blocked']) {
    let prevented = 0; let requests = 0;
    const helper = load(scenario !== 'excluded', { open: () => null });
    await helper.openAttributedCheckout({ currentTarget: { href: checkout, target: '_blank' }, button: 0,
      metaKey: scenario === 'modified', defaultPrevented: scenario === 'prevented', preventDefault: () => prevented++ },
      headers, { getIds: ids, http: async () => { requests++; throw new Error('should not request'); } });
    assert.equal(prevented, 0, scenario);
    assert.equal(requests, 0, scenario);
  }
});

test('all five existing Groble links wire the attribution helper after their existing consent gates', () => {
  for (const [file, expected] of [['app/landing/LandingClient.tsx', 2], ['components/chat/Chat.tsx', 2], ['components/chat/PresentationStudio.tsx', 1]]) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal((text.match(/void openAttributedCheckout\(/g) ?? []).length, expected, file);
    assert.match(text, /import.*openAttributedCheckout/);
    assert.match(text, /authedHeaders/);
  }
});
