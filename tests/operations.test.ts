import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyCommand,
  initialMonth,
  InputError,
  kstDate,
  parseMutation,
  parseSnapshot,
  parseVideo,
  summarize,
  validDate,
  type OperationsMonth,
  type Snapshot,
} from "../lib/operations/domain.ts";
import {
  isLocalOperationsRequest,
  operationsRequest,
} from "../lib/operations/http.ts";
import {
  LocalOperationsStore,
  PostgresOperationsStore,
  OPERATIONS_RPC_TIMEOUT_MS,
  OperationsStorageAccessError,
  type OperationsStore,
} from "../lib/operations/storage.ts";
import { AUTH_ANON_KEY, AUTH_URL } from "../lib/auth/config.ts";

const now = new Date("2026-09-17T00:00:00Z");
const zero: Snapshot = {
  asOf: "2026-09-17",
  grossKrw: 0,
  refundsKrw: 0,
  wordOrders: 0,
  bundleOrders: 0,
  presentationOrders: 0,
  publishedVideos: 0,
  views: null,
  siteVisits: null,
  attributedOrders: null,
  attributedNetKrw: null,
  note: "테스트 자료",
};
class MemoryStore implements OperationsStore {
  values = new Map<string, OperationsMonth>();
  async read(month: string) {
    return structuredClone(this.values.get(month) ?? null);
  }
  async compareAndSet(month: string, revision: number, next: OperationsMonth) {
    if ((this.values.get(month)?.revision ?? 0) !== revision) return null;
    this.values.set(month, structuredClone(next));
    return structuredClone(next);
  }
}
const mutation = (value: unknown = zero, revision = 0) => ({
  month: "2026-09",
  expectedRevision: revision,
  command: { kind: "snapshot", value },
});
const put = (
  body: unknown = mutation(),
  headers: Record<string, string> = {},
) =>
  new Request("http://localhost:3107/api/operations", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const admin = async () => ({ id: "operator-1", isAdmin: true });
const deps = (store: OperationsStore) => ({
  authenticate: admin,
  store: () => store,
  now: () => now,
});

test("Gregorian dates reject September 31 and accept leap day", () => {
  assert.equal(validDate("2026-09-31"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
});
test("Korea midnight changes the reporting day", () =>
  assert.equal(kstDate(new Date("2026-09-16T15:00:00Z")), "2026-09-17"));
test("empty storage does not fabricate zero sales", () =>
  assert.equal(summarize(initialMonth("2026-09"), "2026-09-17").netKrw, null));
test("confirmed zero produces 34 orders, 14 days and 71429 KRW daily", () => {
  const s = summarize(
    applyCommand(
      initialMonth("2026-09"),
      { kind: "snapshot", value: zero },
      "x",
      now,
    ),
    "2026-09-17",
  );
  assert.deepEqual(
    [s.netKrw, s.neededWordOrders, s.remainingDays, s.dailyRevenueKrw],
    [0, 34, 14, 71429],
  );
});
test("refunds change remaining sales without double counting bundled orders", () => {
  const s = summarize(
    applyCommand(
      initialMonth("2026-09"),
      {
        kind: "snapshot",
        value: {
          ...zero,
          grossKrw: 104600,
          refundsKrw: 29900,
          wordOrders: 2,
          bundleOrders: 1,
        },
      },
      "x",
      now,
    ),
    "2026-09-17",
  );
  assert.equal(s.netKrw, 74700);
  assert.equal(s.neededWordOrders, 31);
});
test("snapshot updates replace the date rather than summing cumulative values", () => {
  let s = applyCommand(
    initialMonth("2026-09"),
    { kind: "snapshot", value: { ...zero, grossKrw: 29900, wordOrders: 1 } },
    "a",
    now,
  );
  s = applyCommand(
    s,
    { kind: "snapshot", value: { ...zero, grossKrw: 59800, wordOrders: 2 } },
    "b",
    now,
  );
  assert.equal(s.snapshots.length, 1);
  assert.equal(summarize(s, "2026-09-17").netKrw, 59800);
  assert.equal(s.audit[1].actorId, "b");
});
test("latest reporting date wins even when an earlier date is edited later", () => {
  let s = applyCommand(
    initialMonth("2026-09"),
    { kind: "snapshot", value: { ...zero, grossKrw: 59800, wordOrders: 2 } },
    "x",
    now,
  );
  s = applyCommand(
    s,
    {
      kind: "snapshot",
      value: { ...zero, asOf: "2026-09-16", grossKrw: 29900, wordOrders: 1 },
    },
    "x",
    now,
  );
  assert.equal(summarize(s, "2026-09-17").netKrw, 59800);
});
test("deadline reached retains today and after deadline never divides by zero", () => {
  const s = applyCommand(
    initialMonth("2026-09"),
    { kind: "snapshot", value: zero },
    "x",
    now,
  );
  assert.equal(summarize(s, "2026-09-30").remainingDays, 1);
  const after = summarize(s, "2026-10-01");
  assert.equal(after.remainingDays, 0);
  assert.equal(after.dailyRevenueKrw, null);
});
test("achieved goal has no additional order requirement", () => {
  const s = applyCommand(
    initialMonth("2026-09"),
    { kind: "snapshot", value: { ...zero, grossKrw: 1016600, wordOrders: 34 } },
    "x",
    now,
  );
  assert.equal(summarize(s, "2026-09-17").neededWordOrders, 0);
});
test("null metrics stay unknown and zero visits do not yield conversion", () => {
  const s = applyCommand(
    initialMonth("2026-09"),
    { kind: "snapshot", value: { ...zero, siteVisits: 0 } },
    "x",
    now,
  );
  assert.equal(summarize(s, "2026-09-17").ordersPer100Visits, null);
});
for (const [name, override] of Object.entries({
  negative: { grossKrw: -1 },
  fraction: { wordOrders: 0.5 },
  overflow: { views: Number.MAX_SAFE_INTEGER + 1 },
  future: { asOf: "2026-09-18" },
  wrongMonth: { asOf: "2026-08-17" },
  refundExceedsGross: { refundsKrw: 1 },
  wrongAttribution: { attributedOrders: 1 },
  wrongRevenueAttribution: { attributedNetKrw: 1 },
  missingMetric: { views: undefined },
}))
  test(`snapshot rejects ${name}`, () =>
    assert.throws(
      () => parseSnapshot({ ...zero, ...override }, "2026-09", "2026-09-17"),
      InputError,
    ));
test("unknown actor and authorization fields are rejected", () =>
  assert.throws(
    () => parseMutation({ ...mutation(), isAdmin: true }, "2026-09-17"),
    InputError,
  ));
test("goal rejects reversed dates and a zero price", () => {
  const s = initialMonth("2026-09");
  for (const value of [
    { ...s.goal, startDate: "2026-09-30", deadline: "2026-09-17" },
    { ...s.goal, wordPriceKrw: 0 },
  ])
    assert.throws(
      () =>
        parseMutation(
          {
            month: "2026-09",
            expectedRevision: 0,
            command: { kind: "goal", value },
          },
          "2026-09-17",
        ),
      InputError,
    );
});
const video = {
  id: "v1",
  title: "실제 영상",
  plannedDate: "2026-09-18",
  product: "word",
  status: "planned",
  url: "",
  views24h: null,
  views72h: null,
};
test("unsafe and misleading video URLs are rejected", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://youtube.com.evil.example/shorts/a",
    "https://user:pass@youtube.com/shorts/a",
  ])
    assert.throws(() => parseVideo({ ...video, url }, "2026-09"), InputError);
});
test("published videos require a real destination", () =>
  assert.throws(
    () => parseVideo({ ...video, status: "published" }, "2026-09"),
    InputError,
  ));
