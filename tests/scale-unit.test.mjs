import test from "node:test";
import assert from "node:assert/strict";
import { loadScaleModule } from "./helpers/scale-harness.mjs";

function rateHarness(outcome, env = { NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://test.invalid", UPSTASH_REDIS_REST_TOKEN: "test-only" }) {
  return loadScaleModule("lib/ratelimit.ts", {
    "@upstash/redis": { Redis: class {} },
    "@upstash/ratelimit": { Ratelimit: class {
      static slidingWindow() { return {}; }
      async limit() { if (outcome instanceof Error) throw outcome; return outcome; }
    } },
  }, env);
}
const request = new Request("https://test.invalid", { headers: { "x-forwarded-for": "127.0.0.1" } });
test("rate limit: SDK timeout cannot pass as success", async () => {
  const h = rateHarness({ success: true, reason: "timeout" });
  const result = await h.checkRateLimit(request, "planDraft");
  assert.equal(result.ok, false);
  assert.equal(h.tooManyRequests(result.retryAfter, result.unavailable).status, 503);
});
test("rate limit: unavailable Redis rejects with retry instruction", async () => {
  const h = rateHarness(new Error("unavailable"));
  const result = await h.checkRateLimit(request, "match");
  assert.equal(result.unavailable, true);
  assert.equal(h.tooManyRequests(result.retryAfter, result.unavailable).headers.get("Retry-After"), "5");
});
test("rate limit: production config omission closes the gate", async () => {
  assert.equal((await rateHarness(null, { NODE_ENV: "production" }).checkRateLimit(request, "chat")).ok, false);
});
test("rate limit: development without credentials still runs", async () => {
  assert.equal((await rateHarness(null, { NODE_ENV: "development" }).checkRateLimit(request, "chat")).ok, true);
});
test("rate limit: ordinary denial stays 429 and success stays allowed", async () => {
  const h = rateHarness({ success: false, reset: Date.now() + 10000 });
  const result = await h.checkRateLimit(request, "match");
  assert.equal(h.tooManyRequests(result.retryAfter, result.unavailable).status, 429);
  assert.equal((await rateHarness({ success: true }).checkRateLimit(request, "match")).ok, true);
});

const jobs = loadScaleModule("lib/scale/jobs.ts");
function workerStore(overrides = {}) {
  const calls = [];
  return { calls, async claim() { return { id: "job", lease_token: "attempt-1", runtime_deadline: new Date(Date.now() + 1000).toISOString() }; },
    async heartbeat() { calls.push("heartbeat"); return true; }, async complete() { calls.push("complete"); return true; },
    async fail(...args) { calls.push(["fail", ...args]); return true; }, ...overrides };
}
test("worker commits an immutable result pointer on successful execution", async () => {
  const store = workerStore();
  assert.equal(await jobs.processOneJob(store, "word", async () => ({ artifactKey: "jobs/job/attempt-1.docx" })), "succeeded");
  assert.deepEqual(store.calls, ["complete"]);
});
test("worker marks permanent errors without retrying arbitrary exceptions", async () => {
  const store = workerStore();
  assert.equal(await jobs.processOneJob(store, "word", async () => { throw new Error("private source content"); }), "failed");
  assert.equal(store.calls[0][3], "HANDLER_FAILED");
  assert.equal(store.calls[0][4], false);
});
test("worker uses explicit classification for transient failures", async () => {
  const store = workerStore();
  await jobs.processOneJob(store, "word", async () => { throw new jobs.JobFailure("PROVIDER_BUSY", true); });
  assert.equal(store.calls[0][3], "PROVIDER_BUSY");
  assert.equal(store.calls[0][4], true);
});
test("worker aborts on lost heartbeat and cannot acknowledge stale output", async () => {
  let signal;
  const store = workerStore({ async heartbeat() { return false; } });
  const result = await jobs.processOneJob(store, "word", async (_, received) => { signal = received; return new Promise(() => {}); }, 5);
  assert.equal(result, "lease_lost");
  assert.equal(signal.aborted, true);
  assert.deepEqual(store.calls, []);
});
test("worker handles idle queue without invoking handler", async () => {
  assert.equal(await jobs.processOneJob(workerStore({ async claim() { return null; } }), "word", async () => { throw new Error("should not execute"); }), "idle");
});
test("worker cannot claim completion if the server rejects its attempt token", async () => {
  const store = workerStore({ async complete() { return false; } });
  assert.equal(await jobs.processOneJob(store, "word", async () => ({})), "lease_lost");
});
test("RPC adapter propagates errors and maps scalar/rowset replies", async () => {
  const calls = [];
  const store = new jobs.RpcJobStore(async (name, args) => {
    calls.push([name,args]); return { data: name === "scale_claim" ? [{ id: "job" }] : true, error: null };
  });
  assert.equal((await store.claim("word")).id, "job");
  assert.equal(await store.heartbeat("job", "token"), true);
  assert.equal(calls[1][1].p_token, "token");
  await assert.rejects(new jobs.RpcJobStore(async () => ({ error: new Error("db unavailable") })).claim("word"));
});
