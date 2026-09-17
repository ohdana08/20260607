# Independent SRE / Optimizer review — 2026-09-17

**Verdict: the frozen local candidate passes the agreed server-function performance gate.** The existing four optimizations have useful mechanism-level evidence. Independent whole-path measurement also found a larger omitted CPU cost in deadline filtering; the approved formatter reuse now removes that cost while preserving per-call date evaluation. This verdict does not approve production deployment, HTTP capacity, database changes, memory savings, or operational readiness.

## Scope and independence

The SRE read the actual source, measurement scripts, immutable baselines and historical JSON rather than inheriting the earlier report's conclusion. The Architect selected the minimal formatter change, Implementation changed `lib/data/openFilter.ts`, and Reviewer owns product correctness review. SRE changed only its measurement helper, new benchmark, three harness guards, this report and a new result file. Other workers' edits were preserved. No production service, database, AI provider or browser was contacted for this measurement.

Two different baselines are deliberately distinguished:

- `tests/fixtures/performance-before`: prior pre-optimization source snapshots. Its manifest contains six files; four of them were the earlier product optimizations. New matching-only results labeled `original-four-to-candidate-matching-only` compare that baseline against the candidate. The label identifies the change set, not the manifest's file count.
- `tests/fixtures/team-before`: six source snapshots at the start of this team review, when the four earlier optimizations were already present. The `team-start-to-candidate-full-pipeline` comparison isolates the new deadline formatter improvement in the real `fetchOpenPrograms → matchByButtons` path.

Saved files outside a baseline fall back to actual dependency source. The new report records every loaded source's path and SHA-256, so this fallback is explicit and reproducible. Every loaded source, baseline manifest entry, target file and historical JSON hash was rechecked at the end of the run. No input changed during measurement.

## Findings in the previous measurement design

| Finding | Consequence | Resolution or limit |
|---|---|---|
| 90 matching samples rotate 부산, 경기 and 전국 profiles, including a national profile that bypasses region conflict detection. | A pooled p95 describes that exact mix; it cannot represent each profile or overall HTTP performance. | New timing keeps profiles separate at 300, 3,000 and 10,000 rows. National matching results are reported as no demonstrated improvement. |
| Matching, deduplication and cloning were measured separately, but the actual `fetchOpenPrograms` deadline filtering path was absent. | Calling repeated regional regex creation the principal CPU cost of the complete path was not supported. | A short actual-path experiment identified 2,400 `Intl.DateTimeFormat` constructions per 3,000-row request. The final benchmark measures the whole local path after the actual formatter-only implementation. |
| Only one before process and one after process, with no raw latency samples and no complete candidate source identity in the old JSON. | Host load, process warming and between-run drift cannot be separated. | Four alternating before/after rounds, per-round warmups, all raw samples, input/output hashes and exact source identity are stored. These remain descriptive single-host measurements, with no confidence intervals. |
| Historical memory readings sample after iterations; GC is optional. | These are neither allocation volume nor peak RSS, and a negative retained delta is not proof of lower product memory. | New execution requires `--expose-gc`, records heap/RSS/external/ArrayBuffer deltas and explicitly includes harness/digest/GC effects in its limitations. Memory is diagnostic only. |
| Event-loop delay is measured across batches, yields and timer waits. | Batch length and scheduler timing affect it; it is not request latency or an isolated measure of a slow endpoint. | The new benchmark does not claim event-loop or concurrent HTTP improvement; each timed sample is preceded by a yield. |
| Auth has fixed 20 ms simulated transport; paid reads resolve immediately. | Call elimination is reproducible, but jitter, rate limits, errors, connection reuse, network location and real paid-read cost are absent. | New 0/20 ms diagnostics corroborate 2 → 1 auth calls per short request. No production latency percentage is inferred. Auth lifetime/failure/concurrency correctness remains covered by product tests and independent Reviewer tests. |
| Catalog mock applies selection and limit to synthetic rows; it does not run real filtering, sorting, server row caps or policies. Catalog timing is a single observation. | Payload reduction and SDK URL contract are supported; DB or remote I/O speedup is not. | Preserve the structural payload claim only. New diagnostics reproduce one query and identical returned Program data. |
| Cache promotion mock returns a fresh value on the second read, without actual distributed ownership timing. | It establishes the extra-read mechanism, not cloud contention performance or a throughput guarantee. | Both acquire-race and wait-for-owner again show one unnecessary follow-up read removed. Real Redis integration remains a separate validation stage. |
| DB experiment has one warmup and five runs per variant, always unindexed then indexed, on a fixed synthetic TEMP table. | It supports that fixture's plan change, not production cardinality, cache behavior, write overhead or deployment suitability. | Historical plans are retained as an index candidate experiment. SRE did not rerun or deploy the index because the candidate product change contains no DB index change. |
| PDF raster sample count is 15; its p95 is the maximum sample under the script's quantile rule. | Tail estimates are coarse, and a fixed SVG/font does not cover document export diversity. | No new rasterization speedup claim is made. |

