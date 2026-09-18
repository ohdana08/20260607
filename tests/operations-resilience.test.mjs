import test from "node:test";
import assert from "node:assert/strict";
import { performanceModules } from "./helpers/performance-harness.mjs";

const req = (token = "synthetic-secret") => new Request("https://preview.invalid/api/operations", { headers: { Authorization: `Bearer ${token}` } });
const google = () => Response.json({ id: "synthetic-private-user", email: "private@example.invalid", app_metadata: { providers: ["google"] } });
function authFixture({ reply, loggerThrows = false } = {}) {
  const logs = [];
  const controllers = [];
  let calls = 0;
  let clock = 0;
  class Clock extends Date { static now() { return clock; } }
  const modules = performanceModules({
    mocks: { "lib/auth/config.ts": { AUTH_URL: "https://synthetic.invalid", AUTH_ANON_KEY: "synthetic-only" } },
    globals: {
      Date: Clock,
      AbortSignal: { timeout(ms) { assert.equal(ms, 2000); const c = new AbortController(); controllers.push(c); return c.signal; } },
      console: { info() {}, error(value) { if (loggerThrows) throw new Error("sink unavailable"); logs.push(JSON.parse(value)); } },
      fetch: async (_url, options) => {
        calls++;
        if (reply) return reply(calls, options);
        return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("synthetic-secret transport error")), { once: true }));
      },
    },
  });
  return { modules, ...modules.load("lib/auth/googleUser.ts"), logs, controllers,
    timeout(index = 0) { clock += 2000; controllers[index].abort(); }, get calls() { return calls; } };
}

test("Auth timeout is typed for operations and emits only bounded timeout metadata", async () => {
  const h = authFixture();
  const pending = h.getGoogleUser(req(), { dependencyErrors: true });
  h.timeout();
  await assert.rejects(pending, h.GoogleAuthTimeoutError);
  assert.deepEqual(h.logs, [{ event: "auth_verification", outcome: "timeout", timeoutMs: 2000, durationMs: 2000 }]);
  assert.doesNotMatch(JSON.stringify(h.logs), /secret|private|token|email|user|https/);
});

test("shared auth timeout keeps legacy null behavior but operations can require 5xx", async () => {
  const h = authFixture(), request = req();
  const legacy = h.getGoogleUser(request);
  const strict = h.getGoogleUser(request, { dependencyErrors: true });
  h.timeout();
  assert.equal(await legacy, null);
  await assert.rejects(strict, h.GoogleAuthTimeoutError);
  assert.equal(h.calls, 1);
  assert.equal(h.logs.length, 1);
});

test("missing and expired identities retain their unauthorized behavior", async () => {
  for (const reply of [async () => new Response(null, { status: 401 }), async () => new Response(null, { status: 403 })]) {
    const h = authFixture({ reply });
    assert.equal(await h.getGoogleUser(req(), { dependencyErrors: true }), null);
    assert.equal(h.logs.length, 0);
  }
});

