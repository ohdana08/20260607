import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sendOperationsAlert, OPERATIONS_ALERT_TIMEOUT_MS } from "../lib/operations/alert.ts";
import { operationsRequest, type OperationsEvent } from "../lib/operations/http.ts";
import { initialMonth } from "../lib/operations/domain.ts";

const env = { OPS_SLACK_BOT_TOKEN: "synthetic-bot-token", OPS_SLACK_CHANNEL_ID: "synthetic-channel", VERCEL_ENV: "preview" };
const event: OperationsEvent = {
  event: "operations_request", requestId: "11111111-2222-4333-8444-555555555555",
  method: "PUT", phase: "write", status: 503, durationMs: 1234,
};
test("5xx sends one Slack message with only the bounded metadata projection", async () => {
  let calls = 0;
  const result = await sendOperationsAlert(event, { env, transport: async (url, init) => {
    calls++;
    assert.equal(url, "https://slack.com/api/chat.postMessage");
    assert.equal(init?.method, "POST");
    assert.deepEqual(init?.headers, { Authorization: "Bearer synthetic-bot-token", "Content-Type": "application/json" });
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      channel: "synthetic-channel",
      text: JSON.stringify({ requestId: event.requestId, method: "PUT", phase: "write", status: 503, durationMs: 1234, deployment: "preview" }),
      mrkdwn: false, parse: "none", unfurl_links: false, unfurl_media: false,
    });
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    return Response.json({ ok: true });
  } });
  assert.equal(result, "sent");
  assert.equal(calls, 1);
});

test("missing either alert environment value is a no-op", async () => {
  const transport: typeof fetch = async () => { assert.fail("no network without explicit alert configuration"); };
  for (const config of [{}, { OPS_SLACK_BOT_TOKEN: "x" }, { OPS_SLACK_CHANNEL_ID: "x" }, { ...env, OPS_SLACK_BOT_TOKEN: " " }]) {
    assert.equal(await sendOperationsAlert(event, { env: config, transport }), "skipped");
  }
});

test("success, 4xx, and non-HTTP status values never trigger Slack", async () => {
  const transport: typeof fetch = async () => { assert.fail("only 5xx may reach Slack"); };
  for (const status of [200, 299, 400, 401, 403, 409, 429, 499, 600, 503.5, NaN, Infinity]) {
    assert.equal(await sendOperationsAlert({ ...event, status }, { env, transport }), "skipped");
  }
});

test("Slack HTTP errors, API errors, parse failures and rejected transport are isolated without retries", async () => {
  for (const response of [
    () => new Response("synthetic private detail", { status: 429 }),
    () => new Response("synthetic private detail", { status: 500 }),
    () => Response.json({ ok: false, error: "synthetic private detail" }),
    () => Response.json({ ok: "true" }),
    () => new Response("not json"),
    () => { throw new Error("synthetic private detail"); },
  ]) {
    let calls = 0;
    assert.equal(await sendOperationsAlert(event, { env, transport: async () => { calls++; return response(); } }), "failed");
    assert.equal(calls, 1);
  }
});

test("future event fields, identifiers and URL-shaped labels cannot leak into Slack text", async () => {
  const dirty = {
    ...event, requestId: "synthetic-secret", method: "https://private.invalid", phase: "synthetic-secret",
    durationMs: 1e20, token: "synthetic-secret", channel: "synthetic-secret", payload: { email: "private@example.invalid" },
    user: "synthetic-secret", url: "https://private.invalid",
  } as unknown as OperationsEvent;
  await sendOperationsAlert(dirty, { env: { ...env, VERCEL_ENV: "https://private.invalid" }, transport: async (_url, init) => {
    const text = JSON.parse(String(init?.body)).text;
    assert.deepEqual(JSON.parse(text), { requestId: "unknown", method: "OTHER", phase: "unknown", status: 503, durationMs: 300000, deployment: "unknown" });
    assert.doesNotMatch(text, /secret|private|token|channel|payload|user|https|example/);
    assert.ok(text.length < 256);
    return Response.json({ ok: true });
  } });
});

test("stalled fetch and stalled Slack body both settle within the two-second deadline", async () => {
  assert.equal(OPERATIONS_ALERT_TIMEOUT_MS, 2000);
  const started = performance.now();
  const signals: AbortSignal[] = [];
  let calls = 0;
  const result = await Promise.all([false, true].map((bodyStalls) => sendOperationsAlert(event, { env, transport: async (_url, init) => {
    calls++;
    signals.push(init!.signal!);
    if (!bodyStalls) return new Promise<Response>(() => {}); // Deliberately ignores abort.
    return { ok: true, json: () => new Promise<unknown>(() => {}) } as Response;
  } })));
  assert.deepEqual(result, ["failed", "failed"]);
  assert.equal(calls, 2);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.ok(performance.now() - started < 2500, "deadline must not depend on transport cancellation");
});

