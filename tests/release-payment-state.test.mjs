import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadScaleModule, labRedis, redisCommand } from "./helpers/scale-harness.mjs";
const p = loadScaleModule("lib/plan/paymentState.ts");
let sequence = 0;
const jsonGet = async (key) => { const raw = await redisCommand("GET", key); return raw ? JSON.parse(raw) : null; };
async function fixture(t) {
  const users = [`release-${randomUUID()}`, `release-${randomUUID()}`];
  const orders = [0, 1, 2].map(() => `${Date.now()}${String(sequence++).padStart(6, "0")}`);
  const keys = [...users.flatMap((u) => [p.PAID_KEY(u), p.PRESENTATION_PAID_KEY(u)]), ...orders.flatMap((o) => [p.VALID_ORDER_KEY(o), p.ORDER_USED_KEY(o), `gp:ordergrant:${o}:word`, `gp:ordergrant:${o}:presentation`])];
  t.after(() => redisCommand("DEL", ...keys));
  const valid = (orderNo, productId = "word") => p.registerOrder(labRedis, { orderNo, productId, status: "valid", via: "webhook", registeredAt: new Date().toISOString() });
  const claim = (orderNo, { userId = users[0], mode = "word", bundle = false } = {}) => p.claimOrder(labRedis, { userId, mode, bundle,
    productId: bundle ? "bundle" : mode,
    record: { orderNo, email: "synthetic@example.invalid", verifiedAt: new Date().toISOString(), ...(mode === "presentation" ? { source: bundle ? "bundle" : "presentation" } : {}) } });
  const cancel = (orderNo) => p.cancelOrder(labRedis, { orderNo, registeredAt: new Date().toISOString(), via: "webhook", status: "cancelled" });
  return { users, orders, valid, claim, cancel };
}

