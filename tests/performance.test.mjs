import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performanceModules, programsFixture, profilesFixture, authHarness, catalogHarness, cachePromotionScenario, baselineRoot, digest } from "./helpers/performance-harness.mjs";

const request = (token = "fixture") => new Request("https://example.invalid/api/plan/draft-batch", { headers: { Authorization: `Bearer ${token}` } });
const googleReply = (overrides = {}) => Response.json({ id: "fixture-user", email: "fixture@example.invalid", app_metadata: { providers: ["google"] }, ...overrides });

test("before sources remain immutable (hash manifest)", () => {
  const manifest = JSON.parse(readFileSync(path.join(baselineRoot, "manifest.json"), "utf8"));
  for (const [file, hash] of Object.entries(manifest)) assert.equal(createHash("sha256").update(readFileSync(path.join(baselineRoot, file + ".source"))).digest("hex"), hash, file);
});

test("actual paid login gate and access check share one verification with identical results", async () => {
  for (const before of [true, false]) {
    const h = authHarness({ before }), req = request();
    assert.equal(await h.paidGoogleLoginGate(req), null);
    assert.equal((await h.checkDraftAccess(req, undefined, "program")).ok, true);
    assert.equal(h.calls, before ? 2 : 1); assert.equal(h.paidReads, 1);
    assert.ok(h.requests.every(({ options }) => options.cache === "no-store"));
  }
});
test("concurrent checks deduplicate without sharing a mutable user object", async () => {
  const h = authHarness({ latency: 2 }), req = request();
  const users = await Promise.all(Array.from({ length: 25 }, () => h.getGoogleUser(req)));
  assert.equal(h.calls, 1); users[0].isAdmin = true;
  assert.equal(users[1].isAdmin, false); assert.equal((await h.getGoogleUser(req)).isAdmin, false);
});
test("distinct requests with the same token always revalidate", async () => {
  const h = authHarness(); await h.getGoogleUser(request()); await h.getGoogleUser(request()); assert.equal(h.calls, 2);
});
test("mutating or removing the authorization header invalidates the request entry", async () => {
  const h = authHarness(), req = request("first"); await h.getGoogleUser(req);
  req.headers.set("Authorization", "Bearer second"); await h.getGoogleUser(req); assert.equal(h.calls, 2);
  req.headers.delete("Authorization"); assert.equal(await h.getGoogleUser(req), null);
  req.headers.set("Authorization", "Bearer second"); await h.getGoogleUser(req); assert.equal(h.calls, 3);
});
test("a long-running request revalidates at the five-second boundary", async () => {
  let now = 0; class Clock extends Date { static now() { return now; } }
  const h = authHarness({ clock: Clock }), req = request(); await h.getGoogleUser(req);
  now = 4999; await h.getGoogleUser(req); assert.equal(h.calls, 1);
  now = 5000; await h.getGoogleUser(req); assert.equal(h.calls, 2);
});
test("an old pending failure cannot erase a successful replacement token verification", async () => {
  let finishOld;
  const oldReply = new Promise((resolve) => { finishOld = resolve; });
  const h = authHarness({ reply: (calls) => calls === 1 ? oldReply : googleReply({ id: "replacement-user" }) });
  const req = request("old"), pending = h.getGoogleUser(req);
  req.headers.set("Authorization", "Bearer replacement");
  assert.equal((await h.getGoogleUser(req)).id, "replacement-user");
  finishOld(new Response(null, { status: 401 }));
  assert.equal(await pending, null);
  assert.equal((await h.getGoogleUser(req)).id, "replacement-user");
  assert.equal(h.calls, 2);
});
test("five-second revalidation denies a revoked session and leaves the next check retryable", async () => {
  let now = 0; class Clock extends Date { static now() { return now; } }
  const h = authHarness({ clock: Clock, reply: (calls) => calls === 2 ? new Response(null, { status: 401 }) : googleReply() });
  const req = request();
  assert.equal(await h.googleLoginGate(req), null);
  now = 4999; assert.equal(await h.googleLoginGate(req), null); assert.equal(h.calls, 1);
  now = 5000; assert.equal((await h.googleLoginGate(req)).status, 401); assert.equal(h.calls, 2);
  assert.equal(await h.googleLoginGate(req), null); assert.equal(h.calls, 3);
});
test("five-second revalidation observes administrator removal before granting paid access", async () => {
  let now = 0; class Clock extends Date { static now() { return now; } }
  const h = authHarness({ clock: Clock, reply: (calls) => googleReply({ app_metadata: { providers: ["google"], is_admin: calls === 1 } }) });
  const req = request();
  assert.equal((await h.checkDraftAccess(req)).admin, true); assert.equal(h.paidReads, 0);
  now = 4999; assert.equal((await h.checkDraftAccess(req)).admin, true); assert.equal(h.calls, 1);
  now = 5000;
  const access = await h.checkDraftAccess(req);
  assert.equal(access.ok, true); assert.equal(access.admin, false); assert.equal(access.user.isAdmin, false);
  assert.equal(h.calls, 2); assert.equal(h.paidReads, 1);
});
for (const failure of ["unauthorized", "network", "bad-json", "non-google"]) {
  test(`failed verification (${failure}) remains denied and can retry`, async () => {
    const h = authHarness({ reply: (calls) => {
      if (calls > 1) return googleReply();
      if (failure === "network") throw new Error("offline");
      if (failure === "bad-json") return new Response("invalid-json");
      if (failure === "non-google") return googleReply({ app_metadata: { providers: ["email"] } });
      return new Response(null, { status: 401 });
    } });
    const req = request(); assert.equal((await h.googleLoginGate(req)).status, 401);
    assert.equal((await h.getGoogleUser(req)).id, "fixture-user"); assert.equal(h.calls, 2);
  });
}
test("user-editable metadata cannot grant admin; trusted metadata retains the existing bypass", async () => {
  const untrusted = authHarness({ reply: () => googleReply({ user_metadata: { is_admin: true } }) });
  assert.equal((await untrusted.getGoogleUser(request())).isAdmin, false);
  const admin = authHarness({ reply: () => googleReply({ app_metadata: { providers: ["google"], is_admin: true } }) });
  assert.equal((await admin.checkDraftAccess(request())).admin, true); assert.equal(admin.paidReads, 0);
});
test("paid entitlement is read again even when request identity is reused", async () => {
  const h = authHarness(), req = request();
  await h.checkDraftAccess(req); await h.checkDraftAccess(req);
  assert.equal(h.calls, 1); assert.equal(h.paidReads, 2);
});

