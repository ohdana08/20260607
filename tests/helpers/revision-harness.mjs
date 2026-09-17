import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

export const NOW = Date.parse("2026-09-17T00:00:00.000Z");
export const PRODUCTS = {
  word: {
    file: "lib/plan/revisions.ts",
    max: 3,
    read: "getRevisionStatus",
    deliver: "markFirstFinalDelivery",
    reserve: "reserveRevisionRound",
    response: "revisionUnavailableResponse",
    deliveryKey: "gp:delivery:order-1",
    countKey: "gp:revision-count:order-1",
  },
  presentation: {
    file: "lib/plan/presentationRevisions.ts",
    max: 2,
    read: "getPresentationRevisionStatus",
    deliver: "markFirstPresentationDelivery",
    reserve: "reservePresentationRevision",
    response: "presentationRevisionUnavailableResponse",
    deliveryKey: "gp:presentation-delivery:order-1",
    countKey: "gp:presentation-revision-count:order-1",
  },
};

// Load the real public wrappers while replacing only clock, Redis and entitlement I/O.
// No real credentials, network, payment or AI calls are possible in this harness.
export function revisionHarness(product, options = {}) {
  const root = options.root ?? process.cwd();
  let time = NOW;
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [time]));
    }
    static now() {
      return time;
    }
  }
  const values = new Map(),
    calls = [];
  const redis = {
    async get(key) {
      calls.push(["get", key]);
      return values.get(key) ?? null;
    },
    async set(key, value, flags) {
      calls.push(["set", key, value, flags]);
      if (flags?.nx && values.has(key)) return null;
      values.set(key, structuredClone(value));
      return "OK";
    },
    async incr(key) {
      calls.push(["incr", key]);
      const value = Number(values.get(key) ?? 0) + 1;
      values.set(key, value);
      return value;
    },
    async decr(key) {
      calls.push(["decr", key]);
      const value = Number(values.get(key) ?? 0) - 1;
      values.set(key, value);
      return value;
    },
  };
  const paid = async (id) => {
    calls.push(["paid", id]);
    return options.paid === false ? null : { orderNo: "order-1" };
  };
  const mocks = new Map([
    [path.join(root, "lib/plan/paidAccess.ts"), { getPaidRecord: paid }],
    [
      path.join(root, "lib/plan/presentationAccess.ts"),
      { getPresentationPaidRecord: paid },
    ],
  ]);
  const cache = new Map();
  function load(file) {
    if (mocks.has(file)) return mocks.get(file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const js = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    }).outputText;
    const require = (name) => {
      if (name === "@upstash/redis")
        return {
          Redis: class {
            constructor() {
              return redis;
            }
          },
        };
      const base = name.startsWith("@/")
        ? path.join(root, name.slice(2))
        : path.resolve(path.dirname(file), name);
      const found = [base, `${base}.ts`].find((p) => existsSync(p));
      if (!found || !found.startsWith(path.join(root, "lib") + path.sep))
        throw new Error(`Unexpected dependency: ${name}`);
      return load(found);
    };
    vm.runInNewContext(
      js,
      {
        module: loaded,
        exports: loaded.exports,
        require,
        Date: FixedDate,
        Response,
        process: {
          env:
            options.storage === false
              ? {}
              : {
                  UPSTASH_REDIS_REST_URL: "https://test.invalid",
                  UPSTASH_REDIS_REST_TOKEN: "test-only",
                },
        },
      },
      { filename: file },
    );
    return loaded.exports;
  }
  return {
    api: load(path.join(root, product.file)),
    values,
    calls,
    redis,
    advance(ms) {
      time += ms;
    },
    seedDelivery(offset = 86400000) {
      values.set(product.deliveryKey, {
        deliveredAt: new Date(NOW - 86400000).toISOString(),
        expiresAt: new Date(NOW + offset).toISOString(),
      });
    },
  };
}

export const SCENARIOS = [
  "empty",
  "admin",
  "anonymous",
  "missing-order",
  "missing-storage",
  "first-delivery",
  "before-delivery",
  "reserve-rollback",
  "limit",
  "expired",
  "expiry-boundary",
  "negative-count",
  "concurrent-limit",
  "response-expired",
  "response-limit",
];

export async function captureRevisionScenario(product, scenario, root) {
  const h = revisionHarness(product, {
    root,
    paid: scenario !== "missing-order",
    storage: scenario !== "missing-storage",
  });
  const { api, values, calls } = h;
  const read = (admin = false) => api[product.read]("user-1", admin);
  const reserve = (user = "user-1", admin = false) =>
    api[product.reserve](user, admin);
  let result;
  if (scenario === "empty") result = await read();
  if (scenario === "admin")
    result = [
      await read(true),
      await api[product.deliver]("user-1", true),
      await reserve("user-1", true),
    ];
  if (scenario === "anonymous") result = await api[product.reserve]();
  if (scenario === "missing-order" || scenario === "missing-storage")
    result = [await read(), await reserve()];
  if (scenario === "first-delivery") {
    result = [await api[product.deliver]("user-1")];
    h.advance(86400000);
    result.push(await api[product.deliver]("user-1"));
  }
  if (scenario === "before-delivery") result = await reserve();
  if (scenario === "reserve-rollback") {
    h.seedDelivery();
    const r = await reserve();
    result = [r];
    await r.rollback();
    await r.rollback();
    result.push(await read());
  }
  if (scenario === "limit" || scenario === "response-limit") {
    h.seedDelivery();
    values.set(product.countKey, product.max);
    result = await reserve();
  }
  if (scenario === "expired" || scenario === "response-expired") {
    h.seedDelivery(-1);
    result = await reserve();
  }
  if (scenario === "expiry-boundary") {
    h.seedDelivery(0);
    result = await reserve();
  }
  if (scenario === "negative-count") {
    h.seedDelivery();
    values.set(product.countKey, -2);
    result = await read();
  }
  if (scenario === "concurrent-limit") {
    h.seedDelivery();
    const reservations = await Promise.all(
      Array.from({ length: product.max + 2 }, () => reserve()),
    );
    result = reservations.map(({ ok, counted }) => ({ ok, counted }));
  }
  if (scenario.startsWith("response-")) {
    const response = api[product.response](result.status);
    result = { httpStatus: response.status, body: await response.json() };
  }
  // JSON removes callback functions and cross-realm prototypes from observations.
  return JSON.parse(JSON.stringify({ result, values: [...values], calls }));
}
