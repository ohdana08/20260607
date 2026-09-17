# SRE release preflight — 2026-09-17

**Decision: approve the assigned source changes for final team integration, with the deployment gates below still required.** Two concrete Major correctness findings and one Minor failure-response finding were reproduced and fixed. No unresolved Blocker or Major remains in the SRE-assigned change set on the tested local paths. This is not production deployment approval, a completeness guarantee for upstream data, or an HTTP capacity/SLO certification.

The review compares accumulated changes in `/Users/jinjoopwer/ddakfit-operations-20260917` against HEAD `e2ee1f1`, including the assigned untracked files. The previous five-file performance review was treated as historical evidence, not approval of this broader candidate. Root owns the complete release inventory and final integration decision; this report accounts for the SRE subset rather than claiming independent coverage of every changed file in the repository.

## Concrete findings and disposition

### R-SRE-1 — Major, expired preserved rows consume the catalog limit — fixed

**Condition:** non-exhaustive sources preserve unseen rows with `closed_at = null`. The original query orders by `apply_end` and takes 3,000 rows before application-side deadline filtering. Enough preserved expired rows therefore crowd current notices out of the page.

**Reproduction:** actual `fetchOpenPrograms`, actual Supabase SDK query generation and an offline PostgREST fixture containing 3,000 expired EGBIZ rows plus one future notice. Before correction the live notice was missing, and `usingSample` was `true`, despite a live row in the store. No production data was read.

**Minimal correction:** `getOpenPrograms` now requests `(apply_end IS NULL OR apply_end >= kstToday())` before ordering/limit. The client-side `isStillOpen` guard remains, so a deadline crossed while transport is pending is rechecked. Deadline-day and undated notices remain eligible, closed rows stay excluded, and each query computes the current KST date. Explicit limits, narrowed projection and AbortSignal propagation are retained. This is a correctness fix; no new speedup percentage is claimed.

### R-SRE-2 — Minor, limiter construction bypasses controlled failure handling — fixed

**Condition:** constructing the Redis client or rate limiter throws because of invalid configuration. Construction previously occurred outside the existing catch block.

**Impact and reproduction:** a constructor that throws causes `checkRateLimit` to reject instead of returning the documented unavailable result. Costly operations remain denied, but callers receive an uncontrolled 500 rather than 503 plus `Retry-After: 5`. Both Redis-constructor and limiter-constructor failures were tested without real transport.

**Minimal correction:** move `getLimiter` and the missing-configuration branch inside `try`. Production fail-closed behavior and development-without-credentials behavior remain unchanged. Raw configuration details are not returned to users.

### R-SRE-3 — Major, partial Bizinfo/K-Startup collection closes live notices — fixed

**Condition:** `fetchBizinfoOpen` and `fetchKstartupOpen` accept fulfilled pages from `Promise.allSettled`, while their pagination is also capped. Their returned arrays are not guaranteed complete, but persistence previously inferred closure from absence.

**Reproduction:** actual collector functions received synthetic page 1 containing A and a page 2 failure. Each returned A successfully. Actual `upsertAndDiff` against a fixture containing A and still-open B set B's `closed_at` to `2026-09-17T03:00:00Z` and reported `closed: 1`. B's actual deadline remained `2026-12-31`. This was an existing source/persistence defect confirmed during broader preflight, not a newly invented performance regression.

**Minimal correction:** add `bizinfo` and `kstartup` to the same non-exhaustive persistence policy already used by `bojo` and `egbiz`. Missing rows no longer authorize closure; observed rows still update. Four new regressions cover both real collectors' partial-page behavior and direct partial persistence for each source. The previous exhaustive-source fixture was moved from K-Startup to NIPA to reflect the new policy; its ordinary closure path still passes.