The initial in-memory diagnostic that replaced deadline evaluation with one fixed date returned identical data and much lower time, but it was not the implementation selected by the Architect. Its roughly 8 ms result is **not** reported as the final candidate's result. The actual implementation reuses only the formatter and still calls `new Date()` for each deadline check.

## Frozen candidate results

Execution: 2026-09-17 03:17:18.720–03:18:12.880 UTC, Apple M4 Pro, darwin arm64, Node v24.14.1, V8 13.6.233.17-node.44, ICU 78.2, 14 logical CPUs. Fixed synthetic instant: `2026-09-17T03:00:00.000Z` (KST date 2026-09-17).

Each profile/variant has **four rounds × 20 measured calls = 80 samples**, plus five warmup calls and one correctness preflight per round. Each warmup call's `wallMs` and `cpuMs` are retained separately in `warmupSamples` and excluded from the 80 measured samples and their reported percentiles. Order alternates AB/BA with a scenario parity offset. Module loading/transpilation is excluded; modules are recreated per variant per round. Full-path catalog reads return a fresh `structuredClone` of the fixture. The real filtering, deduplication and matching functions execute. This is a local function pipeline, not an HTTP request with actual catalog transport.

### Team-start baseline → final candidate, whole local pipeline, 3,000 rows

| Profile | Before p50 | After p50 | Before p95 | After p95 | p95 decrease | Four per-round decreases |
|---|---:|---:|---:|---:|---:|---|
| 부산 / 창업초기 / 사업화 | 58.207 ms | 9.687 ms | 62.661 ms | 10.143 ms | 83.813% | 84.122%, 83.608%, 82.916%, 82.873% |
| 경기 / 예비창업 / 시설·공간 | 56.688 ms | 8.784 ms | 58.956 ms | 9.331 ms | 84.173% | 84.571%, 84.623%, 84.707%, 84.117% |
| 전국 / 7년 이상 / 멘토링·교육 | 57.076 ms | 8.376 ms | 61.440 ms | 9.282 ms | 84.893% | 85.889%, 85.553%, 84.863%, 82.576% |

All preflight, warmup and measured outputs matched their baseline, including fetched rows and the complete ordered recommendations. Formatter constructions changed from module load 0 / each 3,000-row fetch 2,400 to module load **1 / each warm fetch 0**. Non-null deadline rows account for the 2,400 calls; undated rows short-circuit. The three profile aggregates and all twelve individual rounds exceed the Architect's 30% p95 reduction criterion.

### Original pre-optimization baseline → final candidate, matching only

| 3,000-row profile | Before p95 | After p95 | Interpretation |
|---|---:|---:|---|
| 부산 | 22.877 ms | 5.566 ms | 75.670% decrease; regional regex cost reduction reproduced. |
| 경기 | 17.618 ms | 4.403 ms | 75.009% decrease; regional regex cost reduction reproduced. |
| 전국 | 4.184 ms | 4.046 ms | 0.138 ms difference; no demonstrated region-optimization benefit on this bypass path. |

For the national profile, p95 differences vary from −6.861% at 300 rows to +3.478% at 10,000 rows, with inconsistent per-round signs at larger sizes. They are retained in raw results and not promoted to an improvement claim. The full pipeline's national-profile improvement comes from deadline formatting, which that path does execute.

Structural diagnostics also reproduced:

- Auth: 12 distinct requests per variant/latency, including two warmups. Original 24 verification calls → candidate 12; paid reads stay at 12. Transport delays 0 and 20 ms are synthetic and these ten-sample diagnostic timings are not tail-latency evidence.
- Catalog: one SDK query per variant; synthetic response 1,941,716 → 1,597,826 bytes (17.7% smaller); full returned Program digest equal. Real PostgreSQL execution time and network transfer were not measured.
- Cache: acquire-race and wait-for-owner each have one redundant post-promotion read before and zero after, with zero loader calls. This is a mechanism test, not a real distributed load test.

### Noise and memory interpretation

