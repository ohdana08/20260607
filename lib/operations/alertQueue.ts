import { send, type SendOptions, type SendResult, type MessageMetadata, type RetryDirective } from "@vercel/queue";
import { operationsAlertPayload, sendOperationsAlertAttempt, type AlertAttempt, type AlertOptions } from "./alert.ts";
import type { OperationsEvent } from "./http.ts";

export const OPERATIONS_ALERT_TOPIC = "operations-alerts-v1";
export const OPERATIONS_ALERT_DEAD_TOPIC = "operations-alerts-dead-v1";
export const OPERATIONS_ALERT_RETENTION_SECONDS = 86_400;
export const OPERATIONS_ALERT_MAX_ATTEMPTS = 8;
export const OPERATIONS_QUEUE_ACK_TIMEOUT_MS = 2_000;
type AlertPayload = ReturnType<typeof operationsAlertPayload> & { version: 1 };
type QueueAck = "queued" | "skipped" | "failed" | "unknown";
type Publisher = (topic: string, payload: unknown, options: SendOptions) => Promise<SendResult>;
const keys = ["version", "requestId", "method", "phase", "status", "durationMs", "deployment"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validOperationsAlertPayload(value: unknown): value is AlertPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key)) &&
    v.version === 1 && typeof v.requestId === "string" && uuid.test(v.requestId) &&
    ["GET", "PUT", "OTHER"].includes(v.method as string) &&
    ["method", "auth", "origin", "input", "read", "write"].includes(v.phase as string) &&
    Number.isInteger(v.status) && Number(v.status) >= 500 && Number(v.status) <= 599 &&
    Number.isInteger(v.durationMs) && Number(v.durationMs) >= 0 && Number(v.durationMs) <= 300_000 &&
    ["production", "preview", "development", "unknown"].includes(v.deployment as string);
}