test("a timed-out entry is evicted and a recovered auth service can authenticate immediately", async () => {
  const h = authFixture({ reply: (calls, options) => calls > 1 ? google() : new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout")))) });
  const request = req(), pending = h.getGoogleUser(request, { dependencyErrors: true });
  h.timeout();
  await assert.rejects(pending, h.GoogleAuthTimeoutError);
  assert.equal((await h.getGoogleUser(request, { dependencyErrors: true })).id, "synthetic-private-user");
  assert.equal(h.calls, 2);
});

test("old timeout cannot evict a newer successful token and metric sink failure stays isolated", async () => {
  const h = authFixture({ loggerThrows: true, reply: (calls, options) => calls > 1 ? google() : new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout")))) });
  const request = req(), old = h.getGoogleUser(request, { dependencyErrors: true });
  request.headers.set("Authorization", "Bearer replacement");
  await h.getGoogleUser(request);
  h.timeout();
  await assert.rejects(old, h.GoogleAuthTimeoutError);
  assert.equal((await h.getGoogleUser(request)).id, "synthetic-private-user");
  assert.equal(h.calls, 2);
});

test("real operations handler maps strict Auth timeout to 503 before storage and enters alert observation", async () => {
  const h = authFixture();
  const http = h.modules.load("lib/operations/http.ts");
  const events = [];
  let storageCalls = 0;
  const pending = http.operationsRequest(req(), {
    authenticate: (request) => h.getGoogleUser(request, { dependencyErrors: true }),
    store() { storageCalls++; assert.fail("timeout must not access storage"); },
    observe: async (event) => { events.push(event); },
  });
  h.timeout();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(storageCalls, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].phase, "auth");
  assert.equal(events[0].status, 503);
  assert.equal(events[0].requestId, response.headers.get("x-request-id"));
  const body = await response.json();
  assert.equal(body.code, "authentication_unavailable");
  assert.doesNotMatch(JSON.stringify(body), /secret|private|token|email|user/);
});

const queueEnv = { VERCEL: "1", VERCEL_ENV: "preview", OPS_SLACK_BOT_TOKEN: "synthetic-secret-bot", OPS_SLACK_CHANNEL_ID: "synthetic-channel" };
const alertEvent = { event: "operations_request", requestId: "11111111-2222-4333-8444-555555555555", method: "GET", phase: "read", status: 503, durationMs: 50 };
const metadata = (deliveryCount) => ({ deliveryCount, expiresAt: new Date(Date.now() + 86_400_000) });
const queuedPayload = { version: 1, requestId: alertEvent.requestId, method: "GET", phase: "read", status: 503, durationMs: 50, deployment: "preview" };
function queueFixture({ publish = async () => ({ messageId: "synthetic-message" }), transport, loggerThrows = false, clock = Date } = {}) {
  const logs = [];
  const modules = performanceModules({ env: queueEnv, mocks: {
    "@vercel/queue": { send: publish },
    "lib/auth/googleUser.ts": { getGoogleUser: async (_request, options) => { assert.equal(options.dependencyErrors, true); return { id: "synthetic-user", isAdmin: true }; } },
    "lib/operations/storage.ts": { OperationsStorageAccessError: class extends Error {}, createOperationsStore: () => { throw new Error("synthetic-secret-store"); } },
  }, globals: {
    Date: clock,
    fetch: transport ?? (async () => { assert.fail("real network forbidden"); }),
    console: { info(value) { if (loggerThrows) throw new Error("sink failure"); logs.push(JSON.parse(value)); }, error(value) { logs.push(JSON.parse(value)); } },
  } });
  return { modules, logs, ...modules.load("lib/operations/alertQueue.ts") };
}

test("queue publisher waits for durable acceptance and uses requestId deduplication with 24-hour retention", async () => {
  let calls = 0;
  const h = queueFixture({ publish: async (topic, payload, options) => {
    calls++;
    assert.equal(topic, "operations-alerts-v1");
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), queuedPayload);
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { idempotencyKey: alertEvent.requestId, retentionSeconds: 86400, telemetry: { isEnabled: false } });
    return { messageId: "accepted" };
  } });
  assert.equal(await h.enqueueOperationsAlert({ ...alertEvent, user: "synthetic-secret", token: "synthetic-secret" }), "queued");
  assert.equal(calls, 1);
});

test("local environments, missing Slack configuration and 4xx never enqueue", async () => {
  let calls = 0;
  const h = queueFixture({ publish: async () => { calls++; return { messageId: "unexpected" }; } });
  for (const env of [{ ...queueEnv, VERCEL: undefined }, { ...queueEnv, OPS_SLACK_BOT_TOKEN: "" }, { ...queueEnv, OPS_SLACK_CHANNEL_ID: " " }]) {
    assert.equal(await h.enqueueOperationsAlert(alertEvent, { env }), "skipped");
  }
  assert.equal(await h.enqueueOperationsAlert({ ...alertEvent, status: 403 }), "skipped");
  assert.equal(calls, 0);
});

test("consumer rejects extra keys, missing keys, scalar coercions and oversized fields before Slack", async () => {
  const h = queueFixture();
  let calls = 0;
  for (const payload of [null, [], { ...queuedPayload, token: "synthetic-secret" }, { ...queuedPayload, requestId: "x".repeat(10000) }, { ...queuedPayload, status: "503" }, { ...queuedPayload, method: ["GET"] }, { ...queuedPayload, durationMs: null }, { ...queuedPayload, deployment: "https://private.invalid" }, { ...queuedPayload, phase: undefined }]) {
    assert.equal(h.validOperationsAlertPayload(payload), false);
    await h.consumeOperationsAlert(payload, metadata(1), { deliver: async () => { calls++; return { outcome: "sent" }; } });
  }
  assert.equal(calls, 0);
  assert.ok(h.logs.every((event) => event.event === "operations_alert_dead_letter" && event.outcome === "invalid_payload"));
  assert.doesNotMatch(JSON.stringify(h.logs), /secret|private|https/);
});