const original = performanceModules({ before: true }).load("lib/match/buttonFilter.ts");
const optimized = performanceModules().load("lib/match/buttonFilter.ts");
test("full recommendation output, ordering and input immutability match the baseline", () => {
  for (const size of [0, 1, 30, 300, 3000]) {
    const programs = programsFixture(size), inputDigest = digest(programs);
    for (const profile of profilesFixture) assert.equal(digest(optimized.matchByButtons(programs, profile)), digest(original.matchByButtons(programs, profile)));
    assert.equal(digest(programs), inputDigest);
  }
});
test("region exclusions preserve mainland/subregion/unknown/own-region and repeated-call semantics", () => {
  const regions = [null, "", "부산", "경기", "제주", "전북", "X"];
  const names = ["제주", "서귀포", "판교", "부산", "전주", "서울", "춘천", "포항"];
  const suffixes = [" 소재 기업", "에 거주", " 이전 예정", " 사업장", " 시민 대상", " 설명회", "\n소재", "이름이 아주 길어 열글자를 넘기는 소재"];
  for (const sido of regions) for (const name of names) for (const suffix of suffixes) for (const target of ["", "전국 기업", "부산 기업"]) {
    const program = { title: name + suffix, target };
    for (let i = 0; i < 2; i++) assert.equal(optimized.regionConflict(program, sido), original.regionConflict(program, sido));
  }
});
test("warm matching creates no RegExp objects", () => {
  let count = 0; class Counted extends RegExp { constructor(...args) { super(...args); count++; } }
  const { matchByButtons } = performanceModules({ globals: { RegExp: Counted } }).load("lib/match/buttonFilter.ts");
  assert.equal(count, 25); count = 0;
  matchByButtons(programsFixture(3000), profilesFixture[0]); assert.equal(count, 0);
});
test("Supabase SDK sends one narrowed query with equivalent program output", async () => {
  const before = catalogHarness({ before: true }), after = catalogHarness();
  const signal = new AbortController().signal;
  assert.equal(digest(await after.getOpenPrograms(3000, signal)), digest(await before.getOpenPrograms(3000, signal)));
  assert.equal(after.requests.length, 1);
  const query = after.requests[0].url.searchParams;
  assert.equal(query.get("select"), "id,source,title,summary,target,support_field,region,apply_end,url,form_url");
  assert.equal(query.get("closed_at"), "is.null"); assert.equal(query.get("order"), "apply_end.asc.nullslast");
  assert.equal(query.get("limit"), "3000"); assert.ok(after.requests[0].signal);
  assert.ok(after.responseBytes < before.responseBytes);
});
test("catalog still preserves empty data, explicit limits and error propagation", async () => {
  assert.equal((await catalogHarness({ size: 0 }).getOpenPrograms()).length, 0);
  assert.equal((await catalogHarness().getOpenPrograms(7)).length, 7);
  await assert.rejects(catalogHarness({ error: { code: "fixture-error", message: "test" } }).getOpenPrograms());
});
test("deadline filtering reuses one formatter while evaluating a new KST date across midnight", () => {
  let now = Date.parse("2026-09-17T14:59:59.999Z"), constructions = 0;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class CountedFormatter extends Intl.DateTimeFormat {
    constructor(locale, options) {
      super(locale, options); constructions++;
      assert.equal(locale, "en-CA"); assert.equal(options.timeZone, "Asia/Seoul");
    }
  }
  const { kstToday, isStillOpen } = performanceModules({ globals: { Date: Clock, Intl: { DateTimeFormat: CountedFormatter } } }).load("lib/data/openFilter.ts");
  assert.equal(constructions, 1); assert.equal(kstToday(), "2026-09-17");
  assert.equal(isStillOpen(null), true); assert.equal(isStillOpen(""), true);
  assert.equal(isStillOpen("2026-09-16"), false); assert.equal(isStillOpen("2026-09-17"), true);
  assert.equal(isStillOpen("2026-09-18"), true);
  for (let i = 0; i < 2400; i++) assert.equal(isStillOpen("2026-09-17"), true);
  now++;
  assert.equal(kstToday(), "2026-09-18"); assert.equal(isStillOpen("2026-09-17"), false);
  assert.equal(isStillOpen("2026-09-18"), true); assert.equal(isStillOpen("2026-09-19"), true);
  assert.equal(isStillOpen(null), true); assert.equal(constructions, 1);
});
test("a formatting failure propagates without retaining a failed or stale date", () => {
  let now = Date.parse("2026-09-17T14:59:59.999Z"), fail = false, constructions = 0, formats = 0;
  class Clock extends Date { constructor() { super(now); } }
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" });
  class UnreliableFormatter {
    constructor() { constructions++; }
    format(date) { formats++; if (fail) throw new RangeError("fixture formatter failure"); return formatter.format(date); }
  }
  const { kstToday, isStillOpen } = performanceModules({ globals: { Date: Clock, Intl: { DateTimeFormat: UnreliableFormatter } } }).load("lib/data/openFilter.ts");
  assert.equal(kstToday(), "2026-09-17");
  fail = true;
  assert.throws(() => isStillOpen("2026-09-17"), /fixture formatter failure/);
  assert.equal(isStillOpen(null), true); assert.equal(formats, 2);
  fail = false; now++;
  assert.equal(kstToday(), "2026-09-18"); assert.equal(isStillOpen("2026-09-17"), false);
  assert.equal(constructions, 1);
});
for (const kind of ["acquire-race", "wait-for-owner"]) {
  test(`cache promotion (${kind}) avoids a redundant read without an extra DB load`, async () => {
    const before = await cachePromotionScenario(true, kind), after = await cachePromotionScenario(false, kind);
    assert.equal(before.readsAfterPromotion, 1); assert.equal(after.readsAfterPromotion, 0);
    assert.equal(after.loads, 0); assert.equal(digest(before.first), digest(after.first));
  });
}
test("cache L1 promotion cannot extend freshness or expose mutable shared data", async () => {
  let now = 1000, reads = 0;
  class Clock extends Date { static now() { return now; } }
  const { SnapshotCache } = performanceModules({ globals: { Date: Clock } }).load("lib/scale/snapshotCache.ts");
  const snapshot = { value: { version: 1 }, freshUntil: 1010, staleUntil: 1200 };
  const cache = new SnapshotCache({
    async read() { reads++; return snapshot; }, async acquire() { return false; }, async release() {}, async publish() { return false; },
  }, async () => { throw new Error("unexpected DB load"); });
  const first = await cache.get(); first.version = 99; now = 1009;
  assert.equal((await cache.get()).version, 1); assert.equal(reads, 1);
  now = 1010; await cache.get(); assert.equal(reads, 2);
});