test("video upsert keeps one record per id", () => {
  const v = parseVideo(video, "2026-09");
  let s = applyCommand(
    initialMonth("2026-09"),
    { kind: "video", value: v },
    "x",
    now,
  );
  s = applyCommand(
    s,
    { kind: "video", value: { ...v, title: "수정된 영상" } },
    "x",
    now,
  );
  assert.equal(s.videos.length, 1);
  assert.equal(s.videos[0].title, "수정된 영상");
});
test("anonymous and non-admin callers cannot read or write, before storage access", async () => {
  for (const authenticate of [
    async () => null,
    async () => ({ id: "buyer", isAdmin: false }),
  ])
    for (const req of [new Request("http://localhost/api/operations"), put()]) {
      const res = await operationsRequest(req, {
        authenticate,
        store: () => {
          throw new Error("must not access storage");
        },
      });
      assert.equal(
        res.status,
        authenticate === undefined ? 0 : (await authenticate()) ? 403 : 401,
      );
      assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    }
});
test("cross-origin mutations are denied", async () =>
  assert.equal(
    (
      await operationsRequest(
        put(mutation(), { Origin: "https://evil.example" }),
        deps(new MemoryStore()),
      )
    ).status,
    403,
  ));
test("Next.js local request URL normalization preserves the real same-origin host", async () =>
  assert.equal(
    (
      await operationsRequest(
        put(mutation(), {
          Host: "127.0.0.1:3107",
          Origin: "http://127.0.0.1:3107",
        }),
        deps(new MemoryStore()),
      )
    ).status,
    200,
  ));
