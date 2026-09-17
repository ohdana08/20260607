import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Independent reviewer harness: do not reuse performance-harness.mjs or its
// synthetic transport. Every runtime import must be explicitly provided.
const root = path.resolve(import.meta.dirname, "..");
function evaluate(file, { before = false, imports = {}, globals = {}, env = {} } = {}) {
  const sourcePath = before ? `tests/fixtures/performance-before/${file}.source` : file;
  const source = readFileSync(path.join(root, sourcePath), "utf8");
  const loaded = { exports: {} };
  const require = (name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
    return imports[name];
  };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, require, process: { env },
    Request, Response, Headers, Date, AbortController, structuredClone,
    setTimeout, clearTimeout, console,
    fetch: () => { throw new Error("Reviewer tests forbid network"); }, ...globals,
  }, { filename: sourcePath });
  return loaded.exports;
}

const request = (token = "reviewer") => new Request("https://review.invalid", {
  headers: { authorization: `Bearer ${token}` },
});
const google = (id = "reviewer", extra = {}) => Response.json({
  id, email: `${id}@review.invalid`, app_metadata: { providers: ["google"] }, ...extra,
});
function auth(options = {}) {
  return evaluate("lib/auth/googleUser.ts", {
    ...options,
    imports: {
      "./config.ts": { AUTH_URL: "https://review.invalid", AUTH_ANON_KEY: "synthetic" },
      "./localReview.ts": { isLocalReviewMatchRequest: () => false },
      "../plan/access.ts": { isMasterCode: () => false },
    },
  });
}
function paidModules(identity, records) {
  const paymentState = evaluate("lib/plan/paymentState.ts");
  const common = {
    "@upstash/redis": { Redis: class { async get(key) { return records.get(key) ?? null; } } },
    "./access": { isMasterCode: () => false },
    "./paymentState": paymentState,
  };
  const env = { UPSTASH_REDIS_REST_URL: "https://review.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic" };
  const word = evaluate("lib/plan/paidAccess.ts", { env,
    imports: { ...common, "@/lib/auth/googleUser": identity },
  });
  const slides = evaluate("lib/plan/presentationAccess.ts", { env,
    imports: { ...common, "./paidAccess": word },
  });
  return { ...word, ...slides };
}

test("review: actual Word and presentation gates observe cancellation and rebinding within one Request", async () => {
  for (const before of [true, false]) {
    let verifications = 0;
    const identity = auth({ before, globals: { fetch: () => { verifications++; return google(); } } });
    const records = new Map([
      ["gp:paid:reviewer", { orderNo: "word", usedProgramId: "first" }],
      ["gp:presentation-paid:reviewer", { orderNo: "slides", usedProgramId: "first" }],
    ]);
    const gates = paidModules(identity, records), req = request();
    assert.equal(await identity.paidGoogleLoginGate(req), null);
    assert.equal((await gates.checkDraftAccess(req, undefined, "first")).ok, true);
    assert.equal((await gates.checkPresentationAccess(req, undefined, "first")).ok, true);
    records.delete("gp:presentation-paid:reviewer");
    assert.equal((await gates.checkPresentationAccess(req, undefined, "first")).reason, "presentation_payment_required");
    records.set("gp:paid:reviewer", { usedProgramId: "second" });
    assert.equal((await gates.checkDraftAccess(req, undefined, "first")).reason, "credit_used");
    records.delete("gp:paid:reviewer");
    assert.equal((await gates.checkDraftAccess(req, undefined, "first")).reason, "payment_required");
    assert.equal((await gates.checkPresentationAccess(req, undefined, "first")).reason, "word_required");
    assert.equal(verifications, before ? 7 : 1);
  }
});

test("review: an older failed token check cannot evict the newer successful token entry", async () => {
  const replies = new Map(); let calls = 0;
  const identity = auth({ globals: { fetch: (_url, options) => {
    calls++;
    return new Promise((resolve) => replies.set(options.headers.Authorization, resolve));
  } } });
  const req = request("old"), old = identity.getGoogleUser(req);
  req.headers.set("authorization", "Bearer new");
  const current = identity.getGoogleUser(req);
  replies.get("Bearer new")(google("new"));
  assert.equal((await current).id, "new");
  replies.get("Bearer old")(new Response(null, { status: 401 }));
  assert.equal(await old, null);
  assert.equal((await identity.getGoogleUser(req)).id, "new");
  assert.equal(calls, 2);
});

