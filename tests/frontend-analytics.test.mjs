import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function browser(search = '') {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) };
  const calls = [];
  const window = { location: { hostname: 'ddakfit.bccconsulting.kr', origin: 'https://ddakfit.bccconsulting.kr', pathname: '/landing', search, href: `https://ddakfit.bccconsulting.kr/landing${search}` }, sessionStorage: storage, gtag: (...args) => calls.push(args), dataLayer: [] };
  return { window, sessionStorage: storage, calls, process: { env: { NODE_ENV: 'production', VERCEL_ENV: 'production' } }, URL, URLSearchParams, console };
}
function load(file, globals) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const require = name => {
    if (globals.imports?.[name]) return globals.imports[name];
    if (name === 'next/server') return { NextResponse: { redirect: (url, status) => ({ url: url.toString(), status }) } };
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, globals);
    if (name.startsWith('.')) return load(`lib/${name.replace('./','').replace(/\.ts$/, '')}.ts`, globals);
    throw new Error(`Unexpected import: ${name}`);
  };
  vm.runInNewContext(code, { ...globals, module: loaded, exports: loaded.exports, require });
  return loaded.exports;
}

test('start keeps valid attribution and defaults only missing keys', () => {
  const g = browser();
  const { GET } = load('app/start/route.ts', g);
  const url = new URL('https://ddakfit.bccconsulting.kr/start?utm_source=newsletter&utm_campaign=launch&utm_content=post_01&token=private');
  const result = GET({ url: url.toString(), nextUrl: url });
  const out = new URL(result.url);
  assert.equal(out.searchParams.get('utm_source'), 'newsletter');
  assert.equal(out.searchParams.get('utm_medium'), 'organic');
  assert.equal(out.searchParams.get('utm_campaign'), 'launch');
  assert.equal(out.searchParams.get('utm_content'), 'post_01');
  assert.equal(result.status, 302);
});

test('normal Korean, domain and date campaigns survive redirect and GA attribution; rejected existing fields are never defaulted', () => {
  for (const value of ['뉴스레터', 'newsletter.email', '20261015_launch', 'fall20261015', '2026-10-15']) {
    const g = browser(`?utm_source=${encodeURIComponent(value)}`);
    const url = new URL(`https://ddakfit.bccconsulting.kr/start${g.window.location.search}`);
    const out = new URL(load('app/start/route.ts', g).GET({ url: url.toString(), nextUrl: url }).url);
    assert.equal(out.searchParams.get('utm_source'), value);
    const utm = load('lib/utm.ts', g);
    utm.captureUtm();
    assert.equal(utm.getLeadSource(), value);
    load('lib/ga.ts', g).track('view_landing');
    assert.equal(g.calls.find(x => x[0] === 'event')[2].latest_source, value);
  }
  for (const value of ['person@example.invalid', 'https://example.invalid', '010-1234-5678', '']) {
    const g = browser(`?utm_source=${encodeURIComponent(value)}&utm_campaign=${encodeURIComponent(value)}`);
    const url = new URL(`https://ddakfit.bccconsulting.kr/start${g.window.location.search}`);
    const out = new URL(load('app/start/route.ts', g).GET({ url: url.toString(), nextUrl: url }).url);
    assert.notEqual(out.searchParams.get('utm_source'), 'threads');
    assert.notEqual(out.searchParams.get('utm_campaign'), 'first100');
    load('lib/ga.ts', g).track('view_landing');
    const p = g.calls.find(x => x[0] === 'event')[2];
    assert.equal(p.latest_source, undefined);
    assert.equal(new URL(p.page_location).searchParams.has('utm_source'), false);
  }
});

test('attribution retains first and latest including content without direct overwrites', () => {
  const g = browser('?utm_source=threads&utm_campaign=launch&utm_content=post_01');
  const utm = load('lib/utm.ts', g);
  utm.captureUtm();
  g.window.location.search = '?utm_source=newsletter&utm_content=cta_2';
  utm.captureUtm();
  const value = utm.getAttribution();
  assert.equal(value.first.content, 'post_01');
  assert.equal(value.latest.source, 'newsletter');
  g.window.location.search = '';
  utm.captureUtm();
  assert.equal(utm.getAttribution().latest.content, 'cta_2');
  assert.match(utm.getLeadSource(), /newsletter/);
});

