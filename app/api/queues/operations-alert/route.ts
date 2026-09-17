import { handleCallback } from "@vercel/queue";
import { consumeOperationsAlert, retryOperationsAlert } from "@/lib/operations/alertQueue";

export const runtime = "nodejs";
export const maxDuration = 15;
// Vercel's queue trigger is internal-only; arbitrary internet requests cannot
// invoke this consumer. The SDK owns delivery leases and acknowledgements.
const callback = handleCallback(consumeOperationsAlert, {
  visibilityTimeoutSeconds: 30,
  retry: retryOperationsAlert,
});

export async function POST(request: Request) {
  return callback(request);
}
