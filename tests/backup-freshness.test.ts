import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { BACKUP_ALERT_PHASES, BACKUP_MAX_AGE_MS, BACKUP_CHECK_TIMEOUT_MS, BACKUP_ACTIVE_GRACE_MS, BACKUP_REQUIRED_STEPS, backupFreshnessPhase,
  backupFreshnessRequestId, checkBackupFreshness, type BackupFreshnessResult } from "../lib/operations/backupFreshness.ts";
import { operationsAlertPayload } from "../lib/operations/alert.ts";
import { performanceModules } from "./helpers/performance-harness.mjs";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const MONITOR_SECRET = "synthetic-monitor-secret-32-chars";
function fixture() {
  const run: Record<string, unknown> = { id: 123, run_attempt: 2, head_branch: "main", event: "schedule", status: "completed", conclusion: "success", run_started_at: new Date(NOW - 60_000).toISOString() };
  const steps: Record<string, unknown>[] = BACKUP_REQUIRED_STEPS.map((name) => ({ name, status: "completed", conclusion: "success" }));
  const step = steps[steps.length - 1];
  const job: Record<string, unknown> = { name: "backup", run_id: 123, status: "completed", conclusion: "success", steps };
  const artifact: Record<string, unknown> = { name: "operations-backup-verified-123-2", expired: false, size_in_bytes: 1500, created_at: new Date(NOW - 30_000).toISOString(), expires_at: new Date(NOW + 86400_000).toISOString() };
  const encrypted: Record<string, unknown> = { ...artifact, name: "operations-backup-123-2" };
  return { run, step, steps, job, artifact, encrypted,
    runs: { total_count: 5, workflow_runs: [run] },
    jobs: { total_count: 1, jobs: [job] },
    artifacts: { total_count: 2, artifacts: [artifact, encrypted] } };
}
function api(f = fixture()) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.equal(new Headers(init?.headers).get("User-Agent"), "ddakfit-backup-freshness");
    assert.equal(new Headers(init?.headers).get("X-GitHub-Api-Version"), "2022-11-28");
    if (url.endsWith("/workflows/operations-backup.yml/runs?branch=main&per_page=1")) return Response.json(f.runs);
    if (url.endsWith("/runs/123/attempts/2/jobs?per_page=100")) return Response.json(f.jobs);
    if (url.endsWith("/runs/123/artifacts?per_page=100")) return Response.json(f.artifacts);
    assert.fail("unexpected GitHub request");
  };
  return { f, calls, transport, check: () => checkBackupFreshness({ transport, now: () => NOW }) };
}

test("fresh requires the newest main run, current attempt job, evidence step and unexpired artifact", async () => {
  const h = api();
  assert.deepEqual(await h.check(), { ok: true, reason: "fresh", runId: 123, runAttempt: 2 });
  assert.equal(h.calls.length, 3);
  assert.doesNotMatch(h.calls[0].url, /status=|conclusion=/);
});

test("missing run and newest incomplete/failed/skipped runs never fall back to an older success", async () => {
  const absent = api(); absent.f.runs.total_count = 0; absent.f.runs.workflow_runs = [];
  assert.equal((await absent.check()).reason, "run_missing");
  for (const values of [{ status: "queued" }, { status: "in_progress" }, { conclusion: "failure" }, { conclusion: "skipped" }, { conclusion: "cancelled" }, { head_branch: "other" }, { event: "pull_request" }, { event: ["schedule"] }]) {
    const h = api(); Object.assign(h.f.run, values);
    assert.equal((await h.check()).reason, "run_unverified");
    assert.equal(h.calls.length, 1);
  }
});

test("run_started_at controls seven-hour freshness rather than a recent updated_at", async () => {
  const h = api(); h.f.run.updated_at = new Date(NOW).toISOString();
  h.f.run.run_started_at = new Date(NOW - BACKUP_MAX_AGE_MS).toISOString();
  assert.equal((await h.check()).ok, true);
  h.f.run.run_started_at = new Date(NOW - BACKUP_MAX_AGE_MS - 1).toISOString();
  assert.equal((await h.check()).reason, "run_stale");
  for (const date of [undefined, null, "not-a-date", new Date(NOW + 1).toISOString()]) {
    h.f.run.run_started_at = date;
    assert.equal((await h.check()).reason, "github_invalid");
  }
});

