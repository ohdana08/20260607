import { createHmac, timingSafeEqual } from "node:crypto";
import { backupFreshnessPhase, backupFreshnessRequestId, checkBackupFreshness } from "@/lib/operations/backupFreshness";
import { enqueueOperationsAlert } from "@/lib/operations/alertQueue";
import { sendOperationsAlert } from "@/lib/operations/alert";
import type { OperationsEvent } from "@/lib/operations/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;
function log(record: Record<string, string | number | boolean>) {
  try { console.info(JSON.stringify(record)); } catch { /* Monitoring never depends on a log sink. */ }
}

export async function GET(request: Request) {
  const secret = process.env.OPS_BACKUP_MONITOR_SECRET;
  const timestamp = request.headers.get("x-ops-monitor-timestamp") ?? "";
  const signature = request.headers.get("x-ops-monitor-signature") ?? "";
  // The scheduler retains a short-lived derived signature, never the static key.
  // Sign the exact timestamp string; bearer credentials are not accepted here.
  if (!secret || secret.length < 32 || !/^\d{1,12}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature) ||
      Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300 ||
      !timingSafeEqual(createHmac("sha256", secret).update(timestamp).digest(), Buffer.from(signature, "hex"))) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const started = Date.now();
  const result = await checkBackupFreshness();
  const requestId = backupFreshnessRequestId(started, result.reason, result.runId, result.runAttempt);
  const status = result.ok ? 200 : 503;
  const durationMs = Math.min(300_000, Math.max(0, Date.now() - started));
  log({ event: "operations_backup_monitor", requestId, status, reason: result.reason, durationMs });
  if (!result.ok) {
    const event: OperationsEvent = { event: "operations_request", requestId, method: "GET", phase: backupFreshnessPhase(result.reason), status, durationMs };
    let queueAck: "queued" | "skipped" | "failed" | "unknown";
    try { queueAck = await enqueueOperationsAlert(event); } catch { queueAck = "failed"; }
    log({ event: "operations_alert", requestId, status, queue_ack: queueAck });
    if (queueAck === "failed" || queueAck === "unknown") {
      let fallback: "sent" | "skipped" | "failed";
      try { fallback = await sendOperationsAlert(event); } catch { fallback = "failed"; }
      log({ event: "operations_alert", requestId, status, fallback_slack_ack: fallback });
    }
  }
  return Response.json({ ...result, requestId }, { status, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } });
}
