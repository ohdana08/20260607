import test from "node:test";
import assert from "node:assert/strict";
import { collectionHarness, listing, activeRows, collectAndPersist } from "./helpers/collection-harness.mjs";

test("successful EGBIZ collection updates seen rows without closing unseen ones", async () => {
  const h = collectionHarness({ rows: activeRows(["A", "ended"]), fetch: async () => new Response(listing(["A"])) });
  const result = await collectAndPersist(h);
  assert.equal(result.seen, 1);
  assert.equal(result.closed, 0);
  assert.equal(h.rows.get("egbiz:A").closed_at, null);
  assert.equal(h.rows.get("egbiz:ended").closed_at, null);
  assert.ok(!h.calls.includes("update"));
});

test("first-page failure never reaches persistence", async () => {
  const h = collectionHarness({ rows: activeRows(["A", "B"]), fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(collectAndPersist(h));
  assert.equal(h.calls.length, 0);
  assert.equal(h.rows.get("egbiz:B").closed_at, null);
});

test("a failed later page must not close an unseen active program", async () => {
  const h = collectionHarness({
    rows: activeRows(["A", "B"]),
    fetch: async (page) => {
      if (page === 2) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }) });
      return new Response(listing(["A"], 11));
    },
  });
  let failure;
  try { await collectAndPersist(h); } catch (error) { failure = error; }
  assert.equal(h.rows.get("egbiz:B").closed_at, null, "failed page is missing data, not a closed notice");
  assert.ok(failure, "reject the incomplete snapshot");
  assert.equal(h.calls.length, 0);
});

test("HTTP 200 without the expected list cannot be accepted as a successful snapshot", async () => {
  const h = collectionHarness({ fetch: async () => new Response("<html>Maintenance</html>") });
  await assert.rejects(collectAndPersist(h));
  assert.equal(h.calls.length, 0);
});

test("a later page with changed markup must not close unseen active rows", async () => {
  const h = collectionHarness({ rows: activeRows(["A", "B"]), fetch: async (page) => new Response(page === 1 ? listing(["A"], 11) : "<html>Maintenance</html>") });
  let failure;
  try { await collectAndPersist(h); } catch (error) { failure = error; }
  assert.equal(h.rows.get("egbiz:B").closed_at, null);
  assert.ok(failure);
  assert.equal(h.calls.length, 0);
});

test("a list larger than the page cap is not an exhaustive snapshot", async () => {
  const h = collectionHarness({ rows: activeRows(["A", "B"]), fetch: async () => new Response(listing(["A"], 201)) });
  await assert.rejects(collectAndPersist(h));
  assert.equal(h.calls.length, 0);
});

test("a complete two-page response saves every notice", async () => {
  const ids = Array.from({ length: 11 }, (_, i) => `notice-${i}`);
  const h = collectionHarness({ fetch: async (page) => new Response(listing(page === 1 ? ids.slice(0, 10) : ids.slice(10), 11)) });
  const result = await collectAndPersist(h);
  assert.equal(result.seen, 11);
  assert.equal(h.rows.size, 11);
});

test("duplicates replacing unseen notices cannot pass the total check", async () => {
  const h = collectionHarness({ rows: activeRows(["B"]), fetch: async () => new Response(listing(["A"], 11)) });
  await assert.rejects(collectAndPersist(h), /INCOMPLETE_SNAPSHOT/);
  assert.equal(h.calls.length, 0);
});

test("changing totals between pages aborts the snapshot", async () => {
  const h = collectionHarness({ fetch: async (page) => new Response(listing(["A"], page === 1 ? 11 : 12)) });
  await assert.rejects(collectAndPersist(h), /INCOMPLETE_SNAPSHOT/);
  assert.equal(h.calls.length, 0);
});

test("valid empty list preserves old rows through the existing zero guard", async () => {
  const h = collectionHarness({ rows: activeRows(["A"]), fetch: async () => new Response(listing([])) });
  const result = await collectAndPersist(h);
  assert.equal(result.seen, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.rows.get("egbiz:A").closed_at, null);
});

test("procurement exclusions do not invalidate source completeness", async () => {
  const html = listing(["A", "B"]).replace("경기 창업 지원사업", "글로벌 전시 운영 대행사 모집");
  const h = collectionHarness({ fetch: async () => new Response(html) });
  const result = await collectAndPersist(h);
  assert.equal(result.seen, 1);
  assert.ok(h.rows.has("egbiz:B"));
});

test("HTTP error has bounded diagnostic fields, not the upstream body", async () => {
  const h = collectionHarness({ fetch: async () => new Response("private upstream body", { status: 503 }) });
  let failure;
  try { await collectAndPersist(h); } catch (error) { failure = error; }
  const fields = h.load("lib/data/collectionError.ts").collectionErrorFields(failure);
  assert.equal(fields.errorCode, "HTTP_ERROR");
  assert.equal(fields.httpStatus, 503);
  assert.equal(fields.page, 1);
  assert.ok(!JSON.stringify(fields).includes("private"));
});

test("timeout stays distinguishable from a generic network error", async () => {
  const h = collectionHarness({ fetch: async () => { throw new DOMException("timed out", "TimeoutError"); } });
  await assert.rejects(collectAndPersist(h), /TIMEOUT/);
  assert.ok(h.requests[0].signal instanceof AbortSignal);
  assert.equal(h.calls.length, 0);
});

test("failure while reading response body also prevents persistence", async () => {
  const h = collectionHarness({ fetch: async () => ({ ok: true, text: async () => { throw new TypeError("fetch failed"); } }) });
  await assert.rejects(collectAndPersist(h), /NETWORK_ERROR/);
  assert.equal(h.calls.length, 0);
});

