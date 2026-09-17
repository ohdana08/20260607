import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { performanceModules, programsFixture } from "./helpers/performance-harness.mjs";
import { collectionHarness, activeRows } from "./helpers/collection-harness.mjs";

const row = (id, applyEnd, closedAt = null) => {
  const p = programsFixture(1)[0];
  return { id, source: "egbiz", title: `Synthetic ${id}`, summary: p.summary, target: p.target,
    support_field: p.supportField, region: p.region, apply_end: applyEnd, url: p.url, form_url: null, closed_at: closedAt };
};
function catalogFixture(rows, instant = "2026-09-17T03:00:00.000Z", onFetch) {
  let now = Date.parse(instant);
  const requests = [];
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  // Real installed SDK constructs the query; this offline PostgREST model applies
  // predicates before ordering/limit and records the transport's AbortSignal.
  const client = createClient("https://example.invalid", "fixture-only", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      const url = new URL(String(input)); requests.push({ url, signal: options?.signal });
      if (options?.signal?.aborted) throw new DOMException("fixture aborted", "AbortError");
      const query = url.searchParams;
      let selected = rows.filter((r) => query.get("closed_at") === "is.null" ? r.closed_at === null : true);
      const filter = query.get("or");
      if (filter) {
        assert.match(filter, /^\(apply_end\.is\.null,apply_end\.gte\.\d{4}-\d{2}-\d{2}\)$/);
        const today = filter.slice("(apply_end.is.null,apply_end.gte.".length, -1);
        selected = selected.filter((r) => r.apply_end === null || r.apply_end >= today);
      }
      assert.equal(query.get("order"), "apply_end.asc.nullslast");
      selected = selected.sort((a, b) => (a.apply_end ?? "9999-12-31").localeCompare(b.apply_end ?? "9999-12-31"));
      selected = selected.slice(0, Number(query.get("limit")));
      const columns = query.get("select").split(",");
      onFetch?.({ advance: (ms) => { now += ms; } });
      return Response.json(selected.map((r) => Object.fromEntries(columns.map((key) => [key, r[key]]))));
    } },
  });
  const modules = performanceModules({ globals: { Date: Clock }, mocks: { "lib/supabase/admin.ts": { createAdminClient: () => client } } });
  return { ...modules.load("lib/supabase/programs.ts"), ...modules.load("lib/data/programs.ts"), requests,
    advance: (ms) => { now += ms; } };
}

test("catalog: expired preserved rows cannot crowd a live notice beyond LIMIT 3000", async () => {
  const rows = Array.from({ length: 3000 }, (_, i) => row(`expired-${i}`, "2026-01-01"));
  rows.push(row("live-notice", "2026-12-31"));
  const h = catalogFixture(rows);
  const result = await h.fetchOpenPrograms();
  assert.equal(result.usingSample, false);
  assert.deepEqual(Array.from(result.programs, (p) => p.id), ["live-notice"]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url.searchParams.get("limit"), "3000");
});

test("catalog: actual SDK preserves deadline-day, future and null rows but rejects closed/expired rows", async () => {
  const h = catalogFixture([row("past", "2026-09-16"), row("today", "2026-09-17"), row("future", "2026-09-18"), row("undated", null), row("closed", "2026-12-31", "2026-09-01T00:00:00Z")]);
  const result = await h.getOpenPrograms();
  assert.deepEqual(result.map((p) => p.id), ["today", "future", "undated"]);
  const query = h.requests[0].url.searchParams;
  assert.equal(query.get("or"), "(apply_end.is.null,apply_end.gte.2026-09-17)");
  assert.equal(query.get("closed_at"), "is.null");
  assert.equal(query.get("select"), "id,source,title,summary,target,support_field,region,apply_end,url,form_url");
});

test("catalog: SQL filter date refreshes at KST midnight for each query", async () => {
  const h = catalogFixture([row("today", "2026-09-17"), row("tomorrow", "2026-09-18")], "2026-09-17T14:59:59.999Z");
  assert.deepEqual((await h.getOpenPrograms()).map((p) => p.id), ["today", "tomorrow"]);
  h.advance(1);
  assert.deepEqual((await h.getOpenPrograms()).map((p) => p.id), ["tomorrow"]);
  assert.equal(h.requests[1].url.searchParams.get("or"), "(apply_end.is.null,apply_end.gte.2026-09-18)");
});

