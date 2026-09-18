import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Static inventory of this checkout only. Does not read env files or call services.
const roots = ["app", "components", "lib"];
const walk = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walk(file)
      : /\.(ts|tsx)$/.test(file)
        ? [file]
        : [];
  });
const files = roots.flatMap(walk).sort(),
  fileSet = new Set(files);
const nodes = [],
  edges = [],
  external = [],
  unresolved = [];
function resolve(from, specifier) {
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith(".")
      ? path.normalize(path.join(path.dirname(from), specifier))
      : null;
  if (base === null) return null;
  return (
    [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find((file) => fileSet.has(file)) ?? ""
  );
}
function connect(from, specifier, kind, typeOnly = false) {
  const to = resolve(from, specifier);
  if (to) edges.push({ from, to, kind, typeOnly });
  else if (to === "" && !/\.(css|json|svg|png)$/.test(specifier))
    unresolved.push({ from, specifier });
  else if (to === null) external.push({ from, specifier, typeOnly });
}
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const hooks = { useState: 0, useEffect: 0, useReducer: 0 },
    apiPaths = new Set();
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const typeOnly = Boolean(
        clause?.isTypeOnly ||
          (clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length &&
            clause.namedBindings.elements.every((entry) => entry.isTypeOnly)),
      );
      connect(file, node.moduleSpecifier.text, "import", typeOnly);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      connect(
        file,
        node.moduleSpecifier.text,
        "export",
        Boolean(node.isTypeOnly),
      );
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(tree),
        arg = node.arguments[0];
      if (Object.hasOwn(hooks, callee)) hooks[callee]++;
      if (arg && ts.isStringLiteral(arg)) {
        if (callee === "import" || callee === "require")
          connect(file, arg.text, callee);
        if (callee === "fetch" && arg.text.startsWith("/api/"))
          apiPaths.add(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  nodes.push({
    file,
    lines: source.trimEnd().split("\n").length,
    hooks,
    client: tree.statements.some(
      (s) =>
        ts.isExpressionStatement(s) &&
        ts.isStringLiteral(s.expression) &&
        s.expression.text === "use client",
    ),
    apiPaths: [...apiPaths].sort(),
  });
}
function cycles(selected) {
  const adjacency = new Map(
    files.map((file) => [
      file,
      selected.filter((e) => e.from === file).map((e) => e.to),
    ]),
  );
  const indices = new Map(),
    low = new Map(),
    stack = [],
    onStack = new Set(),
    groups = [];
  let index = 0;
  function visit(file) {
    indices.set(file, index);
    low.set(file, index++);
    stack.push(file);
    onStack.add(file);
    for (const next of adjacency.get(file)) {
      if (!indices.has(next)) {
        visit(next);
        low.set(file, Math.min(low.get(file), low.get(next)));
      } else if (onStack.has(next))
        low.set(file, Math.min(low.get(file), indices.get(next)));
    }
    if (low.get(file) === indices.get(file)) {
      const group = [];
      let next;
      do {
        next = stack.pop();
        onStack.delete(next);
        group.push(next);
      } while (next !== file);
      if (group.length > 1 || adjacency.get(file).includes(file))
        groups.push(group.sort());
    }
  }
  for (const file of files) if (!indices.has(file)) visit(file);
  return groups.sort((a, b) => a[0].localeCompare(b[0]));
}
const pureModules = new Set([
  "lib/llm/types.ts",
  "lib/plan/documentTypes.ts",
  "lib/plan/revisionTypes.ts",
  "lib/plan/revisionService.ts",
  "lib/plan/formHeadings.ts",
  "lib/operations/domain.ts",
]);
const boundaryViolations = [
  ...edges.filter((e) => pureModules.has(e.from) && !pureModules.has(e.to)),
  ...external.filter((e) => pureModules.has(e.from)),
];
const report = {
  scope:
    "Static literal imports, exports, dynamic imports and require in app/components/lib. Explicit type-only edges separated; not a bundled-runtime or cross-repository graph.",
  nodes,
  edges,
  external,
  unresolved,
  cycles: cycles(edges),
  runtimeCycles: cycles(edges.filter((e) => !e.typeOnly)),
  boundaryViolations,
};
if (process.argv.includes("--write")) {
  fs.writeFileSync(
    "docs/architecture/dependency-graph.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify(
    {
      files: nodes.length,
      edges: edges.length,
      runtimeCycles: report.runtimeCycles,
      allCycles: report.cycles,
      boundaryViolations,
      unresolved,
      largest: [...nodes]
        .sort((a, b) => b.lines - a.lines)
        .slice(0, 5)
        .map(({ file, lines, hooks }) => ({ file, lines, hooks })),
    },
    null,
    2,
  ),
);
if (
  process.argv.includes("--check") &&
  (report.cycles.length ||
    report.runtimeCycles.length ||
    boundaryViolations.length ||
    unresolved.length)
)
  process.exitCode = 1;