test("a fresh consumer can retry the durable message after a failure and then acknowledge success", async () => {
  const firstProcess = queueFixture();
  let calls = 0;
  await assert.rejects(firstProcess.consumeOperationsAlert(queuedPayload, metadata(1), { deliver: async () => { calls++; return { outcome: "failed" }; } }), firstProcess.OperationsAlertRetryError);
  const restartedProcess = queueFixture();
  await restartedProcess.consumeOperationsAlert(structuredClone(queuedPayload), metadata(2), { deliver: async (event) => {
    calls++;
    assert.equal(event.requestId, alertEvent.requestId);
    return { outcome: "sent" };
  } });
  assert.equal(calls, 2);
  assert.equal(restartedProcess.logs[0].outcome, "sent");
  assert.equal(restartedProcess.logs[0].attempt, 2);
});

test("SDK deliveryCount 1 through 8 permits seven retries then durably hands off before ACK", async () => {
  const h = queueFixture();
  let attempts = 0;
  const options = { deliver: async () => { attempts++; return { outcome: "failed" }; } };
  for (let deliveryCount = 1; deliveryCount < 8; deliveryCount++) {
    await assert.rejects(h.consumeOperationsAlert(queuedPayload, metadata(deliveryCount), options), h.OperationsAlertRetryError);
  }
  await h.consumeOperationsAlert(queuedPayload, metadata(8), options);
  await h.consumeOperationsAlert(queuedPayload, metadata(9), options);
  assert.equal(attempts, 8);
  assert.deepEqual(h.logs.find((entry) => entry.event === "operations_alert_dead_letter" && entry.attempts === 8), {
    event: "operations_alert_dead_letter", requestId: alertEvent.requestId, status: 503, attempts: 8, outcome: "queued", reason: "attempt_limit",
  });
});

test("Slack 429 Retry-After is never shortened within the remaining retention", async () => {
  for (const [header, expected] of [["120", 120], ["7200", 7200], ["garbage", 30], ["-1", 30]]) {
    const h = queueFixture();
    const error = await h.consumeOperationsAlert(queuedPayload, metadata(1), {
      env: queueEnv, transport: async () => new Response("synthetic-secret", { status: 429, headers: { "retry-after": header } }),
    }).catch((error) => error);
    assert.ok(error instanceof h.OperationsAlertRetryError);
    assert.deepEqual(JSON.parse(JSON.stringify(h.retryOperationsAlert(error, metadata(1)))), { afterSeconds: expected });
    assert.doesNotMatch(JSON.stringify(h.logs) + error.message, /secret|channel|token/);
  }
});

test("queue failure triggers one Slack fallback while preserving the original response even if logs fail", async () => {
  let slackCalls = 0;
  const h = queueFixture({ loggerThrows: true,
    publish: async () => { throw new Error("synthetic-secret-queue"); },
    transport: async () => { slackCalls++; return Response.json({ ok: true }); },
  });
  const route = h.modules.load("app/api/operations/route.ts");
  const response = await route.GET(req());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "storage_unavailable");
  assert.equal(slackCalls, 1);
});