test("GET initialization has no write side effect", async () => {
  const store = new MemoryStore();
  const res = await operationsRequest(
    new Request("http://localhost/api/operations?month=2026-09"),
    deps(store),
  );
  assert.equal(res.status, 200);
  assert.equal(store.values.size, 0);
});
test("PUT persists data and audit actor comes from server", async () => {
  const store = new MemoryStore();
  const res = await operationsRequest(put(), deps(store));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.state.revision, 1);
  assert.equal(data.state.audit[0].actorId, "operator-1");
  assert.equal(data.automaticCollection, false);
  assert.equal((await store.read("2026-09"))?.snapshots.length, 1);
});
test("retries with a stale revision cannot silently overwrite stored data", async () => {
  const store = new MemoryStore();
  await operationsRequest(put(), deps(store));
  assert.equal(
    (
      await operationsRequest(
        put(mutation({ ...zero, grossKrw: 99999 })),
        deps(store),
      )
    ).status,
    409,
  );
  assert.equal((await store.read("2026-09"))?.snapshots[0].grossKrw, 0);
});
test("two concurrent writers result in one success and one conflict", async () => {
  const store = new MemoryStore();
  const results = await Promise.all([
    operationsRequest(put(), deps(store)),
    operationsRequest(put(), deps(store)),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});
test("malformed, oversized and wrong content type requests do not persist", async () => {
  const store = new MemoryStore();
  for (const req of [
    new Request("http://localhost/api/operations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
    put({ huge: "a".repeat(17000) }),
    new Request("http://localhost/api/operations", {
      method: "PUT",
      body: "{}",
    }),
  ])
    assert.equal((await operationsRequest(req, deps(store))).status, 400);
  assert.equal(store.values.size, 0);
});
test("storage outage is explicit and never appears as zero performance", async () => {
  const res = await operationsRequest(
    new Request("http://localhost/api/operations"),
    {
      authenticate: admin,
      store: () => {
        throw new Error("sensitive credential");
      },
    },
  );
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /sensitive credential/);
});
test("local mode is impossible in production and on remote hosts", () => {
  assert.equal(
    isLocalOperationsRequest(new Request("http://localhost/api/operations"), {
      NODE_ENV: "production",
      OPS_LOCAL_MODE: "on",
    }),
    false,
  );
  assert.equal(
    isLocalOperationsRequest(
      new Request("https://ddakfit.bccconsulting.kr/api/operations"),
      { NODE_ENV: "development", OPS_LOCAL_MODE: "on" },
    ),
    false,
  );
  assert.equal(
    isLocalOperationsRequest(new Request("http://127.0.0.1/api/operations"), {
      NODE_ENV: "development",
      OPS_LOCAL_MODE: "on",
    }),
    true,
  );
});
test("normalized localhost URL cannot enable local mode for a remote Host", () => {
  assert.equal(
    isLocalOperationsRequest(
      new Request("http://localhost:3107/api/operations", {
        headers: { host: "untrusted.example:3107" },
      }),
      { NODE_ENV: "development", OPS_LOCAL_MODE: "on" },
    ),
    false,
  );
});
test("local adapter persists across instances and performs atomic compare-and-set", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ddakfit-ops-test-"));
  const first = new LocalOperationsStore(dir);
  const state = applyCommand(
    initialMonth("2026-09"),
    { kind: "snapshot", value: zero },
    "local",
    now,
  );
  const results = await Promise.all([
    first.compareAndSet("2026-09", 0, state),
    new LocalOperationsStore(dir).compareAndSet("2026-09", 0, state),
  ]);
  assert.equal(results.filter((value) => value === null).length, 1);
  assert.deepEqual(results.find((value) => value !== null), state);
  assert.equal(
    (await new LocalOperationsStore(dir).read("2026-09"))?.revision,
    1,
  );
  assert.equal(
    JSON.parse(await readFile(path.join(dir, "2026-09.json"), "utf8"))
      .schemaVersion,
    1,
  );
});
const testCapability = "synthetic-capability-only-".padEnd(43, "x");
const rpcState = () => applyCommand(initialMonth("2026-09"), { kind: "snapshot", value: zero }, "operator-1", now);
test("Postgres reads forward each request JWT and public key with server-only scope capability", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return Response.json(calls.length === 1 ? null : rpcState());
  };
  assert.equal(await new PostgresOperationsStore("Bearer jwt-one", "preview", testCapability, transport).read("2026-09"), null);
  assert.deepEqual(await new PostgresOperationsStore("Bearer jwt-two", "preview", testCapability, transport).read("2026-09"), rpcState());
  for (const [index, { url, init }] of calls.entries()) {
    assert.equal(url, `${AUTH_URL}/rest/v1/rpc/ddakfit_operations_read`);
    assert.deepEqual(init.headers, { apikey: AUTH_ANON_KEY, Authorization: `Bearer jwt-${index === 0 ? "one" : "two"}`, "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(String(init.body)), { p_month: "2026-09", p_scope: "preview", p_capability: testCapability });
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(OPERATIONS_RPC_TIMEOUT_MS, 3_000);
});
test("Postgres CAS returns canonical state or conflict null and binds expected revision", async () => {
  let count = 0;
  const state = rpcState();
  const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async (url, init) => {
    count++;
    assert.equal(String(url), `${AUTH_URL}/rest/v1/rpc/ddakfit_operations_compare_and_set`);
    assert.deepEqual(JSON.parse(String(init?.body)), { p_month: "2026-09", p_expected_revision: 0, p_next: state, p_scope: "preview", p_capability: testCapability });
    return Response.json(count === 1 ? state : null);
  });
  assert.deepEqual(await store.compareAndSet("2026-09", 0, state), state);
  assert.equal(await store.compareAndSet("2026-09", 0, state), null);
  assert.equal(count, 2);
});
test("Postgres rejects absent identity, capability and invalid revisions before network access", async () => {
  for (const authorization of ["", "Basic token", "Bearer ", "Bearer a b"]) {
    assert.throws(() => new PostgresOperationsStore(authorization, "preview", testCapability), /authentication required/);
  }
  for (const [scope, capability] of [["../production", testCapability], ["preview", ""], ["preview", "too-short"]]) {
    assert.throws(() => new PostgresOperationsStore("Bearer test-jwt", scope, capability), /not configured/);
  }
  const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async () => { throw new Error("network must not be called"); });
  await assert.rejects(store.read("../2026-09"), /Invalid operations month/);
  for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER, 1]) {
    await assert.rejects(store.compareAndSet("2026-09", revision, rpcState()), /Invalid operations revision/);
  }
  await assert.rejects(store.compareAndSet("2026-08", 0, rpcState()), /Invalid operations revision/);
});
test("Postgres RPC failures are redacted and writes are never automatically retried", async () => {
  for (const response of [
    () => new Response("secret upstream detail and test-jwt", { status: 503 }),
    () => new Response("not-json", { status: 200 }),
    () => Response.json({ result: true }),
  ]) {
    let calls = 0;
    const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async () => { calls++; return response(); });
    await assert.rejects(store.compareAndSet("2026-09", 0, rpcState()), { message: "Operations storage unavailable" });
    assert.equal(calls, 1);
  }
});
test("Postgres rejects malformed or cross-month read envelopes", async () => {
  for (const value of [false, {}, { ...rpcState(), revision: 0 }, { ...rpcState(), goal: { ...rpcState().goal, month: "2026-08" } }, { ...rpcState(), snapshots: null }]) {
    const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async () => Response.json(value));
    await assert.rejects(store.read("2026-09"), { message: "Operations storage unavailable" });
  }
});
test("Postgres aborts stalled writes without a retry or leaking transport errors", async () => {
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async (_url, init) => {
    calls++;
    signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("secret transport failure")), { once: true }));
  }, 15);
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    await assert.rejects(store.compareAndSet("2026-09", 0, rpcState()), { message: "Operations storage unavailable" });
    assert.equal(signal?.aborted, true);
    assert.equal(calls, 1);
  } finally {
    clearTimeout(keepAlive);
  }
});
test("Postgres conflict maps to HTTP 409 while outage maps to safe HTTP 503", async () => {
  for (const fail of [false, true]) {
    let writes = 0;
    const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async (url) => {
      if (String(url).endsWith("_read")) return Response.json(null);
      writes++;
      return fail ? new Response("synthetic-secret", { status: 503 }) : Response.json(null);
    });
    const res = await operationsRequest(put(), deps(store));
    assert.equal(res.status, fail ? 503 : 409);
    assert.doesNotMatch(await res.text(), /synthetic-secret|test-jwt|capability/);
    assert.ok(res.headers.get("x-request-id"));
    assert.equal(writes, 1);
  }
});

