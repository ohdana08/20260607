import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  performanceModules, programsFixture, profilesFixture, authHarness,
  catalogHarness, cachePromotionScenario, baselineRoot, digest,
} from "../tests/helpers/performance-harness.mjs";

// Offline function measurement only. Before sources and prior reports are immutable.
const root = path.resolve(import.meta.dirname, "..");
const teamRoot = path.join(root, "tests/fixtures/team-before");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${name} value`);
  return args[index + 1];
};
for (let i = 0; i < args.length; i += 2) {
  if (!["--rounds", "--warmup", "--iterations", "--output"].includes(args[i])) throw new Error(`Unknown option ${args[i]}`);
}
const count = (name, fallback, minimum) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < minimum || value > 1000) throw new Error(`${name} must be an integer from ${minimum} to 1000`);
  return value;
};
const rounds = count("--rounds", 4, 3);
const warmup = count("--warmup", 5, 1);
const iterations = count("--iterations", 20, 20);
if (!global.gc) throw new Error("Run with node --expose-gc; memory observations require explicit GC.");
const output = path.resolve(root, option("--output", `docs/architecture/team-performance-${new Date().toISOString().replaceAll(":", "-")}.json`));
if (path.dirname(output) !== path.join(root, "docs/architecture") || !/^team-performance-.+\.json$/.test(path.basename(output))) {
  throw new Error("Output must be a new docs/architecture/team-performance-*.json file.");
}
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const verifyBaseline = (directory) => {
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  for (const [file, expected] of Object.entries(manifest)) assert.equal(sha(path.join(directory, `${file}.source`)), expected, file);
  return manifest;
};
const baselineManifests = { originalFour: verifyBaseline(baselineRoot), teamStart: verifyBaseline(teamRoot) };
const trackedFiles = [...new Set([
  ...Object.keys(baselineManifests.originalFour), ...Object.keys(baselineManifests.teamStart),
  "scripts/performance-team-benchmark.mjs", "tests/helpers/performance-harness.mjs", "package-lock.json",
  "docs/architecture/performance-before.json", "docs/architecture/performance-after.json", "docs/architecture/performance-db.json",
])];
const sourceHashes = Object.fromEntries(trackedFiles.map((file) => [file, sha(path.join(root, file))]));
const allLoadedSources = {};
const captureSources = (label, modules) => { allLoadedSources[label] = { ...modules.sources }; };
const round = (n) => Math.round(n * 1000) / 1000;
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
const statistics = (samples) => {
  const times = samples.map((sample) => sample.wallMs);
  return { n: times.length, p50Ms: round(quantile(times, 0.5)), p95Ms: round(quantile(times, 0.95)), minMs: round(Math.min(...times)), maxMs: round(Math.max(...times)),
    totalCpuMs: round(samples.reduce((sum, sample) => sum + sample.cpuMs, 0)) };
};
const memoryDelta = (start, end) => Object.fromEntries(["rss", "heapUsed", "external", "arrayBuffers"].map((key) => [`${key}DeltaBytes`, end[key] - start[key]]));
const immediate = () => new Promise((resolve) => setImmediate(resolve));
async function measure(work, expectedDigest) {
  const warmupSamples = [];
  for (let i = 0; i < warmup; i++) {
    const cpuStart = process.cpuUsage(), start = performance.now();
    const result = await work();
    const wallMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
    assert.equal(digest(result), expectedDigest);
    warmupSamples.push({ wallMs, cpuMs: (cpu.user + cpu.system) / 1000 });
  }
  global.gc();
  const memoryStart = process.memoryUsage();
  let observedHeapMax = memoryStart.heapUsed, observedRssMax = memoryStart.rss;
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    await immediate();
    const cpuStart = process.cpuUsage(), start = performance.now();
    const result = await work();
    const wallMs = performance.now() - start, cpu = process.cpuUsage(cpuStart);
    // Equality checking and memory sampling are outside each timed interval.
    assert.equal(digest(result), expectedDigest);
    samples.push({ wallMs, cpuMs: (cpu.user + cpu.system) / 1000 });
    const memory = process.memoryUsage();
    observedHeapMax = Math.max(observedHeapMax, memory.heapUsed);
    observedRssMax = Math.max(observedRssMax, memory.rss);
  }
  global.gc();
  return { ...statistics(samples), samples, warmupSamples, outputDigest: expectedDigest,
    memoryObservation: { ...memoryDelta(memoryStart, process.memoryUsage()), sampledHeapGrowthBytes: observedHeapMax - memoryStart.heapUsed,
      sampledRssGrowthBytes: observedRssMax - memoryStart.rss } };
}
const fixedInstant = "2026-09-17T03:00:00.000Z";
class FixtureDate extends Date {
  constructor(...values) { super(...(values.length ? values : [fixedInstant])); }
  static now() { return Date.parse(fixedInstant); }
}
function functionsHarness({ sourceRoot, rows, pipeline, sourceLabel }) {
  const mocks = pipeline ? { "lib/data/catalogCache.ts": { getCatalogPrograms: async () => structuredClone(rows) } } : {};
  const modules = performanceModules({ sourceRoot, mocks, globals: { Date: FixtureDate } });
  const { matchByButtons } = modules.load("lib/match/buttonFilter.ts");
  const fetchOpenPrograms = pipeline ? modules.load("lib/data/programs.ts").fetchOpenPrograms : null;
  captureSources(sourceLabel, modules);
  return async (profile) => {
    if (!pipeline) return matchByButtons(rows, profile);
    const fetched = await fetchOpenPrograms();
    return { fetched, matched: matchByButtons(fetched.programs, profile) };
  };
}
const report = {
  version: 1, recordedAt: new Date().toISOString(), command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
  environment: { node: process.version, versions: { v8: process.versions.v8, icu: process.versions.icu }, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), loadAverageAtStart: os.loadavg(), gcExposed: true },
  method: { rounds, warmupPerVariantPerRound: warmup, samplesPerVariantPerRound: iterations,
    untimedCorrectnessPreflightPerVariantPerRound: 1,
    order: "Alternating before/after and after/before, with scenario parity offset", fixedInstant, fixedKstDate: "2026-09-17",
    statisticalScope: "Descriptive samples on one host. No confidence interval, HTTP SLO, or production speedup inference." },
  limitations: [
    "VM-transpiled actual source; module load/transpile time is excluded. Each round uses new modules, then warmup.",
    "Full pipeline substitutes catalog I/O with a structuredClone of fixed rows. Auth/Redis/HTTP/AI and real cache transport are excluded.",
    "Profiles are separate workloads. Original-four comparison measures matching only; team-start comparison measures fetchOpenPrograms plus matching.",
    "Each sample yields before work. No request concurrency or event-loop saturation is modeled.",
    "CPU is process CPU during each interval and can include runtime work. Other processes may add wall-time noise.",
    "Memory snapshots are diagnostic, include harness/digest/GC effects and are not peak allocation, leak tests, or proof of memory savings.",
    "Auth uses fixed synthetic latency with no jitter, loss, connection reuse, quotas, or remote server load; paid reads are an immediate stub.",
    "Catalog transport models projection and limit only; it does not execute PostgreSQL filters, sorting, row caps, policies, or network transfer.",
    "Operational traces, dashboards, alerts, DB index deployment, browser performance, and paid AI execution are not verified.",
  ], baselineManifests, sourceHashes, comparisons: [], diagnostics: {},
};
let scenarioIndex = 0;
for (const [comparison, directory, pipeline, sizes] of [
  ["original-four-to-candidate-matching-only", baselineRoot, false, [300, 3000, 10000]],
  ["team-start-to-candidate-full-pipeline", teamRoot, true, [3000]],
]) {
  for (const size of sizes) for (const [profileIndex, profile] of profilesFixture.entries()) {
    const rows = programsFixture(size), fixtureDigest = digest({ rows, profile, fixedInstant });
    const entry = { comparison, rows: size, profile, fixtureDigest, rounds: [] };
    let expectedDigest;
    for (let repetition = 0; repetition < rounds; repetition++) {
      const sequence = (repetition + scenarioIndex) % 2 ? ["after", "before"] : ["before", "after"];
      const result = { round: repetition + 1, order: sequence };
      for (const variant of sequence) {
        const sourceLabel = `${comparison}/${size}/${profileIndex}/${repetition}/${variant}`;
        const work = functionsHarness({ sourceRoot: variant === "before" ? directory : undefined, rows, pipeline, sourceLabel });
        const initialDigest = digest(await work(profile));
        expectedDigest ??= initialDigest;
        assert.equal(initialDigest, expectedDigest);
        result[variant] = await measure(() => work(profile), expectedDigest);
      }
      entry.rounds.push(result);
    }
    entry.summary = Object.fromEntries(["before", "after"].map((variant) => [variant, statistics(entry.rounds.flatMap((run) => run[variant].samples))]));
    entry.summary.p95ReductionPercent = round(100 * (1 - entry.summary.after.p95Ms / entry.summary.before.p95Ms));
    entry.summary.roundP95ReductionPercent = entry.rounds.map((run) => round(100 * (1 - run.after.p95Ms / run.before.p95Ms)));
    entry.outputDigest = expectedDigest;
    report.comparisons.push(entry);
    scenarioIndex++;
  }
}
// Operation counts prove the mechanism separately from noisy timing samples.
for (const [label, directory] of [["teamStart", teamRoot], ["candidate", undefined]]) {
  let formatterCount = 0;
  class CountedFormatter extends Intl.DateTimeFormat { constructor(...args) { super(...args); formatterCount++; } }
  const modules = performanceModules({ sourceRoot: directory,
    globals: { Date: FixtureDate, Intl: new Proxy(Intl, { get: (target, key) => key === "DateTimeFormat" ? CountedFormatter : Reflect.get(target, key) }) },
    mocks: { "lib/data/catalogCache.ts": { getCatalogPrograms: async () => programsFixture(3000) } },
  });
  const { fetchOpenPrograms } = modules.load("lib/data/programs.ts");
  const moduleInitialization = formatterCount; formatterCount = 0;
  const result = await fetchOpenPrograms();
  report.diagnostics[label] = { dateFormatters: { moduleInitialization, per3000RowFetch: formatterCount }, outputDigest: digest(result) };
  captureSources(`formatter/${label}`, modules);
}
report.diagnostics.auth = [];
for (const latency of [0, 20]) for (const before of [true, false]) {
  const h = authHarness({ before, latency });
  const samples = [];
  for (let i = 0; i < 12; i++) {
    const req = new Request("https://example.invalid/api/plan/draft-batch", { headers: { Authorization: "Bearer fixture-token" } });
    const start = performance.now();
    assert.equal(await h.paidGoogleLoginGate(req), null);
    assert.equal((await h.checkDraftAccess(req, undefined, "fixture-program")).ok, true);
    if (i >= 2) samples.push({ wallMs: performance.now() - start });
  }
  assert.equal(h.calls, 12 * (before ? 2 : 1)); assert.equal(h.paidReads, 12);
  report.diagnostics.auth.push({ variant: before ? "originalFour" : "candidate", syntheticDelayMs: latency, warmupRequests: 2, measuredRequests: 10,
    verificationCallsIncludingWarmup: h.calls, paidReadsIncludingWarmup: h.paidReads, samples });
  captureSources(`auth/${latency}/${before ? "originalFour" : "candidate"}`, h);
}
report.diagnostics.catalog = {};
for (const before of [true, false]) {
  const h = catalogHarness({ before });
  const rows = await h.getOpenPrograms();
  report.diagnostics.catalog[before ? "originalFour" : "candidate"] = { requests: h.requests.length, query: h.requests[0].url.search, responseBytes: h.responseBytes, outputDigest: digest(rows) };
  captureSources(`catalog/${before ? "originalFour" : "candidate"}`, h);
}
assert.equal(report.diagnostics.catalog.originalFour.outputDigest, report.diagnostics.catalog.candidate.outputDigest);
report.diagnostics.cachePromotion = {};
for (const kind of ["acquire-race", "wait-for-owner"]) report.diagnostics.cachePromotion[kind] = {
  originalFour: await cachePromotionScenario(true, kind), candidate: await cachePromotionScenario(false, kind),
};
report.loadedSources = allLoadedSources;
for (const sources of Object.values(allLoadedSources)) for (const source of Object.values(sources)) assert.equal(sha(source.path), source.sha256, `Source changed during benchmark: ${source.path}`);
for (const [file, expected] of Object.entries(sourceHashes)) assert.equal(sha(path.join(root, file)), expected, `Input changed during benchmark: ${file}`);
verifyBaseline(baselineRoot); verifyBaseline(teamRoot);
report.environment.loadAverageAtEnd = os.loadavg();
report.completedAt = new Date().toISOString();
report.gates = {
  allMeasuredOutputsEqual: true,
  eachTeamPipelineProfileP95ReducedAtLeast30Percent: report.comparisons.filter((entry) => entry.comparison === "team-start-to-candidate-full-pipeline").every((entry) => entry.summary.p95ReductionPercent >= 30),
  formatterConstructedOnceAtModuleLoadAndZeroPerWarmFetch: report.diagnostics.candidate.dateFormatters.moduleInitialization === 1 && report.diagnostics.candidate.dateFormatters.per3000RowFetch === 0,
  formatterOutputEqual: report.diagnostics.teamStart.outputDigest === report.diagnostics.candidate.outputDigest,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, gates: report.gates, comparisons: report.comparisons.map(({ comparison, rows, profile, summary }) => ({ comparison, rows, profile, summary })), dateFormatters: { teamStart: report.diagnostics.teamStart.dateFormatters, candidate: report.diagnostics.candidate.dateFormatters } }, null, 2));
if (Object.values(report.gates).some((passed) => !passed)) process.exitCode = 1;