**Tradeoff:** a genuinely withdrawn future-dated or undated notice can remain until there is positive closure evidence. Expired dated rows are excluded by the new SQL filter and the existing application guard. The change does not reopen already closed historical rows, repair prior misclosures, turn partial collector results into complete snapshots, or add a complete-source signal. Evidence-based retirement/reconciliation and source completeness telemetry remain follow-up work. Simply replacing `allSettled` with `all` would not resolve fixed pagination caps, so this review did not claim that change alone could make destructive mark-and-sweep safe.

## Actual coverage and activation boundaries

| Assigned paths | Review/verification | Activation and limits |
|---|---|---|
| `lib/ratelimit.ts` and all changed callers' `tooManyRequests(..., unavailable)` usage | SDK timeout-as-success handling, constructor/transport errors, production missing config, 429/503/Retry-After propagation | Active protection on existing endpoints. Redis configuration/ACL and proxy/IP trust must be checked for the actual deployment; request security is also covered by Reviewer. |
| `lib/data/egbiz.ts`, `lib/data/collectionError.ts`, `lib/data/collectionRun.ts`, `scripts/collect-programs.mts`, `app/api/cron/collect-programs/route.ts` | EGBIZ page/schema/count/budget failure boundaries; no destructive missing-row inference; safe structured failure fields; per-source collection/persistence stages; CLI exit code; cron secret and existing response shape | Active scheduled/CLI path. Logs do not imply complete upstream coverage or alert delivery. Cron keeps HTTP 200 with `ok:false` on partial failure, so status-only monitoring is insufficient. |
| `lib/supabase/programs.ts`, `lib/data/programs.ts`, `lib/data/openFilter.ts`, `lib/data/trustedProgramUrl.ts` | Query contract, date/LIMIT interaction, fallback, KST midnight, narrowed columns, explicit signal, persistence policy; trusted URL change is a type-import relocation | Active catalog path. App guard stays after retrieval; real PostgREST row caps and live data distribution were not observed. |
| Supporting collector code `lib/data/bizinfo.ts`, `lib/data/kstartup.ts`, `lib/data/bojo.ts`, and the collector registry | Actual partial-page counterexamples and persistence interaction; pagination caps and absence/closure distinction | The first two supporting files were read/tested but not edited. Positive source-completeness and withdrawal signals remain unavailable. |
| `lib/data/catalogCache.ts`, `lib/scale/snapshotCache.ts`, `lib/scale/redisSnapshotStore.ts` | Per-process flight sharing, fresh/stale expiry, clone isolation, lease publish/release fencing, bounded loading, failure cooldown; actual Redis integration | Shared catalog cache is enabled only by `PROGRAM_CACHE_ENABLED=on`. Default path remains direct DB read. No flag was enabled in production; isolate Preview/Production keys and stores before rollout. |
| `lib/scale/jobs.ts`, `lib/scale/serverJobStore.ts` | Claim/heartbeat/complete/fail contract, token fencing, deadline interruption, handler failure classification, bounded RPC signal | Dormant: no production route or actual paid handler calls this worker/store. AbortSignal is cooperative; ignoring it can leave side effects running. Payment binding, attempt-specific artifacts and a dedicated worker remain activation gates. |
| `infra/scale/jobs.sql` | Queue admission/idempotency, queue/owner/attempt caps, transaction locks, expired-lease recovery, result/error size checks, RLS and function grants; actual Postgres tests | Candidate schema applied once to the isolated local lab only. No production SQL, RPC endpoint or queue activation occurred. |
| `infra/scale/compose.yml`, `infra/scale/catalog-index.sql` | Compose endpoints bind loopback; Redis persistence off, Postgres data on tmpfs; index is a separate operational candidate | Test infrastructure only. Fixed test password, floating image tags and disposable storage are unsuitable as a production deployment plan. No index was applied to production. |
| `scripts/performance-benchmark.mjs`, `scripts/performance-db-benchmark.mjs`, `scripts/performance-team-benchmark.mjs`, `scripts/scale-benchmark.mjs` | Source/input identity, mock boundaries, sample/warmup separation, pooled-profile bias, sequential warm-cache effects, memory interpretation and overwrite behavior | Standalone tools, not deployed handlers. Legacy scripts can overwrite historical JSON; none was rerun for this release. Existing speedups belong to their recorded earlier source hashes. |
| `tests/collection-rca.test.mjs`, `tests/performance.test.mjs`, `tests/scale-unit.test.mjs`, `tests/scale-integration.test.mjs`, `tests/release-sre.test.mjs` | Ran the actual suites described below; changed only the exhaustive-source fixture and the SRE release regressions in this phase | No paid provider or production storage traffic. Offline PostgREST is a predicate/order/limit model, not a PostgreSQL server. |
| `tests/helpers/collection-harness.mjs`, `tests/helpers/performance-harness.mjs`, `tests/helpers/scale-harness.mjs`; prior SRE/team guards and source fixtures | Checked source-loading/mocking boundaries and fixed local DB/Redis targeting; prior benchmark baselines/results retained | Existing shared helpers and historical performance artifacts were not changed in release preflight. Root/Reviewer own their independently executed suites. |
| `.github/workflows/collect-programs.yml`, `vercel.json`, scale/runbook documents | Existing schedules, CLI/runtime assumptions, fixed local initialization, opt-in/deployment separation | No schedule, secret, production environment variable or external alert destination was changed. |

