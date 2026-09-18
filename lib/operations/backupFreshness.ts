import { createHash } from "node:crypto";

export const BACKUP_MAX_AGE_MS = 7 * 60 * 60 * 1000;
export const BACKUP_CHECK_TIMEOUT_MS = 5_000;
export const BACKUP_ACTIVE_GRACE_MS = 30 * 60 * 1000;
export const BACKUP_ALERT_PHASES = [
  "backup_missing", "backup_stale", "backup_run", "backup_job",
  "backup_artifact", "backup_github_error", "backup_github_timeout",
] as const;
export type BackupAlertPhase = typeof BACKUP_ALERT_PHASES[number];
export type BackupFreshnessReason = "fresh" | "fresh_pending" | "run_missing" | "run_stale" | "run_unverified" |
  "job_unverified" | "artifact_unverified" | "github_unavailable" | "github_invalid" | "github_timeout";
export type BackupFreshnessResult = { ok: boolean; reason: BackupFreshnessReason; runId?: number; runAttempt?: number };
const API = "https://api.github.com/repos/ohdana08/20260607/actions";
export const BACKUP_REQUIRED_STEPS = [
  "Encrypt a consistent read-only scope snapshot",
  "Upload encrypted offsite copy",
  "Download the stored copy into a different directory",
  "Reject missing, changed, undecryptable or stale offsite copy",
  "Restore the downloaded copy into fresh local PostgreSQL 17 and verify",
  "Store verified RPO and isolated RTO evidence",
] as const;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const positiveInteger = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const timestamp = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(v) ? Date.parse(v) : NaN;
const failed = (reason: BackupFreshnessReason): BackupFreshnessResult => ({ ok: false, reason });
class GitHubCheckError extends Error {
  constructor(readonly reason: "github_unavailable" | "github_invalid") { super(reason); }
}

// Never follows response URLs, sends a GitHub/cron token, or logs upstream data.
async function github(path: string, transport: typeof fetch, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await transport(API + path, {
    method: "GET", headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ddakfit-backup-freshness" },
    cache: "no-store", redirect: "error", signal,
  });
  if (!response.ok) throw new GitHubCheckError("github_unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new GitHubCheckError("github_invalid");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new GitHubCheckError("github_invalid");
      chunks.push(value);
    }
  } finally { void reader.cancel().catch(() => {}); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new GitHubCheckError("github_invalid"); }
  if (!object(body)) throw new GitHubCheckError("github_invalid");
  return body;
}

function completeList(body: Record<string, unknown>, field: string): Record<string, unknown>[] | null {
  const list = body[field];
  return Array.isArray(list) && Number.isSafeInteger(body.total_count) && body.total_count === list.length &&
    list.length <= 100 && list.every(object) ? list : null;
}

function latestRun(runs: Record<string, unknown>): (Record<string, unknown> & { id: number; run_attempt: number }) | null {
  if (!Number.isSafeInteger(runs.total_count) || Number(runs.total_count) < 0 ||
      !Array.isArray(runs.workflow_runs) || runs.workflow_runs.length > 1) throw new GitHubCheckError("github_invalid");
  if (runs.total_count === 0 && runs.workflow_runs.length === 0) return null;
  const run: unknown = runs.workflow_runs[0];
  if (!object(run) || !positiveInteger(run.id) || !positiveInteger(run.run_attempt) || Number(runs.total_count) < 1) throw new GitHubCheckError("github_invalid");
  return run as Record<string, unknown> & { id: number; run_attempt: number };
}