test('legacy same-tab source survives only in lead attribution, never as raw GA params', () => {
  for (const legacy of ['newsletter / email / launch', 'person@example.invalid / private notes']) {
    const g = browser();
    g.sessionStorage.setItem('gp_utm_v1', legacy);
    const utm = load('lib/utm.ts', g);
    assert.equal(utm.getLeadSource(), legacy);
    load('lib/ga.ts', g).track('view_landing');
    const p = g.calls.find(x => x[0] === 'event')[2];
    assert.equal(p.latest_source, undefined);
    assert.equal(p.first_source, undefined);
    g.window.location.search = '?utm_source=뉴스레터';
    assert.equal(utm.getLeadSource(), '뉴스레터');
  }
  const g = browser('?utm_source=person%40example.invalid&utm_campaign=private%20notes');
  const utm = load('lib/utm.ts', g);
  assert.equal(utm.getLeadSource(), 'person@example.invalid / private notes');
  g.window.location.search = '';
  assert.equal(utm.getLeadSource(), 'person@example.invalid / private notes');
  assert.equal(Object.keys(utm.getAttribution().latest).length, 0);
  load('lib/ga.ts', g).track('view_landing');
  assert.equal(g.calls.find(x => x[0] === 'event')[2].latest_source, undefined);
});

test('event transport emits once, strips private params and labels shared-property traffic', () => {
  const g = browser('?email=private%40example.com&access_token=secret&utm_content=post_01');
  const { track } = load('lib/ga.ts', g);
  track('recommendation_shown', { count: 3, program: 'Private project', email: 'private@example.com', token: 'secret', send_to: 'G-EVIL', site_id: 'evil' });
  const events = g.calls.filter(x => x[0] === 'event');
  assert.equal(events.length, 1);
  assert.equal(g.window.dataLayer.length, 0);
  const p = events[0][2];
  assert.equal(p.count, 3);
  assert.equal(p.site_id, 'ddakfit');
  assert.equal(p.app_id, 'ddakfit');
  assert.equal(p.program, undefined);
  assert.equal(p.email, undefined);
  assert.equal(p.token, undefined);
  assert.equal(p.send_to, 'G-5TN5XW0T2J');
  assert.equal(p.page_location, 'https://ddakfit.bccconsulting.kr/landing?utm_content=post_01');
  assert.equal(p.page_referrer, '');
  assert.equal(p.page_title, 'ddakfit');
});

test('legacy false-success names are corrected and client purchase is denied', () => {
  const g = browser();
  const { track } = load('lib/ga.ts', g);
  track('sign_up', { method: 'google' });
  track('complete_payment', { price: 1 });
  track('purchase', { value: 1 });
  assert.deepEqual(g.calls.filter(x => x[0] === 'event').map(x => x[1]), ['login_start', 'plan_session_start']);
});

test('localhost, preview, admin and QA events fail closed', () => {
  for (const mode of ['local', 'preview', 'admin', 'qa']) {
    const g = browser();
    if (mode === 'local') g.window.location.hostname = 'localhost';
    if (mode === 'preview') g.process.env.VERCEL_ENV = 'preview';
    if (mode === 'admin') g.window.sessionStorage.setItem('gp_analytics_excluded', '1');
    if (mode === 'qa') g.window.location.search = '?qa=1';
    load('lib/ga.ts', g).track('view_landing');
    assert.equal(g.calls.length, 0, mode);
  }
});

test('initialization configures shared ID once with safe page defaults before events', () => {
  const g = browser('?email=private%40example.com');
  g.process.env.NEXT_PUBLIC_GA_ID = 'G-5TN5XW0T2J';
  const ga = load('lib/ga.ts', g);
  assert.deepEqual(Array.from(ga.measurementIds()), ['G-5TN5XW0T2J']);
  ga.initializeAnalytics();
  ga.initializeAnalytics();
  ga.track('view_landing');
  const configs = g.calls.filter(x => x[0] === 'config');
  assert.equal(configs.length, 1);
  assert.equal(configs[0][2].send_page_view, false);
  assert.equal(configs[0][2].page_location, 'https://ddakfit.bccconsulting.kr/landing');
  assert.equal(configs[0][2].site_id, 'ddakfit');
  assert.equal(g.calls.filter(x => x[0] === 'js').length, 1);
  assert.equal(g.calls.at(-1)[0], 'event');
  assert.deepEqual(Array.from(ga.measurementIds('G-OTHER')), ['G-OTHER']);
  assert.deepEqual(Array.from(ga.measurementIds('invalid')), []);
});