test("catalog: post-fetch guard still removes a deadline passed while transport was pending", async () => {
  const h = catalogFixture([row("today", "2026-09-17"), row("tomorrow", "2026-09-18")], "2026-09-17T14:59:59.999Z", ({ advance }) => advance(1));
  const result = await h.fetchOpenPrograms();
  assert.equal(result.usingSample, false);
  assert.deepEqual(Array.from(result.programs, (p) => p.id), ["tomorrow"]);
  assert.equal(h.requests[0].url.searchParams.get("or"), "(apply_end.is.null,apply_end.gte.2026-09-17)");
});

test("catalog: explicit limits, null deadlines and abort propagation remain intact", async () => {
  const h = catalogFixture([row("first", "2026-09-17"), row("second", null)]);
  assert.equal((await h.getOpenPrograms(1)).length, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.getOpenPrograms(1, controller.signal));
  assert.equal(h.requests[1].signal, controller.signal);
});

function brokenLimiter(stage) {
  return performanceModules({
    env: { NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://example.invalid", UPSTASH_REDIS_REST_TOKEN: "fixture-only" },
    mocks: {
      "@upstash/redis": { Redis: class { constructor() { if (stage === "redis") throw new Error("private configuration detail"); } } },
      "@upstash/ratelimit": { Ratelimit: class { static slidingWindow() { return {}; } constructor() { throw new Error("private configuration detail"); } } },
    }, globals: { console: { error() {} } },
  }).load("lib/ratelimit.ts");
}
for (const stage of ["redis", "limiter"]) {
  test(`rate limit: ${stage} construction failure returns controlled 503 without leaking details`, async () => {
    const h = brokenLimiter(stage);
    const result = await h.checkRateLimit(new Request("https://example.invalid"), "match");
    assert.equal(result.ok, false); assert.equal(result.unavailable, true);
    const response = h.tooManyRequests(result.retryAfter, result.unavailable);
    assert.equal(response.status, 503); assert.equal(response.headers.get("Retry-After"), "5");
    assert.ok(!(await response.text()).includes("private configuration detail"));
  });
}

function persistenceFixture(source) {
  return collectionHarness({ rows: activeRows(["A", "still-open-B"]).map((r) => ({ ...r, id: r.id.replace("egbiz:", `${source}:`), source })) });
}
for (const source of ["bizinfo", "kstartup"]) {
  test(`collection: ${source} page failure cannot close an unseen live notice`, async () => {
    const requestedPages = [];
    class Clock extends Date {
      constructor(...args) { super(...(args.length ? args : ["2026-09-17T03:00:00Z"])); }
      static now() { return Date.parse("2026-09-17T03:00:00Z"); }
    }
    const modules = performanceModules({ env: { BIZINFO_KEY: "fixture-only", KSTARTUP_KEY: "fixture-only" },
      globals: { Date: Clock, URLSearchParams, console: { log() {}, warn() {}, error() {} }, fetch: async (input) => {
        const page = Number(new URL(input).searchParams.get(source === "bizinfo" ? "pageIndex" : "page"));
        requestedPages.push(page);
        if (page === 2) throw new Error("synthetic page failure");
        return Response.json(source === "bizinfo"
          ? { jsonArray: page === 1 ? [{ pblancId: "A", pblancNm: "Current A", reqstBeginEndDe: "2026-09-01 ~ 2026-12-31" }] : [] }
          : { matchCount: 501, data: page === 1 ? [{ pbanc_sn: "A", biz_pbanc_nm: "Current A", rcrt_prgs_yn: "Y", pbanc_rcpt_end_dt: "20261231" }] : [] });
      } },
    });
    const fetcher = modules.load(`lib/data/${source}.ts`)[source === "bizinfo" ? "fetchBizinfoOpen" : "fetchKstartupOpen"];
    const programs = await fetcher();
    assert.ok(requestedPages.includes(2)); assert.equal(programs.length, 1);
    const db = persistenceFixture(source);
    const result = await db.load("lib/supabase/programs.ts").upsertAndDiff(source, programs, new Date("2026-09-17T03:00:00Z"));
    assert.equal(result.seen, 1); assert.equal(result.closed, 0);
    assert.equal(db.rows.get(`${source}:still-open-B`).closed_at, null);
    assert.ok(!db.calls.includes("update"));
  });
  test(`collection: ${source} partial direct persistence preserves prior rows even without fetcher guards`, async () => {
    const db = persistenceFixture(source);
    const program = { ...programsFixture(1)[0], id: `${source}:A`, source };
    const result = await db.load("lib/supabase/programs.ts").upsertAndDiff(source, [program], new Date("2026-09-17T03:00:00Z"));
    assert.equal(result.closed, 0);
    assert.equal(db.rows.get(`${source}:still-open-B`).closed_at, null);
    assert.ok(!db.calls.includes("update"));
  });
}