test("backup job and final evidence upload step must each complete successfully", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.job.conclusion = "skipped"; },
    (f: ReturnType<typeof fixture>) => { f.job.status = "in_progress"; },
    (f: ReturnType<typeof fixture>) => { f.job.name = "other"; },
    (f: ReturnType<typeof fixture>) => { f.job.run_id = 124; },
    (f: ReturnType<typeof fixture>) => { f.step.conclusion = "failure"; },
    (f: ReturnType<typeof fixture>) => { f.step.status = "queued"; },
    (f: ReturnType<typeof fixture>) => { f.job.steps = []; },
    (f: ReturnType<typeof fixture>) => { f.job.steps = [f.step, f.step]; },
  ]) {
    const h = api(); mutate(h.f); assert.equal((await h.check()).reason, "job_unverified");
  }
});

test("required six evidence stages match the real workflow and each rejects missing/skipped/failed/incomplete/duplicate results", async () => {
  const workflow = readFileSync(new URL("../.github/workflows/operations-backup.yml", import.meta.url), "utf8");
  const names = [...workflow.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]);
  assert.equal(BACKUP_REQUIRED_STEPS.length, 6);
  for (const name of BACKUP_REQUIRED_STEPS) {
    assert.equal(names.filter((step) => step === name).length, 1, `workflow stage ${name}`);
    for (const failure of ["missing", "skipped", "failure", "incomplete", "duplicate"]) {
      const h = api(); const step = h.f.steps.find((candidate) => candidate.name === name)!;
      if (failure === "missing") h.f.job.steps = h.f.steps.filter((candidate) => candidate !== step);
      else if (failure === "duplicate") h.f.job.steps = [...h.f.steps, { ...step }];
      else if (failure === "incomplete") step.status = "in_progress";
      else step.conclusion = failure;
      assert.equal((await h.check()).reason, "job_unverified", `${name}: ${failure}`);
    }
  }
});

test("artifact must belong to the current attempt, be nonempty and still available", async () => {
  for (const values of [{ name: "operations-backup-verified-123-1" }, { name: "operations-backup-123-2" }, { expired: true }, { expired: undefined }, { size_in_bytes: 0 }, { expires_at: new Date(NOW).toISOString() }, { expires_at: "bad" }, { created_at: new Date(NOW - 120_000).toISOString() }]) {
    const h = api(); Object.assign(h.f.artifact, values);
    assert.equal((await h.check()).reason, "artifact_unverified");
  }
  const missing = api(); missing.f.artifacts = { total_count: 0, artifacts: [] };
  assert.equal((await missing.check()).reason, "artifact_unverified");
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.encrypted.expired = true; },
    (f: ReturnType<typeof fixture>) => { f.encrypted.size_in_bytes = 0; },
    (f: ReturnType<typeof fixture>) => { f.encrypted.name = "operations-backup-123-1"; },
    (f: ReturnType<typeof fixture>) => { f.artifacts.artifacts.pop(); f.artifacts.total_count--; },
    (f: ReturnType<typeof fixture>) => { f.artifacts.artifacts.push({ ...f.encrypted }); f.artifacts.total_count++; },
  ]) { const h = api(); mutate(h.f); assert.equal((await h.check()).reason, "artifact_unverified"); }
});

test("partial pagination and malformed API contracts cannot be accepted as proof", async () => {
  for (const target of ["jobs", "artifacts"] as const) {
    const h = api(); h.f[target].total_count = 101;
    assert.equal((await h.check()).reason, "github_invalid");
  }
  for (const body of [null, [], {}, { total_count: 0, workflow_runs: [{}] }, { total_count: 1, workflow_runs: [{ id: "123" }] }]) {
    const result = await checkBackupFreshness({ transport: async () => Response.json(body), now: () => NOW });
    assert.equal(result.reason, "github_invalid");
  }
});

test("GitHub errors and unparseable or oversized bodies expose only bounded reasons", async () => {
  for (const status of [301, 403, 404, 429, 500, 503]) {
    assert.deepEqual(await checkBackupFreshness({ transport: async () => new Response("synthetic-secret", { status }) }), { ok: false, reason: "github_unavailable" });
  }
  for (const text of ["synthetic-secret-not-json", "x".repeat(1024 * 1024 + 1)]) {
    assert.equal((await checkBackupFreshness({ transport: async () => new Response(text) })).reason, "github_invalid");
  }
  assert.deepEqual(await checkBackupFreshness({ transport: async () => { throw new Error("https://private.invalid synthetic-token"); } }), { ok: false, reason: "github_unavailable" });
});