test('root loader follows only the configured stream and malformed targets fail closed', () => {
  for (const id of ['G-APPONLY', 'invalid']) {
    const g = browser();
    g.process.env.NEXT_PUBLIC_GA_ID = id;
    g.imports = {
      react: { useEffect: fn => fn(), useRef: value => ({ current: value }), useSyncExternalStore: (_subscribe, get) => get() },
      'next/navigation': { usePathname: () => '/landing' },
      'next/script': { default: 'script' },
      'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    };
    const node = load('components/Analytics.tsx', g).default();
    if (id === 'invalid') {
      assert.equal(node, null);
      assert.equal(g.calls.length, 0);
    } else {
      assert.equal(new URL(node.props.src).searchParams.get('id'), id);
      assert.deepEqual(g.calls.filter(c => c[0] === 'config').map(c => c[1]), [id]);
      assert.equal(g.calls.find(c => c[0] === 'event')[2].send_to, id);
    }
  }
});

test('OAuth intent is not success; confirmed Google session consumes intent once, refresh never succeeds twice', () => {
  const g = browser();
  const ga = load('lib/ga.ts', g);
  ga.recordLoginStart();
  assert.equal(g.calls.filter(x => x[1] === 'login').length, 0);
  ga.recordLoginSuccess(false);
  assert.equal(g.calls.filter(x => x[1] === 'login').length, 0);
  ga.recordLoginSuccess(true);
  ga.recordLoginSuccess(true);
  assert.equal(g.calls.filter(x => x[1] === 'login').length, 1);
  const restored = browser();
  load('lib/ga.ts', restored).recordLoginSuccess(true);
  assert.equal(restored.calls.length, 0);
});

test('checkout link intent is distinct from Groble native begin_checkout and purchase', () => {
  const g = browser();
  const ga = load('lib/ga.ts', g);
  ga.track('checkout_start', { price: 39000 });
  assert.equal(g.calls.filter(x => x[1] === 'begin_checkout').length, 0);
  ga.trackCheckout('word', 39000);
  const checkout = g.calls.filter(x => x[1] === 'checkout_link_click');
  assert.equal(checkout.length, 1);
  assert.equal(checkout[0][2].currency, 'KRW');
  assert.equal(checkout[0][2].value, 39000);
  assert.equal(checkout[0][2].items[0].item_id, 'RJczGx');
  assert.equal(checkout[0][2].items[0].quantity, 1);
  ga.trackCheckout('word', NaN);
  assert.equal(g.calls.filter(x => x[1] === 'checkout_link_click').length, 1);
  ga.track('begin_checkout', { product: 'word', price: 29900 });
  assert.equal(g.calls.filter(x => x[1] === 'checkout_link_click').length, 2);
  assert.equal(g.calls.filter(x => x[1] === 'begin_checkout' || x[1] === 'purchase').length, 0);
});

test('public checkout URLs supply bundle and presentation item IDs without private server env', () => {
  const g = browser();
  g.process.env.NEXT_PUBLIC_GROBLE_BUNDLE_CHECKOUT_URL = 'https://www.groble.im/payment/qZGHSP';
  g.process.env.NEXT_PUBLIC_GROBLE_PRESENTATION_CHECKOUT_URL = 'https://www.groble.im/payment/synthetic-presentation';
  const ga = load('lib/ga.ts', g);
  ga.trackCheckout('word_presentation_bundle', 44900);
  ga.trackCheckout('presentation', 19900);
  const events = g.calls.filter(x => x[1] === 'checkout_link_click');
  assert.equal(events.length, 2);
  assert.equal(events[0][2].items[0].item_id, 'qZGHSP');
  assert.equal(events[1][2].items[0].item_id, 'synthetic-presentation');
  for (const url of ['http://www.groble.im/payment/qZGHSP', 'https://evil.invalid/payment/qZGHSP', 'https://www.groble.im/payment/qZGHSP/extra']) {
    const bad = browser();
    bad.process.env.NEXT_PUBLIC_GROBLE_BUNDLE_CHECKOUT_URL = url;
    load('lib/ga.ts', bad).trackCheckout('word_presentation_bundle', 44900);
    assert.equal(bad.calls.length, 0);
  }
});

test('UI wiring uses one root tag loader and honest auth / checkout call sites', () => {
  const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const layout = read('app/layout.tsx');
  assert.doesNotMatch(layout, /GoogleAnalytics|ga-doumi|gtag\('config'/);
  assert.match(layout, /<Analytics\s*\/>/);
  const auth = read('components/auth/AuthGate.tsx');
  assert.doesNotMatch(auth, /track\("sign_up"/);
  assert.match(auth, /recordLoginStart\(\)/);
  assert.match(auth, /recordLoginSuccess\(/);
  assert.match(auth, /track\("auth_gate_view"/);
  assert.match(auth, /identityTokenRef\.current !== nextToken/);
  assert.match(auth, /if \(!active\) return/);
  const chat = read('components/chat/Chat.tsx');
  assert.doesNotMatch(chat, /track\("complete_payment"/);
  assert.match(chat, /track\("plan_session_start"/);
  assert.match(chat, /trackCheckout\("word", PRICE_KRW\)/);
  assert.match(chat, /trackCheckout\("word_presentation_bundle", BUNDLE_PRICE_KRW\)/);
  const studio = read('components/chat/PresentationStudio.tsx');
  assert.match(studio, /trackCheckout\("presentation", PRESENTATION_PRICE_KRW\)/);
  assert.match(studio, /!data.isQa/);
  const landing = read('app/landing/LandingClient.tsx');
  assert.match(landing, /trackCheckout\("word", PRICE_KRW\)/);
  assert.match(landing, /trackCheckout\("word_presentation_bundle", BUNDLE_PRICE_KRW\)/);
});

test('real finder stage names survive allowlist while arbitrary answers and operations views do not', () => {
  const g = browser();
  const ga = load('lib/ga.ts', g);
  ga.track('plain_flow_step_view', { step: 'find-years' });
  ga.track('demo_tab_view', { demo_type: 'early' });
  ga.track('plain_flow_answer', { step: 'business_description', value: 'My private business' });
  const events = g.calls.filter(x => x[0] === 'event');
  assert.equal(events[0][2].step, 'find-years');
  assert.equal(events[1][2].demo_type, 'early');
  assert.equal(events[2][2].value, undefined);
  const admin = browser();
  admin.window.location.pathname = '/operations';
  load('lib/ga.ts', admin).track('page_view');
  assert.equal(admin.calls.length, 0);
});

test('unsafe campaign fields and malformed stored attribution never leak to analytics', () => {
  const g = browser('?utm_source=person%40example.com&utm_medium=https%3A%2F%2Fevil.test&utm_campaign=call01012345678&utm_content=private%20sentence');
  const utm = load('lib/utm.ts', g);
  utm.captureUtm();
  assert.equal(Object.keys(utm.getAttribution().latest).length, 0);
  g.sessionStorage.setItem('gp_attribution_v2', '{broken');
  assert.equal(Object.keys(utm.getAttribution().first).length, 0);
  load('lib/ga.ts', g).track('view_landing', { user_id: 'secret', error: 'private detail', name: 'Name', items: [{item_id:'private'}] });
  const params = g.calls.filter(x => x[0] === 'event')[0][2];
  assert.equal(params.page_location, 'https://ddakfit.bccconsulting.kr/landing');
  for (const key of ['user_id', 'error', 'name', 'items']) assert.equal(params[key], undefined);
});

test('embed waits for auth classification before any tag or event, known admin remains excluded', () => {
  const g = browser();
  g.window.location.pathname = '/embed';
  const ga = load('lib/ga.ts', g);
  ga.track('page_view');
  assert.equal(g.calls.length, 0);
  ga.setAnalyticsIdentity('pending');
  ga.track('page_view');
  assert.equal(g.calls.length, 0);
  ga.setAnalyticsIdentity('guest');
  ga.track('auth_gate_view');
  assert.equal(g.calls.filter(x => x[1] === 'auth_gate_view').length, 1);
  ga.setAnalyticsIdentity('excluded');
  ga.track('page_view');
  assert.equal(g.calls.filter(x => x[1] === 'page_view').length, 0);
});

test('pending initial events replay once only after member or guest classification with safe snapshots', () => {
  for (const identity of ['member', 'guest']) {
    const g = browser('?utm_source=뉴스레터&email=private%40example.invalid');
    g.window.location.pathname = '/embed';
    const ga = load('lib/ga.ts', g);
    ga.setAnalyticsIdentity('pending');
    const params = { step: 'scope', email: 'private@example.invalid', value: 'private notes', token: 'private' };
    ga.track('scope_intro_view');
    ga.track('plain_flow_step_view', params);
    params.step = 'result';
    ga.track('purchase', { value: 29900 });
    assert.equal(g.calls.length, 0);
    ga.setAnalyticsIdentity(identity);
    ga.setAnalyticsIdentity(identity);
    const events = g.calls.filter(x => x[0] === 'event');
    assert.deepEqual(events.map(x => x[1]), ['scope_intro_view', 'plain_flow_step_view']);
    assert.equal(events[1][2].step, 'scope');
    assert.equal(events[1][2].latest_source, '뉴스레터');
    assert.doesNotMatch(JSON.stringify(events), /private|token|purchase/);
  }
});

test('pending queue is bounded and admin or QA classification irreversibly discards it', () => {
  const g = browser();
  g.window.location.pathname = '/embed';
  const ga = load('lib/ga.ts', g);
  ga.setAnalyticsIdentity('pending');
  for (let i = 0; i < 50; i++) ga.track('plain_flow_step_view', { step: 'scope' });
  ga.setAnalyticsIdentity('member');
  assert.equal(g.calls.filter(x => x[0] === 'event').length, 20);
  for (const mode of ['admin', 'qa']) {
    const g = browser();
    g.window.location.pathname = '/embed';
    const ga = load('lib/ga.ts', g);
    ga.setAnalyticsIdentity('pending');
    ga.track('scope_intro_view');
    if (mode === 'qa') g.window.location.search = '?qa=1';
    else ga.setAnalyticsIdentity('excluded');
    ga.setAnalyticsIdentity('member');
    g.window.location.search = '';
    ga.track('plain_flow_step_view', { step: 'scope' });
    assert.equal(g.calls.length, 0, mode);
  }
});

test('identity updates tolerate analytics listener failures', () => {
  const g = browser();
  g.Event = class Event {};
  g.window.dispatchEvent = () => { throw new Error('synthetic GA listener failure'); };
  const ga = load('lib/ga.ts', g);
  assert.doesNotThrow(() => ga.setAnalyticsIdentity('member'));
  assert.doesNotThrow(() => ga.setAnalyticsIdentity('excluded'));
});

// Execute the real AuthGate with a deterministic hook/IO harness, not a browser E2E.
async function mountAuthGate(classification, analyticsThrows = false) {
  const g = browser();
  g.window.location.pathname = '/embed';
  const ga = load('lib/ga.ts', g);
  const states = [], refs = [], deps = [], effects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, resolveVerify;
  const session = { access_token: 'synthetic-token', user: { app_metadata: { providers: ['google'] } } };
  const hooks = {
    createContext: () => ({ Provider: 'provider' }),
    useState: initial => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useRef: value => refs[refIndex++] ??= { current: value },
    useCallback: fn => fn, useMemo: fn => fn(),
    useEffect: (fn, values) => {
      const index = effectIndex++;
      if (!deps[index] || values.some((v, i) => deps[index][i] !== v)) {
        deps[index] = values;
        effects.push(fn);
      }
    },
  };
  g.fetch = () => new Promise(resolve => { resolveVerify = resolve; });
  g.imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@supabase/supabase-js': { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    } }) },
    '@/lib/auth/config': { AUTH_URL: 'https://auth.invalid', AUTH_ANON_KEY: 'synthetic' },
    '@/lib/ga': { ...ga, setAnalyticsIdentity: identity => {
      if (analyticsThrows && identity === 'member') throw new Error('synthetic analytics failure');
      ga.setAnalyticsIdentity(identity);
    } },
  };
  const AuthGate = load('components/auth/AuthGate.tsx', g).default;
  function render() {
    stateIndex = refIndex = effectIndex = 0;
    const result = AuthGate({ children: 'finder' });
    while (effects.length) effects.shift()();
    return result;
  }
  render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().props.children, 'finder', 'children mount while verify is pending');
  ga.track('scope_intro_view');
  ga.track('plain_flow_step_view', { step: 'scope', email: 'private@example.invalid' });
  assert.equal(g.calls.length, 0);
  resolveVerify({ ok: true, json: async () => classification });
  await new Promise(resolve => setImmediate(resolve));
  return { g, view: render() };
}

test('slow AuthGate verify replays initial finder for members, but discards admin and QA', async () => {
  const member = await mountAuthGate({ paid: true });
  assert.equal(member.view.props.value.paid, true);
  assert.deepEqual(member.g.calls.filter(x => x[0] === 'event').map(x => x[1]), ['scope_intro_view', 'plain_flow_step_view']);
  for (const classification of [{ admin: true, paid: true }, { isQa: true, paid: true }]) {
    const excluded = await mountAuthGate(classification);
    assert.equal(excluded.view.props.value.paid, true);
    assert.equal(excluded.g.calls.length, 0);
  }
});

test('AuthGate preserves successful payment access even if analytics classification throws', async () => {
  const member = await mountAuthGate({ paid: true }, true);
  assert.equal(member.view.props.value.paid, true);
});

test('before tag download the canonical gtag arguments queue has config before one event', () => {
  const g = browser();
  delete g.window.gtag;
  load('lib/ga.ts', g).track('chat_started');
  const queue = g.window.dataLayer;
  assert.deepEqual(queue.map(command => command[0]), ['js', 'config', 'event']);
  assert.equal(Object.prototype.toString.call(queue[2]), '[object Arguments]');
  assert.equal(queue[2][1], 'chat_started');
  assert.equal(queue.filter(command => command.event).length, 0);
});