The Architect paused heavy work for the run. Reviewer reported that a short correctness check may have overlapped the beginning; exact process overlap was not captured. Host load averages were approximately 2.36/2.11/2.36 at start and 2.40/2.15/2.36 at end. Other processes and native runtime activity therefore remain possible noise. No sample was removed as an outlier. The full-pipeline measurements occur later and all twelve per-round p95 comparisons pass; the decision does not depend on discarding early samples or claiming the host was idle.

Memory observations must not become a savings claim. The first 부산 baseline round retained an additional 668,205,056 RSS bytes at its final snapshot, while later rounds usually had near-zero RSS deltas. This is consistent with process/allocator history affecting the readings, but this run does not identify the cause. GC-after heap deltas are around 1.9 MB for both variants and include retained results/harness data. A cross-process, fixed-lifetime allocation/RSS experiment would be needed for a product memory conclusion. The current passing gate is based on latency, output equivalence and constructor counts, not memory reduction.

## Verification, reproduction and artifact identity

SRE harness guards passed: `node --test tests/team-sre.test.mjs` (3/3). JavaScript syntax check passed. The benchmark exited 0 with all four gates true: all measured output equality, each full-pipeline profile at least 30% faster at p95, formatter module/warm counts 1/0, and formatter output equality. Product correctness and whole-repository validation are recorded by Reviewer/Architect separately.

```bash
node --test tests/team-sre.test.mjs
node --check scripts/performance-team-benchmark.mjs
node --expose-gc scripts/performance-team-benchmark.mjs --output docs/architecture/team-performance-20260917-final.json
```

The last command documents the actual execution. That result already exists: the script uses exclusive creation (`wx`) and refuses to overwrite it. To repeat, omit `--output` for a fresh timestamped `team-performance-*.json`, or supply a new name with that prefix. The script rejects historical `performance-before/after/db.json` names. Do not rerun the legacy benchmark commands if the intent is to preserve those historical files.

Exact product hashes validated by this run:

| File | SHA-256 |
|---|---|
| `lib/auth/googleUser.ts` | `da8e372a73bbc755f8e2db70d7818e94e19d8b0b5d97e864aa8ce1a0c6a97df9` |
| `lib/match/buttonFilter.ts` | `923705df05789511570410cb8ff85e7f83780d0e936f6a3b6a2666be013268e5` |
| `lib/supabase/programs.ts` | `399dadbe2025b433af55d33c2450de9b447c4fe4bb3107529cbb3fd5bb84aad6` |
| `lib/scale/snapshotCache.ts` | `aa4ff0282f7fdd7d01439fb86776a9cb4c6124f5c1bb7d82679feb4aba584d93` |
| `lib/data/openFilter.ts` | `9b0ec62c6bacd90df2a6ae0c1947f8613821a4847de3517f9167d55c36a226e7` |
| `lib/data/programs.ts` (unchanged orchestration) | `297122f52284f807847d125d52555a0f392dba3c5a9418bd5120569c305b80b9` |

Measurement script SHA-256: `4b5a4be3f73813363b585cd874e1f9db7a98746ba24cc53b750eb8c584ad112a`.

Helper SHA-256: `1fa61d193847b1bfb22bd761638607681a8b61a6b18f8c86600e92519b69cb50`.

New [raw result](team-performance-20260917-final.json) SHA-256: `bb1496462cdaa8ef81ac2880f847d1980f9f04b3a99ac6d2f7e30879be40b8f8`.

Historical JSON preserved with SHA-256:

- `performance-before.json`: `025e13b3905a8741497be7953ed0f8dea133a9bf64e06c3c7f5e3a4ff178a03a`
- `performance-after.json`: `caffd358b02143e1d55461e1af8fb5acbd8d75fb5953209e818f69d152b8763f`
- `performance-db.json`: `47744411ec975395758bcfdc5853d87275f4ba87c68598034759d359f93bf9eb`

## Operational boundary

Production request latency, throughput/capacity, live DB plans, existing index inventory, error budgets, paid AI behavior and browser experience remain unverified by this SRE run. No monitoring dashboard, distributed tracing, metric exporter, operational alert or paging channel was connected or tested. Previous proposals for such monitoring are design notes, not deployed observability. No operational index, cache flag, queue connection or production deployment was performed.

Before a separate production-capacity claim, use an authorized staging workload with fixed version/region/data, independent HTTP request groups, bounded load, recorded errors and latency distributions, and trace correlation that excludes tokens and user content. That work is outside this completed local performance review.