## Local verification actually completed

On the final SRE source:

```sh
node --test tests/release-sre.test.mjs tests/collection-rca.test.mjs tests/scale-unit.test.mjs tests/performance.test.mjs
npm run test:scale:integration
npm run test:guards
npx eslint lib/supabase/programs.ts lib/ratelimit.ts tests/release-sre.test.mjs tests/collection-rca.test.mjs
```

- **82/82** offline/unit/contract tests passed: release SRE 11, collection 24, scale unit 12, prior performance correctness 35.
- **13/13** existing integration tests passed against actual local Redis/Postgres: Redis 5 and Postgres 8. This includes 100 cold requests across 10 cache objects, stale expiry, lost lease publication, source timeout, same-key admission, global/owner caps, competing claims, stale token fencing, retry/dead state and browser-role denial.
- Product guards passed, including entry/submission/deadline/source/evidence flows and offline PPTX/PDF/DOCX generation. Changed-file ESLint passed.
- No large benchmark was repeated. Query-prefilter correctness tests do not establish DB performance, full HTTP latency or throughput.

The initial integration attempt passed Redis but failed Postgres because restarting the disposable tmpfs lab had removed `scale_job_queues` and its test roles. This was environment initialization, not a hidden product test pass. The empty isolated lab was then initialized with `anon`, `authenticated`, `service_role BYPASSRLS` and `infra/scale/jobs.sql` **once**, using the fixed compose/database, and all 13 tests passed. An earlier attempt to run a custom Node-to-Docker permission probe was blocked by the sandbox and interrupted while awaiting approval; it did not apply SQL. The approved CLI/integration path completed the verification after resumption.

Additional direct local PostgreSQL privilege queries returned:

| Role | SELECT jobs | SELECT queue config | EXECUTE enqueue/claim/heartbeat/complete/fail |
|---|---|---|---|
| `anon` | false | false | all false |
| `authenticated` | false | false | all false |
| `service_role` | true | true | all true |

RLS is enabled on both tables. The integration suite also actually attempts forbidden table/worker access and successfully enqueues with `service_role`; this is more than a static grant inspection. Both tables and all five functions explicitly revoke PUBLIC and browser-role grants, and functions use `SECURITY INVOKER`. Live Supabase default privileges, exposed schemas, project roles and Data API configuration were not inspected and must be rechecked before any separate queue rollout.

Local Redis port **26379** and PostgreSQL port **25432** remain running for Root/Reviewer tests at handoff. No other containers, keys, schemas or databases were stopped or modified. The local tests create only synthetic rows/queues/keys in this fixed lab. No production connection string was used.