test("review: identity and admin authority revalidate at 5000ms; cache scope is the Request", async () => {
  let now = 0, revoked = false, calls = 0;
  class Clock extends Date { static now() { return now; } }
  const identity = auth({ globals: { Date: Clock, fetch: () => {
    calls++;
    return revoked ? new Response(null, { status: 401 }) : google("admin", { app_metadata: { providers: ["google"], role: "admin" } });
  } } });
  const req = request();
  assert.equal((await identity.getGoogleUser(req)).isAdmin, true);
  revoked = true; now = 4999;
  // Explicitly characterize the changed revocation window; it is not zero.
  assert.equal((await identity.getGoogleUser(req)).isAdmin, true);
  assert.equal(await identity.getGoogleUser(request()), null);
  now = 5000;
  assert.equal(await identity.getGoogleUser(req), null);
  assert.equal(calls, 3);
});

test("review: all region names preserve before behavior at gap, newline, Unicode and own-region boundaries", () => {
  const old = evaluate("lib/match/buttonFilter.ts", { before: true });
  const next = evaluate("lib/match/buttonFilter.ts");
  const names = "서울 부산 대구 인천 광주 대전 울산 세종 경기 강원 충북 충남 전북 전남 경북 경남 제주 서귀포 판교 창원 전주 청주 천안 춘천 포항".split(" ");
  const gaps = ["", " ", "에 ", "\n", "\r", "\u2028", "😀", "가".repeat(10), "가".repeat(11)];
  const endings = ["소재", "거주", "주소지", "사업장", "관내", "한정", "시민", "도민", "주민", "이전 예정", "이전 필수", "설명회"];
  let compared = 0;
  for (const user of [null, "", "X", ...names.slice(0, 17)]) {
    for (const name of names) for (const gap of gaps) for (const suffix of endings) {
      for (const own of ["", " 전국", " 부산"]) {
        const p = { title: `${name}${gap}${suffix}`, target: own };
        assert.equal(next.regionConflict(p, user), old.regionConflict(p, user), JSON.stringify({ p, user }));
        compared++;
      }
    }
  }
  assert.equal(compared, 162000);
});

for (const pathKind of ["shared", "lease-race", "waiter"]) {
  test(`review: ${pathKind} promotion respects freshness, stale expiry and nested output isolation`, async () => {
    for (const before of [true, false]) {
      let now = 100, reads = 0, down = false;
      class Clock extends Date { static now() { return now; } }
      const { SnapshotCache } = evaluate("lib/scale/snapshotCache.ts", {
        before, globals: { Date: Clock }, imports: { "node:crypto": { randomUUID } },
      });
      const snapshot = { value: { nested: { revision: 1 } }, freshUntil: 110, staleUntil: 120 };
      const store = {
        async read() {
          reads++;
          if (down) throw new Error("synthetic store outage");
          return pathKind !== "shared" && reads === 1 ? null : snapshot;
        },
        async acquire() { return pathKind === "lease-race"; },
        async release() {},
        async publish() { throw new Error("Unexpected publish"); },
      };
      const cache = new SnapshotCache(store, async () => { throw new Error("Unexpected load"); }, {
        freshMs: 10, staleMs: 20, localMs: 100, loadMs: 10, leaseMs: 30, waitMs: 200,
      });
      const first = await cache.get(); first.nested.revision = 99;
      now = 109; assert.equal((await cache.get()).nested.revision, 1);
      now = 110; const previousReads = reads;
      assert.equal((await cache.get()).nested.revision, 1);
      assert.ok(reads > previousReads, "freshUntil must force the shared path");
      down = true; now = 119;
      assert.equal((await cache.get()).nested.revision, 1);
      now = 120;
      await assert.rejects(cache.get(), /catalog temporarily unavailable/);
    }
  });
}

test("review: narrowed DB selection preserves all mapped fields including nulls and ignores extra fields", async () => {
  const row = {
    id: "kstartup:1", source: "kstartup", title: "제주 소재", summary: "review", target: "초기 기업",
    support_field: "기술", region: "전국", apply_end: null, url: "https://review.invalid/p", form_url: null,
    external_id: "1", last_seen_at: "2026-09-17", extra_internal_field: "must not leak",
  };
  const results = [];
  for (const before of [true, false]) {
    let selected, table, filter, dateFilter, order, limit, capturedSignal;
    const query = {
      select(value) { selected = value; return this; },
      is(...args) { filter = args; return this; },
      or(value) { dateFilter = value; return this; },
      order(...args) { order = args; return this; },
      limit(value) { limit = value; return this; },
      abortSignal(value) { capturedSignal = value; return this; },
      then(resolve) {
        const data = selected === "*" ? row : Object.fromEntries(selected.split(",").map((key) => [key, row[key]]));
        return Promise.resolve({ data: [data], error: null }).then(resolve);
      },
    };
    const db = evaluate("lib/supabase/programs.ts", { before, imports: {
      "./admin": { createAdminClient: () => ({ from(value) { table = value; return query; } }) },
      "@/lib/data/openFilter": evaluate("lib/data/openFilter.ts"),
    } });
    const controller = new AbortController();
    results.push(JSON.parse(JSON.stringify(await db.getOpenPrograms(17, controller.signal))));
    assert.equal(table, "programs"); assert.deepEqual(filter, ["closed_at", null]);
    assert.equal(order[0], "apply_end"); assert.equal(order[1].ascending, true); assert.equal(order[1].nullsFirst, false);
    assert.equal(limit, 17); assert.equal(capturedSignal, controller.signal);
    if (!before) assert.match(dateFilter, /^apply_end\.is\.null,apply_end\.gte\.20\d{2}-\d{2}-\d{2}$/);
  }
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(Object.keys(results[1][0]).sort(), ["id", "source", "title", "summary", "target", "supportField", "region", "applyEnd", "url", "formUrl"].sort());
  assert.equal(results[1][0].applyEnd, null); assert.equal(results[1][0].formUrl, null);
});

