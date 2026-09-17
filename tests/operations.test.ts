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
  CAS_SCRIPT,
  type OperationsStore,
} from "../lib/operations/storage.ts";

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
    if ((this.values.get(month)?.revision ?? 0) !== revision) return false;
    this.values.set(month, structuredClone(next));
    return true;
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
  assert.deepEqual(results.sort(), [false, true]);
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
test("Redis compare-and-set script checks revision before writing", () => {
  assert.match(CAS_SCRIPT, /revision ~= tonumber\(ARGV\[1\]\)/);
  assert.ok(
    CAS_SCRIPT.indexOf("return 0") < CAS_SCRIPT.indexOf("redis.call('SET'"),
  );
});