export async function enqueueOperationsAlert(event: OperationsEvent, {
  env = process.env, publish = send,
}: { env?: Record<string, string | undefined>; publish?: Publisher } = {}): Promise<QueueAck> {
  // Local SDK mode uses the real queue service. Never activate it accidentally.
  if (env.VERCEL !== "1" || !env.OPS_SLACK_BOT_TOKEN?.trim() || !env.OPS_SLACK_CHANNEL_ID?.trim()) return "skipped";
  if (!Number.isInteger(event.status) || event.status < 500 || event.status > 599) return "skipped";
  const payload = { version: 1 as const, ...operationsAlertPayload(event, env.VERCEL_ENV) };
  if (!validOperationsAlertPayload(payload)) return "failed";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ack = publish(OPERATIONS_ALERT_TOPIC, payload, {
      idempotencyKey: payload.requestId, retentionSeconds: OPERATIONS_ALERT_RETENTION_SECONDS,
      telemetry: { isEnabled: false },
    }).then(() => "queued" as const);
    // SDK 0.5.1 exposes no AbortSignal. A deadline is an unknown acceptance,
    // never a success claim. The same request ID also identifies the fallback.
    return await Promise.race([ack, new Promise<QueueAck>((resolve) => {
      timer = setTimeout(() => resolve("unknown"), OPERATIONS_QUEUE_ACK_TIMEOUT_MS);
    })]);
  } catch {
    return "failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class OperationsAlertRetryError extends Error {
  constructor(readonly retryAfterSeconds = 0) { super("Operations alert delivery failed"); }
}
function log(record: Record<string, string | number>) {
  try { console.info(JSON.stringify(record)); } catch { /* Preserve queue outcome. */ }
}
async function deadLetter(payload: AlertPayload, attempts: number, reason: string, publish: Publisher): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      publish(OPERATIONS_ALERT_DEAD_TOPIC, {
        version: 1, alert: payload, attempts: Math.min(8, Math.max(0, attempts)), reason,
      }, { idempotencyKey: `dead:${payload.requestId}`, retentionSeconds: OPERATIONS_ALERT_RETENTION_SECONDS, telemetry: { isEnabled: false } }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new OperationsAlertRetryError()), OPERATIONS_QUEUE_ACK_TIMEOUT_MS);
      }),
    ]);
  } catch {
    log({ event: "operations_alert_dead_letter", requestId: payload.requestId, status: payload.status, outcome: "persist_unconfirmed" });
    // Keep the original message unacknowledged. Further deliveries only retry
    // this durable handoff, never an additional Slack attempt after the limit.
    throw new OperationsAlertRetryError();
  } finally { if (timer) clearTimeout(timer); }
  log({ event: "operations_alert_dead_letter", requestId: payload.requestId, status: payload.status, attempts: Math.min(8, Math.max(0, attempts)), outcome: "queued", reason });
}
export async function consumeOperationsAlert(
  payload: unknown,
  metadata: Pick<MessageMetadata, "deliveryCount" | "expiresAt">,
  options: AlertOptions & { publish?: Publisher; deliver?: (event: OperationsEvent, options: AlertOptions) => Promise<AlertAttempt> } = {},
): Promise<void> {
  if (!validOperationsAlertPayload(payload)) {
    log({ event: "operations_alert_dead_letter", requestId: "unknown", status: 0, outcome: "invalid_payload" });
    return; // Poison messages are acknowledged without sending their content.
  }
  const attempts = metadata.deliveryCount;
  const remainingSeconds = metadata.expiresAt instanceof Date ? Math.floor((metadata.expiresAt.getTime() - Date.now()) / 1000) : NaN;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || !Number.isFinite(remainingSeconds)) {
    await deadLetter(payload, 0, "invalid_metadata", options.publish ?? send);
    return;
  }
  if (attempts > OPERATIONS_ALERT_MAX_ATTEMPTS || remainingSeconds <= 4) {
    await deadLetter(payload, attempts, "attempt_or_retention_limit", options.publish ?? send);
    return;
  }
  const event: OperationsEvent = {
    event: "operations_request", requestId: payload.requestId, method: payload.method,
    phase: payload.phase as OperationsEvent["phase"], status: payload.status, durationMs: payload.durationMs,
  };
  let result: AlertAttempt;
  try {
    result = await (options.deliver ?? sendOperationsAlertAttempt)(event, {
      ...options, env: { ...(options.env ?? process.env), VERCEL_ENV: payload.deployment },
    });
  } catch { result = { outcome: "failed" }; }
  log({ event: "operations_alert_delivery", requestId: payload.requestId, status: payload.status, attempt: attempts, outcome: result.outcome });
  if (result.outcome === "sent") return;
  const remainingAfterDelivery = Math.floor((metadata.expiresAt.getTime() - Date.now()) / 1000);
  const retryDelay = operationsAlertRetryDelay(new OperationsAlertRetryError(result.retryAfterSeconds), attempts);
  if (attempts >= OPERATIONS_ALERT_MAX_ATTEMPTS || retryDelay >= remainingAfterDelivery - 2) {
    const reason = attempts >= OPERATIONS_ALERT_MAX_ATTEMPTS ? "attempt_limit" :
      (result.retryAfterSeconds ?? 0) >= remainingAfterDelivery - 2 ? "retry_after_exceeds_retention" : "retry_delay_exceeds_retention";
    try {
      await deadLetter(payload, attempts, reason, options.publish ?? send);
    } catch {
      // Failed handoff must not turn a long provider delay into an early Slack
      // retry. The original may expire before this delay if both queues fail.
      throw new OperationsAlertRetryError(attempts >= OPERATIONS_ALERT_MAX_ATTEMPTS ? 0 : result.retryAfterSeconds);
    }
    return;
  }
  throw new OperationsAlertRetryError(result.retryAfterSeconds);
}

function operationsAlertRetryDelay(error: unknown, deliveryCount: number): number {
  const attempt = Math.max(1, Math.min(OPERATIONS_ALERT_MAX_ATTEMPTS, deliveryCount || 1));
  const requested = error instanceof OperationsAlertRetryError && Number.isFinite(error.retryAfterSeconds) ? error.retryAfterSeconds : 0;
  return Math.max(Math.min(3600, 30 * 2 ** (attempt - 1)), requested);
}

export function retryOperationsAlert(error: unknown, metadata: Pick<MessageMetadata, "deliveryCount">): RetryDirective {
  return { afterSeconds: operationsAlertRetryDelay(error, metadata.deliveryCount) };
}