async function inspect(transport: typeof fetch, now: () => number, signal: AbortSignal,
  context: { runId?: number; runAttempt?: number }): Promise<BackupFreshnessResult> {
  // Inspect the newest run first: a completed failure must not be hidden by an old success.
  let run = latestRun(await github("/workflows/operations-backup.yml/runs?branch=main&per_page=1", transport, signal));
  if (!run) return failed("run_missing");
  context.runId = run.id; context.runAttempt = run.run_attempt;
  if (run.head_branch !== "main" || (run.event !== "schedule" && run.event !== "workflow_dispatch")) return failed("run_unverified");
  const pending = (run.status === "queued" || run.status === "in_progress") && run.conclusion === null;
  let pendingStarted = NaN;
  if (pending) {
    pendingStarted = Number.isFinite(timestamp(run.run_started_at)) ? timestamp(run.run_started_at) : timestamp(run.created_at);
    const age = now() - pendingStarted;
    if (!Number.isFinite(age) || age < 0) return failed("github_invalid");
    if (age > BACKUP_ACTIVE_GRACE_MS) return failed("run_unverified");
    run = latestRun(await github("/workflows/operations-backup.yml/runs?branch=main&status=success&per_page=1", transport, signal));
    if (!run) return failed("run_missing");
  }
  if (run.head_branch !== "main" || (run.event !== "schedule" && run.event !== "workflow_dispatch") ||
      run.status !== "completed" || run.conclusion !== "success") return failed("run_unverified");
  const startedAt = timestamp(run.run_started_at);
  const current = now();
  if (!Number.isFinite(startedAt) || !Number.isFinite(current) || startedAt > current) return failed("github_invalid");
  if (current - startedAt > BACKUP_MAX_AGE_MS) return failed("run_stale");
  const [jobPage, artifactPage] = await Promise.all([
    github(`/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, transport, signal),
    github(`/runs/${run.id}/artifacts?per_page=100`, transport, signal),
  ]);
  const jobs = completeList(jobPage, "jobs"), artifacts = completeList(artifactPage, "artifacts");
  if (!jobs || !artifacts) return failed("github_invalid");
  const backup = jobs.filter((job) => job.name === "backup");
  if (backup.length !== 1 || backup[0].run_id !== run.id || backup[0].status !== "completed" ||
      backup[0].conclusion !== "success" || !Array.isArray(backup[0].steps)) return failed("job_unverified");
  for (const name of BACKUP_REQUIRED_STEPS) {
    const matches = backup[0].steps.filter((step: unknown) => object(step) && step.name === name);
    if (matches.length !== 1 || matches[0].status !== "completed" || matches[0].conclusion !== "success") return failed("job_unverified");
  }
  const checkedAt = now();
  if (!Number.isFinite(checkedAt) || checkedAt < startedAt) return failed("github_invalid");
  if (pending && checkedAt - pendingStarted > BACKUP_ACTIVE_GRACE_MS) return failed("run_unverified");
  // Re-evaluate after network waits, including a run/artifact expiring during the check.
  if (checkedAt - startedAt > BACKUP_MAX_AGE_MS) return failed("run_stale");
  for (const name of [`operations-backup-${run.id}-${run.run_attempt}`, `operations-backup-verified-${run.id}-${run.run_attempt}`]) {
    const matches = artifacts.filter((artifact) => artifact.name === name);
    if (matches.length !== 1 || matches[0].expired !== false || !positiveInteger(matches[0].size_in_bytes) ||
        !(timestamp(matches[0].expires_at) > checkedAt) || !(timestamp(matches[0].created_at) >= startedAt)) return failed("artifact_unverified");
  }
  return { ok: true, reason: pending ? "fresh_pending" : "fresh" };
}

export async function checkBackupFreshness({ transport = fetch, now = Date.now, timeoutMs = BACKUP_CHECK_TIMEOUT_MS }:
  { transport?: typeof fetch; now?: () => number; timeoutMs?: number } = {}): Promise<BackupFreshnessResult> {
  const controller = new AbortController();
  const context: { runId?: number; runAttempt?: number } = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      inspect(transport, now, controller.signal, context).catch((error: unknown) =>
        failed(error instanceof GitHubCheckError ? error.reason : "github_unavailable")),
      new Promise<BackupFreshnessResult>((resolve) => {
        timer = setTimeout(() => { resolve(failed("github_timeout")); controller.abort(); }, timeoutMs);
      }),
    ]);
    return { ...result, ...context };
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}

export function backupFreshnessRequestId(now: number, reason: BackupFreshnessReason = "github_unavailable", runId = 0, runAttempt = 0): string {
  const bytes = createHash("sha256").update(`operations-backup-monitor:v2:${Math.floor(now / 21_600_000)}:${reason}:${runId}:${runAttempt}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // Deterministic custom UUID v8, RFC variant.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function backupFreshnessPhase(reason: BackupFreshnessReason): BackupAlertPhase {
  switch (reason) {
    case "run_missing": return "backup_missing";
    case "run_stale": return "backup_stale";
    case "run_unverified": return "backup_run";
    case "job_unverified": return "backup_job";
    case "artifact_unverified": return "backup_artifact";
    case "github_timeout": return "backup_github_timeout";
    default: return "backup_github_error";
  }
}
