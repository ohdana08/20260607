import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports, env = {}) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, require(name) {
    if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`);
    return imports[name];
  }, process: { env }, console, Request, Response, URL, AbortSignal });
  return loaded.exports;
}
function baseline(existing, env = { ENTRY_SUMMARY_ENABLED: 'true', ANTHROPIC_API_KEY: 'test-only-not-a-real-key' }) {
  let calls = 0;
  const db = { from() {
    calls++;
    let ids, source, countOnly = false;
    const builder = {
      select(_columns, options) { countOnly = options?.head; return builder; },
      eq(_column, value) { source = value; return builder; },
      in(_column, value) { ids = value; return builder; },
      then(resolve) {
        const selected = existing.filter((p) => (!source || p.source === source) && (!ids || ids.includes(p.id)));
        return Promise.resolve({ data: countOnly ? null : selected, count: selected.length, error: null }).then(resolve);
      },
    };
    return builder;
  } };
  const api = load('lib/entry/summarizeNew.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => db }, './summary': {}, './summaryAttempt': {}, './match': { safeEntryUrl: (url) => url.startsWith('https://') },
  }, env);
  return { api, calls: () => calls };
}
const p = (id) => ({ id, source: 'bizinfo', url: 'https://www.bizinfo.go.kr/notice' });
test('new-only summary baseline excludes existing open and closed notices; does not treat missing summary as new', async () => {
  const h = baseline([{ ...p('old-open'), closed_at: null }, { ...p('old-closed'), closed_at: '2026-11-01' }]);
  const result = await h.api.findNewEntryPrograms([p('old-open'), p('old-closed'), p('brand-new'), p('brand-new')]);
  assert.deepEqual(Array.from(result, (item) => item.id), ['brand-new']);
});
test('first empty-source bootstrap is not a chargeable historic backfill', async () => {
  const h = baseline([]);
  assert.equal((await h.api.findNewEntryPrograms([p('new')])).length, 0);
});
test('default-disabled summaries perform no DB queries or provider import', async () => {
  const h = baseline([], {});
  assert.equal((await h.api.findNewEntryPrograms([p('new')])).length, 0);
  await h.api.summarizeNewEntryPrograms([p('new')]);
  assert.equal(h.calls(), 0);
});
test('public results route validates conditions before read, returns sanitized storage failure', async () => {
  let calls = 0;
  const { POST } = load('app/api/entry/results/route.ts', {
    '@/lib/entry/conditions': { parseEntryConditions: (v) => v?.age === '30_39' ? v : null },
    '@/lib/entry/catalog': { getEntryResults: async () => { calls++; throw new Error('must-not-expose-sensitive-details'); } },
  });
  assert.equal((await POST(new Request('http://localhost/api/entry/results', { method: 'POST', body: '{}' }))).status, 400);
  assert.equal(calls, 0);
  const response = await POST(new Request('http://localhost/api/entry/results', { method: 'POST', body: '{"age":"30_39"}' }));
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('sensitive'), false);
});

test('catalogue scans beyond old 3000 cap and fails visibly on a later page error', async () => {
  const rows = Array.from({ length: 3101 }, (_, i) => ({ id: `bizinfo:${String(i).padStart(5, '0')}`, source: 'bizinfo', title: '사업 지원', summary: '지원 설명', target: '중소기업', support_field: '사업화', region: '전국', apply_end: '2026-12-31', url: 'https://www.bizinfo.go.kr/notice', form_url: null }));
  const ranges = []; let fail = false;
  const db = { from() {
    let start = 0, end = 0;
    const q = { select() { return q; }, is() { return q; }, or() { return q; }, order() { return q; }, abortSignal() { return q; },
      range(a, b) { start = a; end = b; ranges.push([a, b]); return q; },
      then(resolve) { return Promise.resolve(fail && start >= 1000 ? { data: null, error: { message: 'test page error' } } : { data: rows.slice(start, end + 1), error: null }).then(resolve); },
    }; return q;
  } };
  const api = load('lib/entry/catalog.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => db },
    './match': { matchEntryPrograms: (programs) => programs, entryDate: (v) => v, safeEntryUrl: () => true },
    './summary': { sourceEntrySummary: (p) => ({ who: p.target, amount: '공고문 확인', deadline: p.applyEnd, description: p.summary, sourceUrl: p.url }) },
  });
  const result = await api.getEntryResults({}, new Date('2026-11-12T00:00:00Z'));
  assert.equal(result.total, 3101); assert.equal(result.results.length, 3); assert.equal(ranges.length, 4);
  fail = true;
  await assert.rejects(api.getEntryResults({}), /entry_catalog_unavailable/);
});