test("Postgres 401/403 become typed storage denial and safe API 403", async () => {
  for (const status of [401, 403]) {
    const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async () => new Response("secret policy detail", { status }));
    await assert.rejects(store.read("2026-09"), OperationsStorageAccessError);
    for (const req of [new Request("http://localhost/api/operations?month=2026-09"), put()]) {
      const response = await operationsRequest(req, deps(store));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "운영 기록 접근 권한을 확인해 주세요.", code: "storage_forbidden" });
    }
  }
});
test("database input contract errors stay redacted server failures", async () => {
  const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async () => new Response("private SQL contract", { status: 400 }));
  const response = await operationsRequest(put(), deps(store));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /SQL|private/);
});
test("PUT returns the canonical database audit and matches the next GET without extra RPC", async () => {
  let stored: OperationsMonth | null = null;
  let calls = 0;
  const store = new PostgresOperationsStore("Bearer test-jwt", "preview", testCapability, async (url, init) => {
    calls++;
    if (String(url).endsWith("_read")) return Response.json(stored);
    stored = JSON.parse(String(init?.body)).p_next;
    stored!.audit[0].at = "2026-09-17T00:00:00.789Z";
    stored!.audit[0].actorId = "database-verified-operator";
    return Response.json(stored);
  });
  const written = await operationsRequest(put(), deps(store));
  assert.equal(written.status, 200);
  assert.equal(calls, 2);
  const saved = (await written.json()).state;
  assert.equal(saved.audit[0].at, "2026-09-17T00:00:00.789Z");
  assert.equal(saved.audit[0].actorId, "database-verified-operator");
  const read = await operationsRequest(new Request("http://localhost/api/operations?month=2026-09"), deps(store));
  assert.deepEqual((await read.json()).state, saved);
  assert.equal(calls, 3);
});
