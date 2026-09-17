import type { OperationsEvent } from "./http.ts";

export const OPERATIONS_ALERT_TIMEOUT_MS = 2_000;
export type AlertResult = "sent" | "skipped" | "failed";
export interface AlertOptions {
  env?: Record<string, string | undefined>;
  transport?: typeof fetch;
}
const phases = new Set(["method", "auth", "origin", "input", "read", "write"]);

// This projection is intentionally independent of event serialization: future
// event fields must not silently become outbound account or request data.
export function operationsAlertPayload(event: OperationsEvent, deployment: string | undefined) {
  return {
    requestId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.requestId)
      ? event.requestId : "unknown",
    method: ["GET", "PUT"].includes(event.method) ? event.method : "OTHER",
    phase: phases.has(event.phase) ? event.phase : "unknown",
    status: event.status,
    durationMs: Number.isFinite(event.durationMs)
      ? Math.min(300_000, Math.max(0, Math.round(event.durationMs))) : 0,
    deployment: ["production", "preview", "development"].includes(deployment ?? "")
      ? deployment : "unknown",
  };
}

export interface AlertAttempt { outcome: AlertResult; retryAfterSeconds?: number }

export async function sendOperationsAlertAttempt(
  event: OperationsEvent,
  { env = process.env, transport = fetch }: AlertOptions = {},
): Promise<AlertAttempt> {
  if (!Number.isInteger(event.status) || event.status < 500 || event.status > 599) return { outcome: "skipped" };
  const token = env.OPS_SLACK_BOT_TOKEN?.trim();
  const channel = env.OPS_SLACK_CHANNEL_ID?.trim();
  if (!token || !channel) return { outcome: "skipped" };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The token and channel are transport routing only, never message fields.
    const delivery = (async (): Promise<AlertAttempt> => {
      const response = await transport("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          text: JSON.stringify(operationsAlertPayload(event, env.VERCEL_ENV)),
          mrkdwn: false,
          parse: "none",
          unfurl_links: false,
          unfurl_media: false,
        }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        // A value beyond our retention becomes a terminal durable-queue decision;
        // never retry earlier than Slack requested by capping to a shorter wait.
        return { outcome: "failed", retryAfterSeconds: seconds > 0 ? Math.min(86_401, Math.max(1, Math.ceil(seconds))) : 30 };
      }
      if (!response.ok) return { outcome: "failed" };
      const result: unknown = await response.json();
      return { outcome: result !== null && typeof result === "object" && "ok" in result && result.ok === true ? "sent" : "failed" };
    })();
    // Bound the response wait even when a transport fails to honor AbortSignal.
    // This helper attempts once. Queue workers may retry an unknown outcome,
    // so the same alert can be delivered more than once.
    return await Promise.race([
      delivery,
      new Promise<AlertAttempt>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ outcome: "failed" });
        }, OPERATIONS_ALERT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Slack bodies and transport errors may contain credentials or identifiers.
    return { outcome: "failed" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Compatibility wrapper for a single direct attempt (including queue fallback).
export async function sendOperationsAlert(event: OperationsEvent, options: AlertOptions = {}): Promise<AlertResult> {
  return (await sendOperationsAlertAttempt(event, options)).outcome;
}