test("operations awaits Slack while preserving its 503 and structured log without secrets", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (value: string) => { logs.push(value); });
  let release!: () => void;
  let reached!: () => void;
  const started = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let completed = false;
  let sentRequestId = "";
  const pending = operationsRequest(new Request("https://preview.invalid/api/operations?private=secret", { headers: { Authorization: "Bearer synthetic-secret" } }), {
    authenticate: async () => ({ id: "synthetic-secret-user", isAdmin: true }),
    store: () => { throw new Error("synthetic-secret-database"); },
    observe: async (observed) => {
      await sendOperationsAlert(observed, { env, transport: async (_url, init) => {
        sentRequestId = JSON.parse(JSON.parse(String(init?.body)).text).requestId;
        reached();
        await gate;
        throw new Error("synthetic-secret-slack");
      } });
    },
  }).then((response) => { completed = true; return response; });
  await started;
  assert.equal(completed, false);
  release();
  const response = await pending;
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-request-id"), sentRequestId);
  assert.equal(logs.length, 1);
  const logged = JSON.parse(logs[0]);
  assert.equal(logged.phase, "read");
  assert.equal(logged.status, 503);
  assert.equal(logged.requestId, sentRequestId);
  assert.doesNotMatch(logs.join("\n") + await response.text(), /secret|slack|channel|token|private\.invalid/);
});

test("actual API 403 retains its structured log and makes no Slack request", async (t) => {
  const logs: string[] = [];
  let calls = 0;
  t.mock.method(console, "info", (value: string) => { logs.push(value); });
  const response = await operationsRequest(new Request("https://preview.invalid/api/operations"), {
    authenticate: async () => ({ id: "ordinary-user", isAdmin: false }),
    store: () => { assert.fail("ordinary user must not reach storage"); },
    observe: async (observed) => { await sendOperationsAlert(observed, { env, transport: async () => { calls++; return Response.json({ ok: true }); } }); },
  });
  assert.equal(response.status, 403);
  assert.equal(JSON.parse(logs[0]).status, 403);
  assert.equal(calls, 0);
});

test("async observer rejection cannot change a committed write or cause a retry", async (t) => {
  t.mock.method(console, "info", () => {});
  let writes = 0;
  const state = initialMonth("2026-09");
  const response = await operationsRequest(new Request("https://preview.invalid/api/operations", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month: "2026-09", expectedRevision: 0, command: { kind: "goal", value: state.goal } }),
  }), {
    authenticate: async () => ({ id: "operator", isAdmin: true }),
    store: () => ({ read: async () => state, compareAndSet: async (_month, _revision, next) => { writes++; return next; } }),
    observe: async () => { throw new Error("synthetic-secret-sink"); },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.revision, 1);
  assert.equal(writes, 1);
});

function hostedRoute(outcome: "sent" | "skipped" | "failed", isAdmin = true) {
  let alerts = 0;
  const imports: Record<string, unknown> = {
    "@/lib/auth/googleUser": { getGoogleUser: async () => ({ id: "synthetic-secret-user", isAdmin }) },
    "@/lib/operations/http": { operationsRequest, isLocalOperationsRequest: () => false },
    "@/lib/operations/storage": { createOperationsStore: () => { throw new Error("synthetic-secret-storage"); } },
    "@/lib/operations/alert": { sendOperationsAlert: async () => { alerts++; return outcome; } },
  };
  const loaded = { exports: {} as { GET: (req: Request) => Promise<Response> } };
  const source = readFileSync(new URL("../app/api/operations/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, console, require: (name: string) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected route import: ${name}`);
    return imports[name];
  } });
  return { get: loaded.exports.GET, alertCount: () => alerts };
}

test("hosted route logs each 5xx alert outcome separately with four safe fields", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "error", (value: string) => { logs.push(value); });
  t.mock.method(console, "info", (value: string) => { logs.push(value); });
  for (const outcome of ["sent", "skipped", "failed"] as const) {
    logs.length = 0;
    const route = hostedRoute(outcome);
    const response = await route.get(new Request("https://preview.invalid/api/operations?payload=synthetic-secret", { headers: { Authorization: "Bearer synthetic-secret-token" } }));
    assert.equal(response.status, 503);
    assert.equal(route.alertCount(), 1);
    assert.equal(logs.length, 2);
    assert.equal(JSON.parse(logs[0]).event, "operations_request");
    assert.deepEqual(JSON.parse(logs[1]), { event: "operations_alert", requestId: response.headers.get("x-request-id"), status: 503, outcome });
    assert.doesNotMatch(logs.join("\n"), /secret|token|channel|payload|user|https/);
  }
});

test("hosted route emits no alert outcome log for 403 and retains the request log", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "info", (value: string) => { logs.push(value); });
  const route = hostedRoute("skipped", false);
  const response = await route.get(new Request("https://preview.invalid/api/operations"));
  assert.equal(response.status, 403);
  assert.equal(route.alertCount(), 0);
  assert.equal(logs.length, 1);
  assert.equal(JSON.parse(logs[0]).event, "operations_request");
  assert.equal(JSON.parse(logs[0]).status, 403);
});

test("request durationMs measures handling before Slack wait, not total response latency", async (t) => {
  let clock = 1000;
  const logs: string[] = [];
  t.mock.method(Date, "now", () => clock);
  t.mock.method(console, "error", (value: string) => { logs.push(value); });
  const response = await operationsRequest(new Request("https://preview.invalid/api/operations"), {
    authenticate: async () => { clock += 17; return { id: "operator", isAdmin: true }; },
    store: () => { throw new Error("storage unavailable"); },
    observe: async (observed) => {
      assert.equal(observed.durationMs, 17);
      clock += 1900;
    },
  });
  assert.equal(response.status, 503);
  assert.equal(clock - 1000, 1917);
  assert.equal(JSON.parse(logs[0]).durationMs, 17);
});