## Observability and production gates

Collector logs contain a run ID, source, phase, duration, outcome/counts and bounded failure fields. Rate-limit transport/constructor failures emit a bounded component/event/kind record. These logs are not proof of a configured metrics backend, dashboard, alert destination, on-call notification or successful alert delivery.

Architect separately implemented/reviewed operations request ID, method, phase, status and duration logging and sanitized payment-event logs. That adjacent work is recorded in [the consolidated release review](release-review.md); SRE does not claim to have independently deployed or end-to-end tested an external log/metrics/alert system.

Before production promotion of the broader release:

1. **Use the exact candidate in Preview.** Verify Google administrator, ordinary user and unauthenticated boundaries, save/reload/conflict behavior, and controlled Redis failure with the actual deployment configuration. Confirm production QA/local bypass flags are off. Root's local unauthenticated HTTP smoke and component fixtures do not replace this.
2. **Validate actual Redis permissions and payment event contracts.** Check the required EVAL/key ACLs and region/configuration on the destination. In an agreed isolated provider environment, check Word/bundle/presentation purchases, rebuy, duplicate events, refund/cancellation and delayed completion, including the provider's exact event shape and order identifier types. Root reports separate actual local Redis payment checks; those do not test the payment provider's network event contract.
3. **Prove rollback and backup recovery.** Record the previous deploy identifier, version compatibility and recovery steps for operational records and the payment ledger. Test restoring a backup. Already closed historical catalog rows and previously affected orders/leads require evidence-based reconciliation; the new code does not silently repair production records.
4. **Connect and test operational alerts.** Route operations 5xx, payment failures, lead persist/finalize failures, collector failures/partial outcomes and stale source data to an explicit destination. Inject a bounded test failure and verify notification arrival and resolution, with request/run IDs allowing correlation. Cron HTTP 200 alone cannot distinguish a successful collection from `ok:false`; partial fetches that return arrays also must not be treated as source completeness. Do not log tokens, response bodies, user documents, signed URLs or raw provider exceptions.
5. **Keep dormant components dormant until their own gates pass.** `PROGRAM_CACHE_ENABLED` requires Preview fault/freshness testing and isolated environment data/key scope. Queue code needs authenticated ownership/payment admission, an actual bounded worker, cancellation/side-effect handling, attempt-specific output storage, live SQL privilege checks and deployment/rollback validation. Merely deploying these files does not activate or certify the queue. Candidate catalog indexes require live plans and write-cost review, not the historical TEMP-table benchmark.

No production HTTP load, live DB query plan, paid AI execution, authenticated Preview flow, provider callback, browser performance test, restore drill or external alert delivery was performed by this SRE preflight. The completed local evidence supports the source fixes and failure boundaries stated above, not a blanket production SLO or 100× capacity claim.

## Frozen SRE handoff hashes

| File | SHA-256 |
|---|---|
| `lib/supabase/programs.ts` | `25441ff40cfa5deea7393a0b11af68cf306c2a9f31001c518a2b2b5b46e50255` |
| `lib/ratelimit.ts` | `634192359e3bf7470ecc9005d431fede1a13b0e318acaab503bb83f58f7bf7c8` |
| `tests/release-sre.test.mjs` | `98cec5ef7284275fecfbf53d11fc436776d7be420f2cc18552835dcfb3df29fa` |
| `tests/collection-rca.test.mjs` | `34ebf77414323f178d394d725c263a4ac81263f94fb106026546d0748e5811be` |

The previous [performance report](team-sre.md), immutable before snapshots and raw historical JSON remain unchanged. They continue to identify their own tested source version and are not relabeled as measurements of these later collection/query/payment changes.

Reference for the verified query syntax: [Supabase JavaScript OR filters](https://supabase.com/docs/reference/javascript/using-filters-or). The current changelog was checked before implementation; the installed SDK also generated and executed the expected mocked transport query. Only the server-generated KST date is interpolated into the raw OR expression.
