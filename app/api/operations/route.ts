import { getGoogleUser } from "@/lib/auth/googleUser";
import {
  isLocalOperationsRequest,
  operationsRequest,
} from "@/lib/operations/http";
import { createOperationsStore } from "@/lib/operations/storage";
import { sendOperationsAlert } from "@/lib/operations/alert";
import { enqueueOperationsAlert } from "@/lib/operations/alertQueue";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handle(req: Request) {
  const local = isLocalOperationsRequest(req);
  return operationsRequest(req, {
    local,
    authenticate: local
      ? async () => ({ id: "local-operator", isAdmin: true })
      : (request) => getGoogleUser(request, { dependencyErrors: true }),
    store: () => createOperationsStore(local, req.headers.get("authorization")),
    observe: async (event) => {
      if (event.status < 500 || event.status > 599) return;
      const queueAck = await enqueueOperationsAlert(event);
      try {
        console.info(JSON.stringify({
          event: "operations_alert", requestId: event.requestId,
          status: event.status, queue_ack: queueAck,
        }));
      } catch { /* Logging must not prevent the fallback attempt. */ }
      if (queueAck === "failed" || queueAck === "unknown") {
        const fallback = await sendOperationsAlert(event);
        try {
          console.info(JSON.stringify({
            event: "operations_alert", requestId: event.requestId,
            status: event.status, fallback_slack_ack: fallback,
          }));
        } catch { /* Preserve the original operations response. */ }
      }
    },
  });
}
export const GET = handle;
export const PUT = handle;