test("one hard deadline bounds a stalled GitHub transport and response body without retries", async () => {
  assert.equal(BACKUP_CHECK_TIMEOUT_MS, 5000);
  for (const stalledBody of [false, true]) {
    let calls = 0, signal: AbortSignal | null | undefined;
    const result = await checkBackupFreshness({ timeoutMs: 20, transport: async (_input, init) => {
      calls++; signal = init?.signal;
      return stalledBody ? new Response(new ReadableStream({ start() {} })) : new Promise<Response>(() => {});
    } });
    assert.deepEqual(result, { ok: false, reason: "github_timeout" });
    assert.equal(calls, 1); assert.equal(signal?.aborted, true);
  }
});

test("freshness and artifact expiry are rechecked after waiting for GitHub evidence", async () => {
  for (const artifactExpiry of [false, true]) {
    const h = api(); let current = NOW;
    h.f.run.run_started_at = new Date(NOW - BACKUP_MAX_AGE_MS + 1000).toISOString();
    if (artifactExpiry) { h.f.run.run_started_at = new Date(NOW - 1000).toISOString(); h.f.artifact.created_at = new Date(NOW).toISOString(); h.f.artifact.expires_at = new Date(NOW + 1000).toISOString(); }
    const result = await checkBackupFreshness({ now: () => current, transport: async (input, init) => {
      const response = await h.transport(input, init);
      if (!String(input).includes("/workflows/")) current = NOW + 2000;
      return response;
    } });
    assert.equal(result.reason, artifactExpiry ? "artifact_unverified" : "run_stale");
  }
});

test("monitor request IDs are stable within a UTC six-hour bucket and change at the boundary", () => {
  const start = Math.floor(NOW / 21600_000) * 21600_000;
  const id = backupFreshnessRequestId(start);
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(backupFreshnessRequestId(start + 21600_000 - 1), id);
  assert.notEqual(backupFreshnessRequestId(start + 21600_000), id);
  assert.notEqual(backupFreshnessRequestId(start, "run_stale", 123, 2), backupFreshnessRequestId(start, "artifact_unverified", 123, 2));
  assert.notEqual(backupFreshnessRequestId(start, "run_stale", 123, 2), backupFreshnessRequestId(start, "run_stale", 124, 2));
  assert.notEqual(backupFreshnessRequestId(start, "run_stale", 123, 2), backupFreshnessRequestId(start, "run_stale", 123, 3));
});

test("recent active run validates the previous success in four calls and retains the latest identity", async () => {
  for (const status of ["queued", "in_progress"]) {
    const h = api();
    let calls = 0;
    const result = await checkBackupFreshness({ now: () => NOW, transport: async (input, init) => {
      calls++;
      const url = String(input);
      if (url.endsWith("runs?branch=main&per_page=1")) return Response.json({ total_count: 2, workflow_runs: [{ ...h.f.run, id: 124, status, conclusion: null }] });
      if (url.endsWith("runs?branch=main&status=success&per_page=1")) return Response.json(h.f.runs);
      return h.transport(input, init);
    } });
    assert.deepEqual(result, { ok: true, reason: "fresh_pending", runId: 124, runAttempt: 2 });
    assert.equal(calls, 4); assert.equal(calls * 4, 16, "15-minute external polling has at most 16 requests/hour");
  }
});

test("active run beyond 30 minutes fails immediately; grace never hides a stale or missing previous backup", async () => {
  const old = api(); old.f.run.status = "in_progress"; old.f.run.conclusion = null;
  old.f.run.run_started_at = new Date(NOW - BACKUP_ACTIVE_GRACE_MS - 1).toISOString();
  assert.equal((await old.check()).reason, "run_unverified"); assert.equal(old.calls.length, 1);
  for (const previous of ["stale", "missing", "artifact"]) {
    const h = api(); let calls = 0;
    if (previous === "stale") h.f.run.run_started_at = new Date(NOW - BACKUP_MAX_AGE_MS - 1).toISOString();
    if (previous === "artifact") h.f.encrypted.expired = true;
    const result = await checkBackupFreshness({ now: () => NOW, transport: async (input, init) => {
      calls++; const url = String(input);
      if (url.endsWith("runs?branch=main&per_page=1")) return Response.json({ total_count: 2, workflow_runs: [{ ...h.f.run, id: 124, status: "queued", conclusion: null, run_started_at: new Date(NOW).toISOString() }] });
      if (url.endsWith("runs?branch=main&status=success&per_page=1")) return Response.json(previous === "missing" ? { total_count: 0, workflow_runs: [] } : h.f.runs);
      return h.transport(input, init);
    } });
    assert.equal(result.reason, previous === "stale" ? "run_stale" : previous === "missing" ? "run_missing" : "artifact_unverified");
    assert.ok(calls <= 4);
  }
});