test("review: each preserved baseline file still matches its recorded SHA-256", () => {
  const base = path.join(root, "tests/fixtures/performance-before");
  const manifest = JSON.parse(readFileSync(path.join(base, "manifest.json"), "utf8"));
  for (const [file, expected] of Object.entries(manifest)) {
    assert.equal(createHash("sha256").update(readFileSync(path.join(base, `${file}.source`))).digest("hex"), expected);
  }
});

test("review: KST midnight is independent of host timezone and does not freeze module-load date", () => {
  const originalTZ = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Seoul", "America/Los_Angeles", "Pacific/Auckland"]) {
      process.env.TZ = timezone;
      let now = Date.parse("2026-09-17T14:59:59.999Z"), constructions = 0;
      class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      }
      class Formatter extends Intl.DateTimeFormat { constructor(...args) { super(...args); constructions++; } }
      const filter = evaluate("lib/data/openFilter.ts", { globals: { Date: Clock, Intl: { DateTimeFormat: Formatter } } });
      assert.equal(filter.kstToday(), "2026-09-17", timezone);
      assert.equal(filter.isStillOpen("2026-09-17"), true);
      now++;
      assert.equal(filter.kstToday(), "2026-09-18", timezone);
      assert.equal(filter.isStillOpen("2026-09-17"), false);
      assert.equal(filter.isStillOpen("2026-09-18"), true);
      assert.equal(filter.isStillOpen(null), true);
      assert.equal(constructions, 1);
    }
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test("review: actual catalog pipeline evaluates deadlines after an upstream delay crossing KST midnight", async () => {
  let now = Date.parse("2026-09-17T14:59:59.999Z"), release;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const filter = evaluate("lib/data/openFilter.ts", { globals: { Date: Clock } });
  const dedupe = evaluate("lib/data/dedupePrograms.ts");
  const row = (id, applyEnd) => ({ id, title: id, applyEnd, source: "kstartup", summary: "", target: "", formUrl: null });
  const catalog = evaluate("lib/data/programs.ts", { imports: {
    "./sample": { SAMPLE_PROGRAMS: [row("fallback", null)] },
    "./catalogCache": { getCatalogPrograms: () => new Promise((resolve) => { release = resolve; }) },
    "./openFilter": filter, "./dedupePrograms": dedupe,
  } });
  const pending = catalog.fetchOpenPrograms();
  now = Date.parse("2026-09-17T15:00:00.001Z");
  release([row("expired", "2026-09-17"), row("still-open", "2026-09-18"), row("ongoing", null)]);
  const result = await pending;
  assert.equal(result.usingSample, false);
  assert.deepEqual(Array.from(result.programs, (p) => p.id), ["still-open", "ongoing"]);
});

test("review: empty or all-expired catalog falls back using the current KST date", async () => {
  let now = Date.parse("2026-09-17T14:59:59.999Z");
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const filter = evaluate("lib/data/openFilter.ts", { globals: { Date: Clock } });
  const dedupe = evaluate("lib/data/dedupePrograms.ts");
  const row = (id, applyEnd) => ({ id, title: id, applyEnd, source: "sample", summary: "", target: "", formUrl: null });
  let rows = [];
  const catalog = evaluate("lib/data/programs.ts", { imports: {
    "./sample": { SAMPLE_PROGRAMS: [row("sample-expiring", "2026-09-17"), row("sample-open", "2026-09-18"), row("sample-ongoing", null)] },
    "./catalogCache": { getCatalogPrograms: async () => rows },
    "./openFilter": filter, "./dedupePrograms": dedupe,
  } });
  const beforeMidnight = await catalog.fetchOpenPrograms();
  assert.equal(beforeMidnight.usingSample, true); assert.equal(beforeMidnight.programs.length, 3);
  now = Date.parse("2026-09-17T15:00:00.001Z");
  for (const sourceRows of [[], [row("live-expired", "2026-09-17")]]) {
    rows = sourceRows;
    const result = await catalog.fetchOpenPrograms();
    assert.equal(result.usingSample, true);
    assert.deepEqual(Array.from(result.programs, (p) => p.id), ["sample-open", "sample-ongoing"]);
  }
});
