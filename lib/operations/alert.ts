import type { OperationsEvent } from "./http.ts";

export const OPERATIONS_ALERT_TIMEOUT_MS = 2_000;
type AlertResult = "sent" | "skipped" | "failed";
interface AlertOptions {
  env?: Record<string, string | undefined>;
  transport?: typeof fetch;
}
const phases = new Set(["method", "auth", "origin", "input", "read", "write"]);

// This projection is intentionally independent of event serialization: future
// event fields must not silently become outbound account or request data.
function message(event: OperationsEvent, deployment: string | undefined): string {
  return JSON.stringify({
    requestId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(event.requestId)
      ? event.requestId : "unknown",
    method: ["GET", "PUT"].includes(event.method) ? event.method : "OTHER",
    phase: phases.has(event.phase) ? event.phase : "unknown",
    status: event.status,
    durationMs: Number.isFinite(event.durationMs)
      ? Math.min(300_000, Math.max(0, Math.round(event.durationMs))) : 0,
    deployment: ["production", "preview", "development"].includes(deployment ?? "")
      ? deployment : "unknown",
  });
}

export async function sendOperationsAlert(
  event: OperationsEvent,
  { env = process.env, transport = fetch }: AlertOptions = {},
): Promise<AlertResult> {
  if (!Number.isInteger(event.status) || event.status < 500 || event.status > 599) return "skipped";
  const token = env.OPS_SLACK_BOT_TOKEN?.trim();
  const channel = env.OPS_SLACK_CHANNEL_ID?.trim();
  if (!token || !channel) return "skipped";

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The token and channel are transport routing only, never message fields.
    const delivery = (async (): Promise<AlertResult> => {
      const response = await transport("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          text: message(event, env.VERCEL_ENV),
          mrkdwn: false,
          parse: "none",
          unfurl_links: false,
          unfurl_media: false,
        }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) return "failed";
      const result: unknown = await response.json();
      return result !== null && typeof result === "object" && "ok" in result && result.ok === true ? "sent" : "failed";
    })();
    // Bound the response wait even when a transport fails to honor AbortSignal.
    // An unknown delivery outcome is never retried.
    return await Promise.race([
      delivery,
      new Promise<AlertResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("failed");
        }, OPERATIONS_ALERT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Slack bodies and transport errors may contain credentials or identifiers.
    return "failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
