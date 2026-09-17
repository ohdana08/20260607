import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { redisCommand } from "./helpers/scale-harness.mjs";

// Independent, explicit imports only. Redis tests use synthetic data on the
// fixed loopback lab; remote requests, real credentials and live DB are absent.
const root = path.resolve(import.meta.dirname, "..");
const BASE = "e2ee1f1";
function evaluate(file, { baseline = false, imports = {}, globals = {}, env = {} } = {}) {
  const source = baseline
    ? execFileSync("git", ["show", `${BASE}:${file}`], { cwd: root, encoding: "utf8" })
    : readFileSync(path.join(root, file), "utf8");
  const loaded = { exports: {} };
  const require = (name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected release-review dependency ${name}`);
    return imports[name];
  };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, require, process: { env },
    Request, Response, Headers, URL, Date, TextDecoder, TextEncoder,
    AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {}, info() {} },
    fetch: () => { throw new Error("Release Reviewer forbids network"); }, ...globals,
  }, { filename: baseline ? `${BASE}:${file}` : file });
  return loaded.exports;
}
const env = { NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://release.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic", GROBLE_WEBHOOK_KEY: "synthetic-webhook" };
const user = { id: `release-reviewer-${randomUUID()}`, email: "buyer@release.invalid", isAdmin: false };
const A = `99${Date.now()}0001`, B = `99${Date.now()}0002`, C = `99${Date.now()}0003`;
function memoryRedis(initial = []) {
  const values = new Map(initial.map(([k, v]) => [k, structuredClone(v)]));
  class Redis {
    async get(key) { return structuredClone(values.get(key) ?? null); }
    async set(key, value, options = {}) {
      if (options.nx && values.has(key)) return null;
      values.set(key, structuredClone(value)); return "OK";
    }
    async del(...keys) { let removed = 0; for (const key of keys) if (values.delete(key)) removed++; return removed; }
    async incr(key) { const value = Number(values.get(key) ?? 0) + 1; values.set(key, value); return value; }
    async lrange(key, first, last) { const a = values.get(key) ?? []; return structuredClone(a.slice(first, last < 0 ? undefined : last + 1)); }
    async lpush(key, value) { const a = values.get(key) ?? []; a.unshift(structuredClone(value)); values.set(key, a); return a.length; }
    async ltrim(key, first, last) { values.set(key, (values.get(key) ?? []).slice(first, last + 1)); return "OK"; }
  }
  return { Redis, values, read: (key) => new Redis().get(key) };
}
async function actualRedis(t, initial = []) {
  const rawKey = `release-reviewer:${randomUUID()}:raw`;
  const keyOf = (key) => key === "gp:groble_raw" ? rawKey : key;
  const decode = (value) => {
    if (Array.isArray(value)) return value.map(decode);
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  };
  class Redis {
    async get(key) { return decode(await redisCommand("GET", keyOf(key))); }
    async set(key, value, options = {}) {
      return redisCommand("SET", keyOf(key), typeof value === "string" ? value : JSON.stringify(value),
        ...(options.nx ? ["NX"] : []), ...(options.px ? ["PX", options.px] : []));
    }
    async del(...keys) { return redisCommand("DEL", ...keys.map(keyOf)); }
    async incr(key) { return redisCommand("INCR", keyOf(key)); }
    async lrange(key, first, last) { return decode(await redisCommand("LRANGE", keyOf(key), first, last)); }
    async lpush(key, value) { return redisCommand("LPUSH", keyOf(key), typeof value === "string" ? value : JSON.stringify(value)); }
    async ltrim(key, first, last) { return redisCommand("LTRIM", keyOf(key), first, last); }
    async eval(script, keys, args) { return decode(await redisCommand("EVAL", script, keys.length, ...keys, ...args)); }
  }
  const keys = [rawKey, ...["gp:paid:", "gp:presentation-paid:", "gp:prestage:", "gp:ordertries:", "gp:presentation-ordertries:"].map((p) => p + user.id),
    ...[A, B, C].flatMap((o) => [`gp:validorder:${o}`, `gp:orderused:${o}`, `gp:ordergrant:${o}:word`, `gp:ordergrant:${o}:presentation`])];
  await redisCommand("DEL", ...keys);
  t.after(() => redisCommand("DEL", ...keys));
  const redis = new Redis();
  for (const [key, value] of initial) await redis.set(key, value);
  return { Redis, read: (key) => redis.get(key), client: redis };
}
const rateOk = { checkRateLimit: async () => ({ ok: true }), tooManyRequests: () => Response.json({}, { status: 429 }) };
const products = { isPlanProductId: (id) => id === "word" || id === "bundle", isBundleProductId: (id) => id === "bundle", isPresentationProductId: (id) => id === "presentation" || id === "bundle",
  GROBLE_PRESENTATION_PRODUCT_ID: "presentation", GROBLE_BUNDLE_PRODUCT_ID: "bundle" };
async function paymentHarness(t, { baseline = false, globals = {}, extraEnv = {} } = {}) {
  const initial = [
    [`gp:paid:${user.id}`, { orderNo: B, usedProgramId: "program-B", email: user.email, verifiedAt: "2026-09-17" }],
    [`gp:validorder:${A}`, { orderNo: A, status: "valid", productId: "word", via: "webhook" }],
    [`gp:validorder:${B}`, { orderNo: B, status: "valid", productId: "word", via: "webhook" }],
    [`gp:orderused:${A}`, user.id], [`gp:orderused:${B}`, user.id],
  ];
  const database = baseline ? memoryRedis(initial) : await actualRedis(t, initial);
  const state = baseline ? {} : evaluate("lib/plan/paymentState.ts");
  const access = { isMasterCode: () => false };
  const paid = evaluate("lib/plan/paidAccess.ts", { baseline, env, imports: {
    "@upstash/redis": database, "./access": access,
    "./paymentState": state,
    "@/lib/auth/googleUser": { getGoogleUser: async () => user },
  } });
  const presentation = evaluate("lib/plan/presentationAccess.ts", { baseline, env, imports: {
    "@upstash/redis": database, "./access": access, "./paidAccess": paid, "./paymentState": state,
  } });
  const verify = evaluate("app/api/order/verify/route.ts", { baseline, env, imports: {
    "@upstash/redis": database, "@/lib/ratelimit": rateOk, "@/lib/config": products,
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) },
    "@/lib/plan/paidAccess": paid, "@/lib/plan/presentationAccess": presentation,
    "@/lib/plan/paymentState": state,
  } });
  const webhook = evaluate("app/api/groble/webhook/route.ts", { baseline, env: { ...env, ...extraEnv }, globals, imports: {
    "@upstash/redis": database, "@/lib/plan/access": access, "@/lib/config": products,
    "@/lib/plan/paidAccess": paid, "@/lib/plan/presentationAccess": presentation,
    "@/lib/plan/paymentState": state,
  } });
  const presentationOrder = baseline ? null : evaluate("app/api/plan/presentation/order/route.ts", { env, imports: {
    "@upstash/redis": database, "@/lib/ratelimit": rateOk, "@/lib/config": products,
    "@/lib/plan/access": access, "@/lib/plan/paidAccess": paid,
    "@/lib/plan/presentationAccess": presentation, "@/lib/plan/paymentState": state,
    "@/lib/plan/presentationRevisions": { getPresentationRevisionStatus: async () => ({}) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) },
  } });
  return { ...database, paid, presentation, verify, webhook, state, presentationOrder };
}
const jsonRequest = (url, body) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const oldOrderRequest = () => jsonRequest("https://release.invalid/api/order/verify", { orderNo: A });
const refundRequest = () => jsonRequest("https://release.invalid/api/groble/webhook?key=synthetic-webhook", {
  type: "payment.cancelled", data: { object: { merchantUid: A, content: { id: "word" } } },
});

test("release evidence: baseline old-order replay clears credit binding", async () => {
  const h = await paymentHarness(null, { baseline: true });
  assert.equal((await h.verify.POST(oldOrderRequest())).status, 200);
  assert.equal(h.values.get(`gp:paid:${user.id}`).orderNo, A);
  assert.equal(h.values.get(`gp:paid:${user.id}`).usedProgramId, undefined);
  assert.equal((await h.paid.checkDraftAccess(new Request("https://release.invalid"), undefined, "program-C")).ok, true);
});

test("Redis release invariant: an already consumed historical order cannot create unbound credit", async (t) => {
  const h = await paymentHarness(t);
  await h.verify.POST(oldOrderRequest());
  const result = await h.paid.checkDraftAccess(new Request("https://release.invalid"), undefined, "program-C");
  assert.equal(result.ok, false, "replaying order A after order B must not unlock a third program");
  assert.ok((await h.read(`gp:paid:${user.id}`))?.usedProgramId, "a consumed order must retain a program binding");
});

test("release evidence: baseline refund of historical order deletes a newer purchase", async () => {
  const h = await paymentHarness(null, { baseline: true });
  assert.equal((await h.webhook.POST(refundRequest())).status, 200);
  assert.equal(h.values.has(`gp:paid:${user.id}`), false);
  assert.equal(h.values.get(`gp:validorder:${B}`).status, "valid");
});

test("Redis release invariant: refund revokes only the matching order entitlement", async (t) => {
  const h = await paymentHarness(t);
  assert.equal((await h.webhook.POST(refundRequest())).status, 200);
  assert.equal((await h.read(`gp:validorder:${A}`)).status, "cancelled");
  assert.equal((await h.read(`gp:paid:${user.id}`))?.orderNo, B, "refund A must preserve the valid newer order B");
});

test("Redis release endpoint: presentation-first bundle claims Word once and preserves consent and binding", async (t) => {
  const h = await paymentHarness(t);
  await h.client.set(`gp:validorder:${C}`, { orderNo: C, status: "valid", productId: "bundle" });
  assert.equal((await h.presentationOrder.POST(jsonRequest("https://release.invalid/api/plan/presentation/order", { orderNo: C }))).status, 200);
  assert.equal(await h.state.updateEntitlement(h.client, `gp:presentation-paid:${user.id}`, C, "consent"), true);
  assert.equal(await h.state.updateEntitlement(h.client, `gp:presentation-paid:${user.id}`, C, "bind", "program-B"), true);
  const presentation = await h.read(`gp:presentation-paid:${user.id}`);
  const claim = () => h.verify.POST(jsonRequest("https://release.invalid/api/order/verify", { orderNo: C }));
  assert.equal((await claim()).status, 200);
  assert.equal((await h.read(`gp:paid:${user.id}`)).usedProgramId, "program-B");
  assert.deepEqual(await h.read(`gp:presentation-paid:${user.id}`), presentation);
  assert.equal((await claim()).status, 200);
  assert.deepEqual(await h.read(`gp:presentation-paid:${user.id}`), presentation);
});

test("Redis release endpoint: historical presentation replay and fresh bundle cannot erase another unused PT", async (t) => {
  const h = await paymentHarness(t);
  await h.client.set(`gp:validorder:${A}`, { orderNo: A, status: "valid", productId: "presentation" });
  await h.client.set(`gp:validorder:${B}`, { orderNo: B, status: "valid", productId: "bundle" });
  const pt = { orderNo: B, email: user.email, verifiedAt: "2026-09-17", source: "bundle" };
  await h.client.set(`gp:presentation-paid:${user.id}`, pt);
  assert.equal((await h.presentationOrder.POST(jsonRequest("https://release.invalid/api/plan/presentation/order", { orderNo: A }))).status, 409);
  await h.client.set(`gp:validorder:${C}`, { orderNo: C, status: "valid", productId: "bundle" });
  assert.equal((await h.verify.POST(jsonRequest("https://release.invalid/api/order/verify", { orderNo: C }))).status, 409);
  assert.deepEqual(await h.read(`gp:presentation-paid:${user.id}`), pt);
  assert.equal((await h.read(`gp:paid:${user.id}`)).orderNo, B);
  assert.equal(await h.read(`gp:orderused:${C}`), null);
  assert.equal(await h.read(`gp:ordergrant:${C}:word`), null);
});

test("Redis release webhook: forward timeout is bounded, errors redacted and cancelled completion never forwarded", async (t) => {
  const logs = [], timeouts = [], requests = [];
  const signal = new AbortController().signal;
  let transportFailure = false;
  const h = await paymentHarness(t, {
    extraEnv: { BCC_CLAUDE101_GROBLE_CONTENT_ID: "claude", BCC_GROBLE_FORWARD_URL: "https://downstream.invalid", BCC_GROBLE_FORWARD_SECRET: "synthetic-forward-secret" },
    globals: {
      AbortSignal: { timeout(ms) { timeouts.push(ms); return signal; } },
      console: { info() {}, error(...args) { logs.push(args); } },
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (transportFailure) throw new Error("synthetic-sensitive-downstream-detail");
        return { ok: false, status: 500, text() { throw new Error("must not read downstream sensitive body"); } };
      },
    },
  });
  const event = (type, orderNo = C, productId = "claude") => jsonRequest("https://release.invalid/api/groble/webhook?key=synthetic-webhook", {
    type, data: { object: { merchantUid: orderNo, content: { id: productId } } },
  });
  for (const mode of [false, true]) {
    transportFailure = mode;
    const response = await h.webhook.POST(event("payment.completed"));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "downstream unavailable" });
  }
  assert.deepEqual(timeouts, [10_000, 10_000]);
  assert.equal(requests[0].init.signal, signal);
  assert.deepEqual(logs, [[JSON.stringify({ event: "payment_forward", result: "failed" })], [JSON.stringify({ event: "payment_forward", result: "failed" })]]);
  await h.state.cancelOrder(h.client, { orderNo: C, status: "cancelled", registeredAt: "2026-09-17", via: "webhook", productId: "claude" });
  assert.equal((await (await h.webhook.POST(event("payment.completed"))).json()).action, "cancelled");
  assert.equal((await h.read(`gp:validorder:${C}`)).status, "cancelled");
  assert.equal((await (await h.webhook.POST(event("payment.pending"))).json()).action, "ignored");
  assert.equal(requests.length, 2, "cancelled completion and unknown events must not forward");
});

async function prestageHarness(t, baseline = false) {
  const db = baseline ? memoryRedis() : await actualRedis(t); let fail = true, attempts = 0, stored = 0;
  const reservation = baseline ? {} : evaluate("lib/leads/prestageReservation.ts", { imports: { "node:crypto": { randomUUID } } });
  const route = evaluate("app/api/lead/prestage/route.ts", { baseline, env, imports: {
    "@upstash/redis": db, "@/lib/ratelimit": rateOk,
    "@/lib/leads/prestageReservation": reservation,
    "@/lib/plan/paidAccess": { getAuthedUser: async () => user },
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => ({ insert: () => {
      const work = Promise.resolve().then(() => {
      attempts++; if (fail) return { error: { code: "PGRST204", message: "synthetic missing stage" } };
      stored++; return { error: null };
      });
      work.abortSignal = () => work;
      return work;
    } }) }) },
  } });
  return { ...route, ...db, restore() { fail = false; }, get attempts() { return attempts; }, get stored() { return stored; } };
}
test("release evidence: baseline prestage outage permanently suppresses successful retry", async () => {
  const h = await prestageHarness(null, true);
  assert.equal((await h.POST(jsonRequest("https://release.invalid/api/lead/prestage", {}))).status, 503);
  h.restore();
  const response = await h.POST(jsonRequest("https://release.invalid/api/lead/prestage", {}));
  assert.equal((await response.json()).dup, true);
  assert.equal(h.stored, 0); assert.equal(h.attempts, 2);
});
test("Redis release invariant: prestage retries persist after a temporary database failure", async (t) => {
  const h = await prestageHarness(t);
  assert.equal((await h.POST(jsonRequest("https://release.invalid/api/lead/prestage", {}))).status, 503);
  h.restore();
  const response = await h.POST(jsonRequest("https://release.invalid/api/lead/prestage", {}));
  assert.equal(response.status, 200);
  assert.equal(h.stored, 1, "success after recovery must correspond to a persisted lead");
});

test("release invariant: operations refuses unauthenticated or non-admin access before touching storage", async () => {
  const domain = evaluate("lib/operations/domain.ts");
  const { operationsRequest } = evaluate("lib/operations/http.ts", { imports: { "./domain.ts": domain, "./storage.ts": { OperationsStorageAccessError: class extends Error {} }, "node:crypto": { randomUUID } } });
  for (const actor of [null, user]) for (const method of ["GET", "PUT"]) {
    const req = new Request("https://release.invalid/api/operations", { method });
    const response = await operationsRequest(req, {
      authenticate: async () => actor,
      store() { throw new Error("Storage must not be reached"); },
    });
    assert.equal(response.status, actor ? 403 : 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("release invariant: operations local bypass is closed for production and hostile host", () => {
  const domain = evaluate("lib/operations/domain.ts");
  const { isLocalOperationsRequest } = evaluate("lib/operations/http.ts", { imports: { "./domain.ts": domain, "./storage.ts": { OperationsStorageAccessError: class extends Error {} }, "node:crypto": { randomUUID } } });
  assert.equal(isLocalOperationsRequest(new Request("http://localhost/api/operations"), { NODE_ENV: "production", OPS_LOCAL_MODE: "on" }), false);
  assert.equal(isLocalOperationsRequest(new Request("http://localhost/api/operations", { headers: { host: "attacker.invalid" } }), { NODE_ENV: "development", OPS_LOCAL_MODE: "on" }), false);
  assert.equal(isLocalOperationsRequest(new Request("http://127.0.0.1/api/operations"), { NODE_ENV: "development", OPS_LOCAL_MODE: "on" }), true);
});

test("release invariant: rate store absence and SDK timeout reject production cost paths", async () => {
  const absent = evaluate("lib/ratelimit.ts", { env: { NODE_ENV: "production" }, imports: {
    "@upstash/redis": {}, "@upstash/ratelimit": {},
  } });
  assert.equal((await absent.checkRateLimit(new Request("https://release.invalid"), "chat")).unavailable, true);
  const timeout = evaluate("lib/ratelimit.ts", { env, imports: {
    "@upstash/redis": { Redis: class {} },
    "@upstash/ratelimit": { Ratelimit: class {
      static slidingWindow() { return {}; }
      async limit() { return { success: true, reason: "timeout" }; }
    } },
  } });
  const result = await timeout.checkRateLimit(new Request("https://release.invalid"), "chat");
  assert.equal(result.ok, false); assert.equal(result.unavailable, true);
  assert.equal(timeout.tooManyRequests(result.retryAfter, result.unavailable).status, 503);
});