test("collection budget is shared across pages and stops before persistence", async () => {
  const h = collectionHarness({ fetch: async () => { h.advance(35_000); return new Response(listing(["A"], 11)); } });
  await assert.rejects(collectAndPersist(h), /DEADLINE_EXCEEDED/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.calls.length, 0);
});

test("pagination links beyond the cap cannot silently truncate collection", async () => {
  const html = listing(["A"]).replace("<div>타기관", '<a onclick="fn_opMovePage1(21)">마지막</a><div>타기관');
  const h = collectionHarness({ fetch: async () => new Response(html) });
  await assert.rejects(collectAndPersist(h), /PAGE_LIMIT/);
  assert.equal(h.requests.length, 1);
});

const events = (h) => h.logs.filter((log) => typeof log.args[0] === "string" && log.args[0].startsWith("{")).map((log) => JSON.parse(log.args[0]));
const cronRequest = (authorization = "Bearer test-only") => new Request("https://test.invalid/api/cron/collect-programs", { headers: { authorization } });

test("cron retains 200/ok:false and continues other sources on collection failure", async () => {
  const h = collectionHarness({ rows: activeRows(["A", "B"]), fetch: async (page) => {
    if (page === 2) throw new TypeError("fetch failed", { cause: Object.assign(new Error("secret upstream URL"), { code: "ECONNRESET" }) });
    return new Response(listing(["A"], 11));
  } });
  const response = await h.load("app/api/cron/collect-programs/route.ts").GET(cronRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["failures", "ok", "runAt", "summaries"]);
  assert.equal(body.ok, false);
  assert.equal(body.failures[0].source, "egbiz");
  assert.equal(body.summaries[0].source, "nipa");
  assert.equal(h.rows.get("egbiz:B").closed_at, null);
  const failure = events(h).find((event) => event.event === "collection_source_failed");
  assert.equal(failure.stage, "collect");
  assert.equal(failure.networkCode, "ECONNRESET");
  assert.equal(failure.page, 2);
  assert.ok(events(h).every((event) => event.runId === failure.runId));
  assert.ok(!JSON.stringify(h.logs).includes("secret upstream URL"));
});

test("DB failure is recorded at persist, distinct from collection", async () => {
  const h = collectionHarness({ dbError: new Error("private DB detail"), fetch: async () => new Response(listing(["A"])) });
  const response = await h.load("app/api/cron/collect-programs/route.ts").GET(cronRequest());
  assert.equal((await response.json()).ok, false);
  const failure = events(h).find((event) => event.event === "collection_source_failed");
  assert.equal(failure.stage, "persist");
  assert.ok(!JSON.stringify(h.logs).includes("private DB detail"));
});

test("unauthorized cron requests produce no collection or writes", async () => {
  const h = collectionHarness();
  const response = await h.load("app/api/cron/collect-programs/route.ts").GET(cronRequest("Bearer invalid"));
  assert.equal(response.status, 401);
  assert.equal(h.requests.length, 0);
  assert.equal(h.calls.length, 0);
});

test("successful cron preserves response schema and reports counts and duration", async () => {
  const h = collectionHarness({ fetch: async () => new Response(listing(["A"])) });
  const response = await h.load("app/api/cron/collect-programs/route.ts").GET(cronRequest());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.failures.length, 0);
  const event = events(h).find((entry) => entry.event === "collection_source_finished" && entry.source === "egbiz");
  assert.equal(event.seen, 1);
  assert.equal(event.outcome, "success");
  assert.equal(typeof event.durationMs, "number");
  assert.equal(events(h).at(-1).event, "collection_finished");
});

test("an under-reported live total preserves usable rows and logs the discrepancy", async () => {
  const h = collectionHarness({ rows: activeRows(["prior"]), fetch: async () => new Response(listing(["A", "B"], 1)) });
  const summary = await collectAndPersist(h);
  assert.equal(summary.seen, 2);
  assert.equal(summary.closed, 0);
  assert.equal(h.rows.get("egbiz:prior").closed_at, null);
  assert.ok(h.logs.some((entry) => String(entry.args[0]).includes("collection_count_mismatch")));
});

test("storage protects EGBIZ even when a caller supplies a partial array directly", async () => {
  const h = collectionHarness({ rows: activeRows(["A", "B"]) });
  const api = h.load("lib/supabase/programs.ts");
  const program = h.load("lib/data/egbiz.ts").parseEgbizPage(listing(["A"]))[0];
  const summary = await api.upsertAndDiff("egbiz", [program]);
  assert.equal(summary.closed, 0);
  assert.equal(h.rows.get("egbiz:B").closed_at, null);
  assert.ok(!h.calls.includes("update"));
});

test("existing exhaustive sources retain their closure behavior", async () => {
  const rows = activeRows(["A", "ended"]).map((row) => ({ ...row, id: row.id.replace("egbiz:", "nipa:"), source: "nipa" }));
  const h = collectionHarness({ rows, fetch: async () => new Response(listing(["A"])) });
  const summary = await collectAndPersist(h, "nipa");
  assert.equal(summary.closed, 1);
  assert.ok(h.rows.get("nipa:ended").closed_at);
  assert.equal(h.rows.get("nipa:A").closed_at, null);
});

test("bojo keeps its existing protection against closure by absence", async () => {
  const rows = activeRows(["A", "prior"]).map((row) => ({ ...row, id: row.id.replace("egbiz:", "bojo:"), source: "bojo" }));
  const h = collectionHarness({ rows, fetch: async () => new Response(listing(["A"])) });
  assert.equal((await collectAndPersist(h, "bojo")).closed, 0);
  assert.equal(h.rows.get("bojo:prior").closed_at, null);
});