test("active-run grace is rechecked after the evidence fetches", async () => {
  const h = api(); let current = NOW;
  const result = await checkBackupFreshness({ now: () => current, transport: async (input, init) => {
    const url = String(input);
    if (url.endsWith("runs?branch=main&per_page=1")) return Response.json({ total_count: 2, workflow_runs: [{ ...h.f.run, id: 124, status: "in_progress", conclusion: null, run_started_at: new Date(NOW - BACKUP_ACTIVE_GRACE_MS + 1000).toISOString() }] });
    if (url.endsWith("runs?branch=main&status=success&per_page=1")) return Response.json(h.f.runs);
    const response = await h.transport(input, init); current = NOW + 2000; return response;
  } });
  assert.equal(result.reason, "run_unverified");
});

test("only bounded backup phases pass the existing Slack projection and strict queue schema", () => {
  const modules = performanceModules({ mocks: { "@vercel/queue": { send: async () => assert.fail("no publish") } } });
  const { validOperationsAlertPayload } = modules.load("lib/operations/alertQueue.ts");
  for (const phase of BACKUP_ALERT_PHASES) {
    const payload = operationsAlertPayload({ event: "operations_request", requestId: backupFreshnessRequestId(NOW), method: "GET", phase, status: 503, durationMs: 5 }, "preview");
    assert.equal(payload.phase, phase);
    assert.equal(validOperationsAlertPayload({ version: 1, ...payload }), true);
    assert.equal(validOperationsAlertPayload({ version: 1, ...payload, phase: "backup_secret-value" }), false);
  }
});

function routeHarness({ result = { ok: false, reason: "run_stale" } as BackupFreshnessResult,
  secret = MONITOR_SECRET, queueAck = "queued", sinkThrows = false, fallbackThrows = false,
  check = async () => result } = {}) {
  const logs: string[] = [], events: Record<string, unknown>[] = [];
  let checks = 0, fallbacks = 0;
  const imports: Record<string, unknown> = {
    "node:crypto": { createHmac, timingSafeEqual },
    "@/lib/operations/backupFreshness": { backupFreshnessPhase, backupFreshnessRequestId, checkBackupFreshness: async () => { checks++; return check(); } },
    "@/lib/operations/alertQueue": { enqueueOperationsAlert: async (event: Record<string, unknown>) => { events.push(event); if (queueAck === "throw") throw new Error("synthetic-secret-queue"); return queueAck; } },
    "@/lib/operations/alert": { sendOperationsAlert: async () => { fallbacks++; if (fallbackThrows) throw new Error("synthetic-secret-slack"); return "sent"; } },
  };
  const loaded = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/cron/monitor-backup/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  class Clock extends Date { static now() { return NOW; } }
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Request, Response, Buffer, Date: Clock,
    process: { env: { OPS_BACKUP_MONITOR_SECRET: secret, CRON_SECRET: "synthetic-collector-secret" } }, console: { info(value: string) { if (sinkThrows) throw new Error("sink failure"); logs.push(value); } },
    require(name: string) { assert.ok(Object.hasOwn(imports, name)); return imports[name]; },
  });
  return { get: loaded.exports.GET, logs, events, counts: () => ({ checks, fallbacks }) };
}
const signatureFor = (timestamp: string, secret = MONITOR_SECRET) => createHmac("sha256", secret).update(timestamp).digest("hex");
const request = (timestamp = String(NOW / 1000), signature = signatureFor(timestamp)) => new Request("https://preview.invalid/api/cron/monitor-backup?token=synthetic-secret", {
  headers: { "x-ops-monitor-timestamp": timestamp, "x-ops-monitor-signature": signature },
});

