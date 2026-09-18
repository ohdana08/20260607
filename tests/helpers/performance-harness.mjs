import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
export const baselineRoot = path.join(root, "tests/fixtures/performance-before");
export const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Load actual source in an isolated environment. No credentials or real network.
export function performanceModules({ before = false, sourceRoot, mocks = {}, globals = {}, env = {} } = {}) {
  const cache = new Map();
  const sources = {};
  function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const savedRoot = sourceRoot ?? (before ? baselineRoot : null);
    const saved = savedRoot && path.join(savedRoot, path.relative(root, file) + ".source");
    const source = saved && existsSync(saved) ? saved : file;
    const sourceText = readFileSync(source, "utf8");
    sources[path.relative(root, file)] = { path: source, sha256: createHash("sha256").update(sourceText).digest("hex") };
    const loaded = { exports: {} }; cache.set(file, loaded);
    const require = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (!name.startsWith(".") && !name.startsWith("@/")) return nativeRequire(name);
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      const target = [base, base + ".ts", base + ".tsx"].find((candidate) => existsSync(candidate));
      if (Object.hasOwn(mocks, path.relative(root, target))) return mocks[path.relative(root, target)];
      return load(target);
    };
    const code = ts.transpileModule(sourceText, {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module: loaded, exports: loaded.exports, require, process: { env, cwd: () => root }, console,
      Request, Response, Headers, URL, Date, Buffer, TextDecoder, TextEncoder, ReadableStream,
      AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval,
      fetch: async () => { throw new Error("Real network is disabled in performance tests"); }, ...globals,
    }, { filename: source });
    return loaded.exports;
  }
  return { load, sources };
}

export function programsFixture(size) {
  const sources = ["egbiz", "kstartup", "bojo", "bizinfo", "nipa", "kocca", "smtech"];
  const titles = ["창업 사업화 지원", "기술개발 바우처", "교육생 모집", "사무실 입주", "수출 마케팅 지원", "제주 소재 사업장 지원", "판교 관내 기업 지원"];
  return Array.from({ length: size }, (_, i) => ({
    id: `${sources[i % 7]}:${i}`, source: sources[i % 7], title: `${titles[i % 7]} ${i}`,
    summary: "신청 자격과 제출 자료를 확인하는 지원사업 안내. ".repeat(4),
    target: i % 4 === 0 ? "창업 3년 이내 기업" : "중소기업 신청 가능",
    supportField: i % 2 ? "창업 사업화" : "기술 R&D", region: i % 4 === 0 ? "부산" : "전국",
    applyEnd: i % 5 === 0 ? null : `2026-12-${String(i % 28 + 1).padStart(2, "0")}`,
    url: `https://example.invalid/program/${i}`, formUrl: null,
  }));
}

export const profilesFixture = [
  { years: "창업초기(3년 이내)", region: "부산", supportType: "사업화", sector: "창업" },
  { years: "예비창업", region: "경기", supportType: "시설·공간", sector: "기술" },
  { years: "7년 이상", region: "전국(중앙부처)", supportType: "멘토링·교육" },
];

export function authHarness({ before = false, latency = 0, reply, clock = Date } = {}) {
  let calls = 0, paidReads = 0;
  const requests = [];
  const modules = performanceModules({ before,
    env: { UPSTASH_REDIS_REST_URL: "https://example.invalid", UPSTASH_REDIS_REST_TOKEN: "test-only" },
    mocks: {
      "lib/auth/config.ts": { AUTH_URL: "https://example.invalid", AUTH_ANON_KEY: "test-only" },
      "@upstash/redis": { Redis: class { async get() { paidReads++; return { orderNo: "test-order" }; } } },
    },
    globals: { Date: clock, fetch: async (url, options) => {
      calls++; requests.push({ url, options }); if (latency) await delay(latency);
      return reply ? reply(calls, options) : Response.json({ id: "fixture-user", email: "fixture@example.invalid", app_metadata: { providers: ["google"] } });
    } },
  });
  return { ...modules.load("lib/auth/googleUser.ts"), ...modules.load("lib/plan/paidAccess.ts"),
    get calls() { return calls; }, get paidReads() { return paidReads; }, requests, sources: modules.sources };
}

export function catalogHarness({ before = false, size = 3000, error = null } = {}) {
  const rows = programsFixture(size).map((p) => ({
    id: p.id, source: p.source, external_id: p.id.split(":")[1], title: p.title, summary: p.summary,
    target: p.target, support_field: p.supportField, region: p.region, apply_end: p.applyEnd,
    url: p.url, form_url: p.formUrl, first_seen_at: "2026-09-01T00:00:00Z",
    last_seen_at: "2026-09-17T00:00:00Z", closed_at: null,
  }));
  const requests = [];
  let responseBytes = 0;
  // Installed Supabase SDK builds the real PostgREST URL; transport returns synthetic rows.
  const { createClient } = nativeRequire("@supabase/supabase-js");
  const client = createClient("https://example.invalid", "test-only", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, options) => {
      const url = new URL(String(input)); requests.push({ url, signal: options?.signal });
      if (error) return Response.json(error, { status: 400 });
      const selection = url.searchParams.get("select"), limit = Number(url.searchParams.get("limit"));
      const data = rows.slice(0, limit).map((row) => selection === "*" ? row : Object.fromEntries(selection.split(",").map((key) => [key, row[key]])));
      const body = JSON.stringify(data); responseBytes += Buffer.byteLength(body);
      return new Response(body, { headers: { "Content-Type": "application/json" } });
    } },
  });
  const modules = performanceModules({ before, mocks: { "lib/supabase/admin.ts": { createAdminClient: () => client } } });
  return { ...modules.load("lib/supabase/programs.ts"), requests, get responseBytes() { return responseBytes; }, sources: modules.sources };
}

export async function cachePromotionScenario(before, kind, readsAfter = 20) {
  let reads = 0, loads = 0, releases = 0;
  const fresh = { value: { version: 1 }, freshUntil: Date.now() + 60_000, staleUntil: Date.now() + 300_000 };
  const store = {
    async read() { reads++; return reads === 1 ? null : fresh; },
    async acquire() { return kind === "acquire-race"; },
    async publish() { throw new Error("unexpected publish"); },
    async release() { releases++; },
  };
  const { SnapshotCache } = performanceModules({ before }).load("lib/scale/snapshotCache.ts");
  const cache = new SnapshotCache(store, async () => { loads++; return { version: 0 }; });
  const first = await cache.get();
  const readsAtPromotion = reads;
  for (let i = 0; i < readsAfter; i++) await cache.get();
  return { reads, readsAtPromotion, readsAfterPromotion: reads - readsAtPromotion, loads, releases, first };
}
