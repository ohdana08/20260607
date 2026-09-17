import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Execute the real hook with controlled render/effect and network scheduling.
// This tests response ordering, not browser rendering or React internals.
export function operationsHookHarness(sourceRoot = process.cwd()) {
  const slots = [], effects = [], requests = [];
  let cursor = 0, hook, current, pending = [];
  const changed = (a, b) => !a || a.length !== b.length || b.some((v, i) => !Object.is(v, a[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (changed(slots[index]?.dependencies, dependencies)) slots[index] = { callback, dependencies };
      return slots[index].callback;
    },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (changed(effects[index]?.dependencies, dependencies)) {
        pending.push(() => {
          effects[index]?.cleanup?.();
          effects[index] = { dependencies, cleanup: callback() };
        });
      }
    },
  };
  const file = path.join(sourceRoot, "app/operations/useOperationsDashboard.ts");
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {};
  vm.runInNewContext(source, {
    exports: exported, AbortController, DOMException,
    require(name) {
      if (name === "react") return react;
      if (name === "@/components/auth/AuthGate") return { authedHeaders: async () => ({}) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch(url, options) {
      return new Promise((resolve, reject) => {
        requests.push({ url, options, resolve: (value) => resolve(Response.json(value)), reject });
      });
    },
  }, { filename: file });
  hook = exported.useOperationsDashboard;
  function render() {
    cursor = 0;
    current = hook(true, "2026-09");
    const queue = pending; pending = [];
    queue.forEach((effect) => effect());
    return current;
  }
  return { render, requests, unmount() { effects.forEach((effect) => effect?.cleanup?.()); } };
}

export const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
export const monthView = (month, revision = 1) => ({ state: { goal: { month }, revision }, summary: {}, mode: "local" });