for (const kind of ["shared", "acquire-race", "wait-for-owner", "publish"]) {
  for (const [boundary, freshMs, localMs] of [["local lifetime", 100, 10], ["snapshot freshness", 10, 100]]) {
    test(`cache promotion (${kind}) respects ${boundary}, copies values and releases only its own lease`, async () => {
      let now = 1000, reads = 0, acquires = 0, loads = 0, publishes = 0, releases = 0;
      class Clock extends Date { static now() { return now; } }
      const { SnapshotCache } = performanceModules({ globals: { Date: Clock } }).load("lib/scale/snapshotCache.ts");
      const value = { nested: { version: 1 } };
      const fresh = { value, freshUntil: now + freshMs, staleUntil: now + 500 };
      let available = kind === "shared" ? fresh : null;
      const cache = new SnapshotCache({
        async read() {
          reads++;
          if (reads === 2 && (kind === "acquire-race" || kind === "wait-for-owner")) available = fresh;
          return available;
        },
        async acquire() { acquires++; return kind !== "wait-for-owner" || acquires > 1; },
        async publish(_token, snapshot) { publishes++; available = snapshot; return true; },
        async release() { releases++; },
      }, async () => { loads++; return value; },
      { freshMs, staleMs: 500, localMs, loadMs: 200, leaseMs: 300, waitMs: 200 });

      const first = await cache.get(); first.nested.version = 99;
      assert.equal(loads, kind === "publish" ? 1 : 0);
      assert.equal(publishes, kind === "publish" ? 1 : 0);
      assert.equal(releases, kind === "acquire-race" || kind === "publish" ? 1 : 0);
      const readsAtPromotion = reads, loadsAtPromotion = loads;
      now = 1000 + Math.min(freshMs, localMs) - 1;
      assert.equal((await cache.get()).nested.version, 1); assert.equal(reads, readsAtPromotion);
      now++;
      assert.equal((await cache.get()).nested.version, 1);
      assert.ok(reads > readsAtPromotion, "the exact boundary must consult the shared store");
      assert.equal(loads, loadsAtPromotion + (freshMs < localMs ? 1 : 0));
    });
  }
}
for (const warm of [false, true]) {
  test(`a lost publish lease never promotes an uncommitted value (${warm ? "stale fallback" : "cold cache"})`, async () => {
    let now = 1000, reads = 0, loads = 0, publishes = 0, releases = 0;
    class Clock extends Date { static now() { return now; } }
    const { SnapshotCache, SnapshotUnavailable } = performanceModules({ globals: { Date: Clock } }).load("lib/scale/snapshotCache.ts");
    const stale = { value: { version: "last-good" }, freshUntil: 999, staleUntil: 1010 };
    const cache = new SnapshotCache({
      async read() { reads++; return warm ? stale : null; }, async acquire() { return true; },
      async publish() { publishes++; return false; }, async release() { releases++; },
    }, async () => { loads++; return { version: "uncommitted" }; });

    if (warm) assert.equal((await cache.get()).version, "last-good");
    else await assert.rejects(cache.get(), SnapshotUnavailable);
    assert.equal(loads, 1); assert.equal(publishes, 1); assert.equal(releases, 1);
    const readsAfterFailure = reads;
    now = 1009;
    if (warm) assert.equal((await cache.get()).version, "last-good");
    else await assert.rejects(cache.get(), SnapshotUnavailable);
    assert.equal(reads, readsAfterFailure, "failure backoff must not trigger another source load");
    now = 1010;
    await assert.rejects(cache.get(), SnapshotUnavailable);
    assert.equal(loads, 1); assert.equal(publishes, 1);
  });
}
