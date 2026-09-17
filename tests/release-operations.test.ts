import test from "node:test";
import assert from "node:assert/strict";
import { initialMonth, InputError, parseVideo } from "../lib/operations/domain.ts";
import { operationsRequest, type OperationsEvent } from "../lib/operations/http.ts";

test("video enum accepts only scalar strings, not arrays with matching string conversions", () => {
  const video = { id: "v1", title: "test", plannedDate: "2026-09-17", product: "word", status: "planned", url: "", views24h: null, views72h: null };
  for (const override of [{ product: ["word"] }, { status: ["planned"] }])
    assert.throws(() => parseVideo({ ...video, ...override }, "2026-09"), InputError);
  assert.equal(parseVideo(video, "2026-09").product, "word");
});

test("operations failure is correlated and records phase without secrets or customer payload", async () => {
  const events: OperationsEvent[] = [];
  const response = await operationsRequest(new Request("https://release.invalid/api/operations?secret=PRIVATE", { headers: { authorization: "Bearer PRIVATE", "x-request-id": "attacker" } }), {
    authenticate: async () => ({ id: "PRIVATE", isAdmin: true }),
    store: () => ({ read: async () => { throw new Error("PRIVATE database credential"); }, compareAndSet: async () => null }),
    observe: (event) => { events.push(event); },
  });
  assert.equal(response.status, 503);
  assert.equal(events.length, 1);
  assert.equal(events[0].phase, "read");
  assert.equal(events[0].requestId, response.headers.get("x-request-id"));
  assert.notEqual(events[0].requestId, "attacker");
  assert.ok(events[0].durationMs >= 0);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|attacker/);
  assert.doesNotMatch(await response.text(), /PRIVATE/);
});

test("observability failure does not change the success of an atomic mutation", async () => {
  let stored = initialMonth("2026-09");
  const response = await operationsRequest(new Request("https://release.invalid/api/operations", {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ month: "2026-09", expectedRevision: 0, command: { kind: "goal", value: { ...stored.goal, targetKrw: 2000000 } } }),
  }), {
    authenticate: async () => ({ id: "operator", isAdmin: true }),
    store: () => ({ read: async () => stored, compareAndSet: async (_month, _revision, next) => { stored = next; return structuredClone(stored); } }),
    observe() { throw new Error("offline sink"); },
  });
  assert.equal(response.status, 200);
  assert.equal(stored.goal.targetKrw, 2000000);
  assert.equal(stored.revision, 1);
});