test("missing, malformed, expired or wrong HMAC rejects before GitHub, logging or alerting", async () => {
  const stamp = String(NOW / 1000);
  const denied = [
    new Request("https://preview.invalid/api/cron/monitor-backup"),
    new Request("https://preview.invalid/api/cron/monitor-backup", { headers: { Authorization: "Bearer synthetic-cron-secret" } }),
    request(stamp, signatureFor(stamp, "synthetic-collector-secret")),
    request(stamp, "00"), request(stamp, "z".repeat(64)), request(stamp, "0".repeat(64)),
    ...["", "NaN", "1.5", "-1", "9".repeat(20), String(NOW / 1000 - 301), String(NOW / 1000 + 301)].map((value) => request(value)),
  ];
  for (const deniedRequest of denied) {
    const h = routeHarness();
    const response = await h.get(deniedRequest);
    assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(h.counts(), { checks: 0, fallbacks: 0 }); assert.equal(h.events.length, 0); assert.equal(h.logs.length, 0);
  }
  const absent = routeHarness({ secret: "" });
  assert.equal((await absent.get(request())).status, 401); assert.equal(absent.counts().checks, 0);
});

test("HMAC accepts the exact timestamp at both five-minute boundaries and never serializes credentials", async () => {
  for (const delta of [-300, 0, 300]) {
    const stamp = String(NOW / 1000 + delta), signature = signatureFor(stamp);
    const h = routeHarness({ result: { ok: true, reason: "fresh" } });
    const response = await h.get(request(stamp, signature.toUpperCase()));
    assert.equal(response.status, 200); assert.equal(h.counts().checks, 1);
    assert.doesNotMatch(h.logs.join("\n") + await response.text(), new RegExp(`${signature}|synthetic|secret|https|signature|timestamp`));
  }
  const exact = "0" + String(NOW / 1000);
  assert.equal((await routeHarness({ result: { ok: true, reason: "fresh" } }).get(request(exact))).status, 200);
  assert.equal((await routeHarness().get(request(exact, signatureFor(String(NOW / 1000))))).status, 401, "signature must cover the original bytes, not a normalized timestamp");
});

test("monitor HMAC keys shorter than 32 characters are rejected before external work", async () => {
  const stamp = String(NOW / 1000);
  for (const length of [0, 1, 31, 32]) {
    const secret = "x".repeat(length), h = routeHarness({ secret, result: { ok: true, reason: "fresh" } });
    const response = await h.get(request(stamp, signatureFor(stamp, secret)));
    assert.equal(response.status, length < 32 ? 401 : 200);
    assert.equal(h.counts().checks, length < 32 ? 0 : 1);
    if (length < 32) { assert.equal(h.events.length, 0); assert.equal(h.logs.length, 0); }
  }
});

test("real GitHub check through authenticated route returns healthy without an alert", async () => {
  const h = routeHarness({ check: api().check });
  const response = await h.get(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).reason, "fresh");
  assert.equal(h.events.length, 0); assert.equal(h.logs.length, 1);
});

test("failed monitor returns 503 and queues the bounded reason with deterministic identity", async () => {
  const h = routeHarness();
  const one = await h.get(request()), two = await h.get(request());
  assert.equal(one.status, 503); assert.equal(two.status, 503);
  assert.equal(one.headers.get("x-request-id"), two.headers.get("x-request-id"));
  assert.equal(h.events[0].phase, "backup_stale"); assert.equal(h.events[0].requestId, one.headers.get("x-request-id"));
  assert.deepEqual(h.counts(), { checks: 2, fallbacks: 0 });
  assert.doesNotMatch(h.logs.join("\n") + JSON.stringify(h.events) + await one.text(), /synthetic|token|secret|https|payload|user|channel/);
});

test("queue failure/unknown ACK falls back once; skipped configuration and logging failure preserve result", async () => {
  for (const queueAck of ["failed", "unknown", "throw", "skipped"]) {
    const h = routeHarness({ queueAck, sinkThrows: true, fallbackThrows: true });
    const response = await h.get(request());
    assert.equal(response.status, 503); assert.equal((await response.json()).reason, "run_stale");
    assert.equal(h.counts().fallbacks, queueAck === "skipped" ? 0 : 1);
  }
});
