import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
// Existing release-reviewer evaluate style: explicit imports and intercepted HTTP.
export function loadPurchaseRoute(imports, env, fetch) {
  const loaded = { exports: {} };
  const source = readFileSync('app/api/groble/webhook/route.ts', 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports,
    require(name) { if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected dependency ${name}`); return imports[name]; },
    Request, Response, URL, AbortSignal, Uint8Array, process: { env }, fetch, console: { info() {}, error() {} },
  });
  return loaded.exports;
}
