import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { performanceModules, baselineRoot } from "./helpers/performance-harness.mjs";

const root = path.resolve(import.meta.dirname, "..");
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
test("team baseline selection records exact source without altering original before behavior", () => {
  const file = "lib/data/openFilter.ts";
  const teamDirectory = path.join(root, "tests/fixtures/team-before");
  const team = performanceModules({ sourceRoot: teamDirectory });
  team.load(file);
  assert.equal(team.sources[file].path, path.join(teamDirectory, `${file}.source`));
  assert.equal(team.sources[file].sha256, hash(team.sources[file].path));
  const old = performanceModules({ before: true });
  old.load("lib/auth/googleUser.ts");
  assert.equal(old.sources["lib/auth/googleUser.ts"].path, path.join(baselineRoot, "lib/auth/googleUser.ts.source"));
  const current = performanceModules(); current.load(file);
  assert.equal(current.sources[file].path, path.join(root, file));
  assert.equal(current.sources[file].sha256, hash(path.join(root, file)));
});
test("team benchmark rejects historical output names before running work", () => {
  const result = spawnSync(process.execPath, ["--expose-gc", "scripts/performance-team-benchmark.mjs", "--output", "docs/architecture/performance-after.json"], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output must be a new/);
});
test("team benchmark requires explicit GC and enough samples", () => {
  const noGc = spawnSync(process.execPath, ["scripts/performance-team-benchmark.mjs"], { cwd: root, encoding: "utf8" });
  assert.notEqual(noGc.status, 0); assert.match(noGc.stderr, /--expose-gc/);
  const fewSamples = spawnSync(process.execPath, ["--expose-gc", "scripts/performance-team-benchmark.mjs", "--iterations", "1"], { cwd: root, encoding: "utf8" });
  assert.notEqual(fewSamples.status, 0); assert.match(fewSamples.stderr, /--iterations must be/);
});
