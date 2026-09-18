import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { spawn } from "node:child_process";
import ts from "typescript";
const nativeRequire = createRequire(import.meta.url);

export function loadScaleModule(entry, mocks = {}, env = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} }; cache.set(file, loaded);
    const require = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (!name.startsWith(".") && !name.startsWith("@/")) return nativeRequire(name);
      const base = name.startsWith("@/") ? path.join(process.cwd(), name.slice(2)) : path.resolve(path.dirname(file), name);
      return load([base, `${base}.ts`].find((candidate) => existsSync(candidate)));
    };
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText;
    vm.runInNewContext(code, { module: loaded, exports: loaded.exports, require, process: { env },
      console, Request, Response, Date, URL, AbortController, AbortSignal, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval }, { filename: file });
    return loaded.exports;
  }
  return load(path.resolve(entry));
}

// Test-only RESP client. Fixed loopback endpoint for the isolated Redis container.
export function redisCommand(...args) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: 26379 });
    let data = Buffer.alloc(0);
    socket.setTimeout(3000, () => socket.destroy(new Error("lab Redis timeout")));
    socket.on("error", reject);
    socket.on("connect", () => {
      const parts = [Buffer.from(`*${args.length}\r\n`)];
      for (const value of args) {
        const bytes = Buffer.from(String(value));
        parts.push(Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from("\r\n"));
      }
      socket.write(Buffer.concat(parts));
    });
    function parse(offset) {
      const end = data.indexOf("\r\n", offset);
      if (end < 0) return null;
      const kind = String.fromCharCode(data[offset]), text = data.subarray(offset + 1, end).toString();
      let next = end + 2;
      if (kind === "+") return { value: text, next };
      if (kind === "-") throw new Error(text);
      if (kind === ":") return { value: Number(text), next };
      if (kind === "$") {
        const size = Number(text); if (size === -1) return { value: null, next };
        if (data.length < next + size + 2) return null;
        return { value: data.subarray(next, next + size).toString(), next: next + size + 2 };
      }
      if (kind === "*") {
        const value = [];
        for (let i = 0; i < Number(text); i++) { const child = parse(next); if (!child) return null; value.push(child.value); next = child.next; }
        return { value, next };
      }
      throw new Error("unsupported RESP reply");
    }
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      try { const reply = parse(0); if (reply) { socket.end(); resolve(reply.value); } }
      catch (error) { socket.destroy(); reject(error); }
    });
  });
}
export const labRedis = {
  async get(key) { const value = await redisCommand("GET", key); return value === null ? null : JSON.parse(value); },
  async set(key, value, options) { return redisCommand("SET", key, value, "NX", "PX", options.px); },
  async eval(script, keys, args) { return redisCommand("EVAL", script, keys.length, ...keys, ...args); },
};

// SQL only reaches a fixed lab container/database. No env connection URL accepted.
export function labSql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "-f", "infra/scale/compose.yml", "exec", "-T", "postgres", "psql", "-U", "scale_lab", "-d", "ddakfit_scale_lab", "-At", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
    child.stdin.end(query);
  });
}
export const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