test("late queue ACK can duplicate a fallback Slack message with the same requestId (at-least-once)", async () => {
  let accept;
  let payload;
  const ids = [];
  const h = queueFixture({ publish: async (_topic, value) => { payload = value; return new Promise((resolve) => { accept = resolve; }); },
    transport: async (_url, init) => { ids.push(JSON.parse(JSON.parse(init.body).text).requestId); return Response.json({ ok: true }); },
  });
  const route = h.modules.load("app/api/operations/route.ts");
  const response = await route.GET(req());
  assert.equal(response.status, 503);
  assert.equal(ids.length, 1);
  assert.ok(h.logs.some((entry) => entry.queue_ack === "unknown"));
  assert.ok(h.logs.some((entry) => entry.fallback_slack_ack === "sent"));
  accept({ messageId: "accepted-after-deadline" });
  await h.consumeOperationsAlert(payload, metadata(1));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test("dependency 429/5xx/network/invalid bodies are classified without upstream detail", async () => {
  for (const [reason, reply] of [
    ["rate_limited", async () => new Response("synthetic-secret", { status: 429 })],
    ["upstream_error", async () => new Response("synthetic-secret", { status: 503 })],
    ["network", async () => { throw new Error("synthetic-secret-network"); }],
    ["invalid_response", async () => new Response("not-json synthetic-secret")],
    ["invalid_response", async () => Response.json(null)],
    ["invalid_response", async () => Response.json({ id: 42 })],
  ]) {
    const h = authFixture({ reply });
    await assert.rejects(h.getGoogleUser(req(), { dependencyErrors: true }), (error) => error instanceof h.GoogleAuthDependencyError && error.reason === reason);
    assert.equal(h.logs[0].outcome, reason);
    assert.doesNotMatch(JSON.stringify(h.logs), /secret|network-|https|token/);
    assert.equal(await h.getGoogleUser(req()), null, "unrelated routes retain their legacy failure contract");
  }
});

test("Retry-After beyond retention moves to durable DLQ instead of retrying Slack early", async () => {
  const publishes = [];
  const h = queueFixture({ publish: async (topic, payload, options) => { publishes.push({ topic, payload, options }); return { messageId: "durable-dlq" }; } });
  await h.consumeOperationsAlert(queuedPayload, metadata(1), {
    env: queueEnv, transport: async () => new Response(null, { status: 429, headers: { "retry-after": "999999" } }),
  });
  assert.equal(publishes.length, 1);
  assert.equal(publishes[0].topic, "operations-alerts-dead-v1");
  assert.equal(publishes[0].options.idempotencyKey, `dead:${alertEvent.requestId}`);
  assert.notEqual(publishes[0].options.idempotencyKey, alertEvent.requestId, "dead-letter publish cannot collide with the original alert key");
  assert.equal(publishes[0].options.retentionSeconds, 86400);
  assert.equal(publishes[0].payload.reason, "retry_after_exceeds_retention");
  assert.ok(h.logs.some((entry) => entry.event === "operations_alert_dead_letter" && entry.outcome === "queued"));
});

test("failed durable DLQ publish leaves the original unacknowledged and never repeats Slack beyond eight attempts", async () => {
  let publishes = 0, sends = 0;
  const h = queueFixture({ publish: async () => {
    publishes++;
    if (publishes === 1) throw new Error("synthetic-secret-queue");
    return { messageId: "dlq-recovered" };
  } });
  const options = { deliver: async () => { sends++; return { outcome: "failed" }; } };
  await assert.rejects(h.consumeOperationsAlert(queuedPayload, metadata(8), options), h.OperationsAlertRetryError);
  await h.consumeOperationsAlert(queuedPayload, metadata(9), options);
  assert.equal(sends, 1);
  assert.equal(publishes, 2);
  assert.deepEqual(h.logs.filter((entry) => entry.event === "operations_alert_dead_letter").map((entry) => entry.outcome), ["persist_unconfirmed", "queued"]);
  assert.doesNotMatch(JSON.stringify(h.logs), /secret|channel|token/);
});

test("failed DLQ handoff cannot shorten a Retry-After that exceeds remaining retention", async () => {
  const h = queueFixture({ publish: async () => { throw new Error("synthetic-queue-failure"); } });
  let failure;
  await assert.rejects(h.consumeOperationsAlert(queuedPayload, metadata(1), {
    env: queueEnv, transport: async () => new Response(null, { status: 429, headers: { "retry-after": "86400" } }),
  }), (error) => { failure = error; return error instanceof h.OperationsAlertRetryError; });
  assert.equal(h.retryOperationsAlert(failure, metadata(1)).afterSeconds, 86400);
  assert.ok(h.logs.some((entry) => entry.outcome === "persist_unconfirmed"));
});

test("ordinary backoff that outlives remaining retention is durably handed off", async () => {
  for (const [deliveryCount, remainingSeconds] of [[1, 20], [7, 100]]) {
    const publishes = [];
    const h = queueFixture({ publish: async (topic, payload) => { publishes.push({ topic, payload }); return { messageId: "durable" }; } });
    await h.consumeOperationsAlert(queuedPayload, { deliveryCount, expiresAt: new Date(Date.now() + remainingSeconds * 1000) }, {
      deliver: async () => ({ outcome: "failed" }),
    });
    assert.equal(publishes.length, 1);
    assert.equal(publishes[0].topic, "operations-alerts-dead-v1");
    assert.equal(publishes[0].payload.reason, "retry_delay_exceeds_retention");
  }
});

test("remaining retention is recalculated after slow Slack delivery before scheduling a retry", async () => {
  let now = Date.now(), publishes = 0;
  class Clock extends Date { static now() { return now; } }
  const h = queueFixture({ clock: Clock, publish: async () => { publishes++; return { messageId: "durable" }; } });
  await h.consumeOperationsAlert(queuedPayload, { deliveryCount: 1, expiresAt: new Clock(now + 33000) }, {
    deliver: async () => { now += 2000; return { outcome: "failed" }; },
  });
  assert.equal(publishes, 1, "30-second backoff must leave time for handoff after the two-second attempt");
});
