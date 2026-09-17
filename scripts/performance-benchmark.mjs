import { writeFileSync, readFileSync } from "node:fs";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { performanceModules, programsFixture, profilesFixture, authHarness, catalogHarness, cachePromotionScenario, baselineRoot, digest, delay } from "../tests/helpers/performance-harness.mjs";

const before = process.argv.includes("--before");
const quantile = (values, percentile) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * percentile) - 1];
const round = (value) => Math.round(value * 1000) / 1000;
const manifest = JSON.parse(readFileSync(path.join(baselineRoot, "manifest.json"), "utf8"));
for (const [file, hash] of Object.entries(manifest)) {
  if (createHash("sha256").update(readFileSync(path.join(baselineRoot, file + ".source"))).digest("hex") !== hash) throw new Error(`Baseline changed: ${file}`);
}
async function measure(work, warmup, iterations) {
  for (let i = 0; i < warmup; i++) await work(i);
  global.gc?.();
  const heapStart = process.memoryUsage().heapUsed, cpu = process.cpuUsage();
  let heapPeakSampled = heapStart, last;
  const times = [];
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable(); await delay(20);
  const wallStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const start = performance.now(); last = await work(i); times.push(performance.now() - start);
    heapPeakSampled = Math.max(heapPeakSampled, process.memoryUsage().heapUsed);
    if (i % 10 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  const wallMs = performance.now() - wallStart, used = process.cpuUsage(cpu);
  await delay(20); loop.disable(); global.gc?.();
  return { iterations, p50Ms: round(quantile(times, .5)), p95Ms: round(quantile(times, .95)),
    totalCpuMs: round((used.user + used.system) / 1000), wallMs: round(wallMs),
    sampledHeapGrowthBytes: heapPeakSampled - heapStart, retainedHeapDeltaBytes: process.memoryUsage().heapUsed - heapStart,
    eventLoopDelayMaxMs: round(loop.max / 1e6), outputDigest: digest(last) };
}

const report = { version: 1, mode: before ? "before" : "after", recordedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model },
  limits: ["Single-host actual-function benchmark, not deployed HTTP or real DB/AI performance.",
    "Auth uses fixed 20 ms synthetic transport. Supabase SDK uses synthetic transport and rows.",
    "Heap sampled after iterations is not total allocation or peak RSS. CPU includes harness overhead.",
    "No browser measurement. Event-loop delay includes batches and yields; it is not request latency."],
  matching: [],
};
const { matchByButtons } = performanceModules({ before }).load("lib/match/buttonFilter.ts");
for (const size of [300, 3000, 10000]) {
  const programs = programsFixture(size);
  const stats = await measure((i) => matchByButtons(programs, profilesFixture[i % profilesFixture.length]), 30, 90);
  report.matching.push({ rows: size, fixtureDigest: digest(programs), ...stats });
}
let regexConstructions = 0;
class CountedRegExp extends RegExp { constructor(...args) { super(...args); regexConstructions++; } }
const counted = performanceModules({ before, globals: { RegExp: CountedRegExp } }).load("lib/match/buttonFilter.ts");
const initializationRegexes = regexConstructions; regexConstructions = 0;
counted.matchByButtons(programsFixture(3000), profilesFixture[0]);
report.regionRegexConstructions = { moduleInitialization: initializationRegexes, per3000RowRequest: regexConstructions };

const auth = authHarness({ before, latency: 20 });
report.auth = await measure(async () => {
  const req = new Request("https://example.invalid/api/plan/draft-batch", { headers: { Authorization: "Bearer fixture-token" } });
  const gate = await auth.paidGoogleLoginGate(req, undefined);
  if (gate) throw new Error("fixture auth rejected");
  return auth.checkDraftAccess(req, undefined, "fixture-program");
}, 5, 40);
report.auth = { ...report.auth, totalRequestsIncludingWarmup: 45, authNetworkCalls: auth.calls, paidRecordReads: auth.paidReads, syntheticNetworkDelayMs: 20 };

const catalog = catalogHarness({ before });
const catalogStart = performance.now(), catalogRows = await catalog.getOpenPrograms();
report.catalog = { inputRows: 3000, queryCount: catalog.requests.length, select: catalog.requests[0].url.searchParams.get("select"),
  responseBytes: catalog.responseBytes, outputDigest: digest(catalogRows), sdkAndSyntheticTransportMs: round(performance.now() - catalogStart) };
report.cachePromotion = {};
for (const kind of ["acquire-race", "wait-for-owner"]) report.cachePromotion[kind] = await cachePromotionScenario(before, kind);

const programs = programsFixture(3000);
const { dedupePrograms } = performanceModules({ before }).load("lib/data/dedupePrograms.ts");
report.deduplication = await measure(() => dedupePrograms(programs), 10, 50);
report.snapshotClone = await measure(() => structuredClone(programs), 10, 50);
const conversations = Array.from({ length: 50 }, (_, i) => ({ id: `fixture-${i}`, messages: Array.from({ length: 20 }, (_, j) => ({ role: j % 2 ? "user" : "assistant", content: "가상의 대화 내용입니다. ".repeat(30) })) }));
report.conversationSerialization = { bytes: Buffer.byteLength(JSON.stringify(conversations)),
  ...await measure(() => JSON.stringify(conversations).length, 10, 50), browserStorageMeasured: false };

// Actual synchronous rasterizer called by PDF export. Fixed offline SVG/font, no customer data.
const { Resvg } = await import("@resvg/resvg-js");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="white"/><text x="100" y="150" font-family="Pretendard" font-size="42">성능 측정용 가상 발표자료</text></svg>';
report.pdfRaster = await measure(() => new Resvg(svg, { font: { fontFiles: [path.resolve("public/fonts/Pretendard-Regular.otf")], defaultFontFamily: "Pretendard", loadSystemFonts: false } }).render().asPng().byteLength, 3, 15);
const output = `docs/architecture/performance-${report.mode}.json`;
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
