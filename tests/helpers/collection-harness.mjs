import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";

export const RUN_AT = new Date("2026-09-17T02:00:00Z");
export const listing = (ids, total = ids.length) => `
  <div>경기도 지원사업 <span class="num">${total}</span> 건</div>
  <table>${ids.map((id) => `<tr><td>1</td>
    <td><a onclick="fn_supportPrjDtl('${id}')">경기 창업 지원사업</a></td>
    <td>경기도</td><td>2026-09-01 ~ 2026-12-31</td><td>접수중</td></tr>`).join("")}</table>
  <div>타기관 지원사업</div>`;

// Actual collector + persistence + route code, with network, DB and clock isolated.
// No env files or production credentials are loaded.
export function collectionHarness(options = {}) {
  const root = process.cwd(), cache = new Map();
  const logs = [], calls = [], requests = [];
  let elapsed = 0;
  const rows = new Map((options.rows ?? []).map((row) => [row.id, structuredClone(row)]));
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [RUN_AT.getTime() + elapsed])); }
    static now() { return RUN_AT.getTime() + elapsed; }
  }
  function query() {
    let operation = "select", payload, filters = [];
    const builder = {
      select() { return builder; },
      upsert(value) { operation = "upsert"; payload = value; return builder; },
      update(value) { operation = "update"; payload = value; return builder; },
      eq(key, value) { filters.push((row) => row[key] === value); return builder; },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return builder; },
      lt(key, value) { filters.push((row) => row[key] < value); return builder; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          calls.push(operation);
          if (options.dbError) throw options.dbError;
          const matches = [...rows.values()].filter((row) => filters.every((f) => f(row)));
          if (operation === "upsert") {
            for (const row of payload) rows.set(row.id, { ...rows.get(row.id), ...row });
          }
          if (operation === "update") for (const row of matches) Object.assign(row, payload);
          return { data: structuredClone(matches), error: null };
        }).then(resolve, reject);
      },
    };
    return builder;
  }
  function load(relative) {
    const file = path.resolve(root, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const require = (name) => {
      if (name === "node:crypto") return { randomUUID };
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      const resolved = [base, `${base}.ts`].find((candidate) => existsSync(candidate));
      if (resolved === path.join(root, "lib/supabase/admin.ts")) {
        return { createAdminClient: () => ({ from: () => query() }) };
      }
      if (resolved === path.join(root, "lib/data/collect.ts")) {
        return {
          COLLECTABLE_SOURCES: ["egbiz", "nipa"],
          collectSource: async (source) => source === "egbiz"
            ? load("lib/data/egbiz.ts").fetchEgbizOpen()
            : [],
        };
      }
      if (!resolved || !resolved.startsWith(`${root}/lib/`)) throw new Error(`Unexpected import ${name}`);
      return load(path.relative(root, resolved));
    };
    const js = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText;
    vm.runInNewContext(js, {
      module: loaded, exports: loaded.exports, require, Date: Clock, Response, Request, URL, URLSearchParams,
      AbortSignal, setTimeout, clearTimeout,
      console: Object.fromEntries(["log", "warn", "error"].map((level) => [level, (...args) => logs.push({ level, args })])),
      process: { env: { CRON_SECRET: "test-only" } },
      fetch: async (url, init) => {
        const page = Number(new URL(url).searchParams.get("pageIndex"));
        requests.push({ page, signal: init?.signal });
        if (!options.fetch) throw new Error("Network disabled: missing test fixture");
        return options.fetch(page, init);
      },
    }, { filename: file });
    return loaded.exports;
  }
  return { load, rows, logs, calls, requests, advance: (ms) => { elapsed += ms; } };
}

export const activeRows = (ids) => ids.map((id) => ({
  id: `egbiz:${id}`, source: "egbiz", apply_end: "2026-12-31", closed_at: null,
  last_seen_at: "2026-09-16T02:00:00.000Z",
}));

export async function collectAndPersist(h, source = "egbiz") {
  const items = await h.load("lib/data/egbiz.ts").fetchEgbizOpen();
  const programs = items.map((item) => ({ ...item, source, id: item.id.replace(/^egbiz:/, `${source}:`) }));
  return h.load("lib/supabase/programs.ts").upsertAndDiff(source, programs, RUN_AT);
}