test("Redis payment: historical order cannot replace a later consumed entitlement", async (t) => {
  const { users: [u], orders: [a, b], valid, claim } = await fixture(t);
  await valid(a); await valid(b);
  assert.equal((await claim(a)).status, 0);
  assert.equal(await p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", "program-A"), true);
  assert.equal((await claim(b)).status, 0);
  await p.updateEntitlement(labRedis, p.PAID_KEY(u), b, "bind", "program-B");
  assert.equal((await claim(a)).status, -2);
  assert.equal((await jsonGet(p.PAID_KEY(u))).usedProgramId, "program-B");
});

test("Redis payment: concurrent owners can grant a given order only once", async (t) => {
  const { users, orders: [a], valid, claim } = await fixture(t); await valid(a);
  const results = await Promise.all(users.map((userId) => claim(a, { userId })));
  assert.deepEqual(results.map((x) => x.status).sort(), [-2, 0]);
  assert.equal((await Promise.all(users.map((u) => jsonGet(p.PAID_KEY(u))))).filter(Boolean).length, 1);
});

test("Redis payment: concurrent new orders do not overwrite an unused purchase", async (t) => {
  const { orders: [a, b], valid, claim } = await fixture(t); await valid(a); await valid(b);
  const results = await Promise.all([claim(a), claim(b)]);
  assert.deepEqual(results.map((x) => x.status).sort(), [-3, 0]);
  const loser = results[0].status < 0 ? a : b;
  assert.equal(await redisCommand("GET", p.ORDER_USED_KEY(loser)), null);
});

test("Redis payment: idempotent retry retains the program and one concurrent program loses", async (t) => {
  const { users: [u], orders: [a], valid, claim } = await fixture(t); await valid(a); await claim(a);
  const results = await Promise.all(["A", "B"].map((id) => p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", id)));
  assert.deepEqual(results.sort(), [false, true]);
  const bound = await jsonGet(p.PAID_KEY(u));
  assert.equal((await claim(a)).status, 1);
  assert.deepEqual(await jsonGet(p.PAID_KEY(u)), bound);
  assert.equal(await p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", bound.usedProgramId), true);
});

test("Redis payment: historical cancellation preserves both newer product entitlements", async (t) => {
  const { users: [u], orders: [a, b], valid, claim, cancel } = await fixture(t);
  await valid(a, "bundle"); await claim(a, { bundle: true });
  await p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", "A");
  await p.updateEntitlement(labRedis, p.PRESENTATION_PAID_KEY(u), a, "bind", "A");
  await valid(b, "bundle"); await claim(b, { bundle: true });
  assert.equal(await cancel(a), 0);
  assert.equal((await jsonGet(p.PAID_KEY(u))).orderNo, b);
  assert.equal((await jsonGet(p.PRESENTATION_PAID_KEY(u))).orderNo, b);
  assert.equal(await cancel(b), 2);
  assert.equal(await jsonGet(p.PAID_KEY(u)), null);
  assert.equal(await jsonGet(p.PRESENTATION_PAID_KEY(u)), null);
});

test("Redis payment: cancellation remains terminal after completion and recovery retries", async (t) => {
  const { orders: [a], valid, claim, cancel } = await fixture(t);
  await cancel(a);
  assert.equal((await valid(a)).status, "cancelled");
  assert.equal((await claim(a)).status, -1);
});

test("Redis payment: grant versus cancel cannot leave an active refunded credit", async (t) => {
  const { users: [u], orders: [a], valid, claim, cancel } = await fixture(t); await valid(a);
  await Promise.all([claim(a), cancel(a)]);
  assert.equal((await jsonGet(p.VALID_ORDER_KEY(a))).status, "cancelled");
  assert.equal(await jsonGet(p.PAID_KEY(u)), null);
});

test("Redis payment: consent and bind cannot resurrect a refunded bundle", async (t) => {
  const { users: [u], orders: [a], valid, claim, cancel } = await fixture(t);
  await valid(a, "bundle"); await claim(a, { bundle: true });
  await Promise.all([p.updateEntitlement(labRedis, p.PRESENTATION_PAID_KEY(u), a, "consent"), p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", "A"), cancel(a)]);
  assert.equal(await jsonGet(p.PAID_KEY(u)), null);
  assert.equal(await jsonGet(p.PRESENTATION_PAID_KEY(u)), null);
});

test("Redis payment: an old request cannot consume a replacement order", async (t) => {
  const { users: [u], orders: [a, b], valid, claim } = await fixture(t);
  await valid(a); await claim(a); await p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", "A");
  await valid(b); await claim(b);
  assert.equal(await p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", "stale"), false);
  assert.equal((await jsonGet(p.PAID_KEY(u))).orderNo, b);
  assert.equal((await jsonGet(p.PAID_KEY(u))).usedProgramId, undefined);
});

test("Redis payment: presentation-first bundle can grant Word once without erasing consent", async (t) => {
  const { users: [u], orders: [a, b, c], valid, claim } = await fixture(t);
  await valid(a); await claim(a); await p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", "program-A");
  await valid(b, "bundle");
  assert.equal((await claim(b, { mode: "presentation", bundle: true })).status, 0);
  await p.updateEntitlement(labRedis, p.PRESENTATION_PAID_KEY(u), b, "consent");
  await p.updateEntitlement(labRedis, p.PRESENTATION_PAID_KEY(u), b, "bind", "program-A");
  const presentation = await jsonGet(p.PRESENTATION_PAID_KEY(u));
  assert.equal((await claim(b, { bundle: true })).status, 0);
  assert.deepEqual(await jsonGet(p.PRESENTATION_PAID_KEY(u)), presentation);
  assert.equal((await jsonGet(p.PAID_KEY(u))).usedProgramId, "program-A");
  await valid(c); await claim(c);
  assert.equal((await claim(b, { bundle: true })).status, -2);
});

test("Redis payment: a new bundle preserves a different unused presentation purchase", async (t) => {
  const { users: [u], orders: [a, b, c], valid, claim } = await fixture(t);
  await valid(a); await claim(a);
  await p.updateEntitlement(labRedis, p.PAID_KEY(u), a, "bind", "program-A");
  await valid(b, "presentation"); await claim(b, { mode: "presentation" });
  const word = await jsonGet(p.PAID_KEY(u));
  const presentation = await jsonGet(p.PRESENTATION_PAID_KEY(u));
  await valid(c, "bundle");
  assert.equal((await claim(c, { bundle: true })).status, -3);
  assert.deepEqual(await jsonGet(p.PAID_KEY(u)), word);
  assert.deepEqual(await jsonGet(p.PRESENTATION_PAID_KEY(u)), presentation);
  assert.equal(await redisCommand("GET", p.ORDER_USED_KEY(c)), null);
  assert.equal(await redisCommand("GET", `gp:ordergrant:${c}:word`), null);
  await p.updateEntitlement(labRedis, p.PRESENTATION_PAID_KEY(u), b, "bind", "program-A");
  assert.equal((await claim(c, { bundle: true })).status, 0);
});
