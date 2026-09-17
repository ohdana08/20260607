import { getGoogleUser } from "@/lib/auth/googleUser";
import {
  isLocalOperationsRequest,
  operationsRequest,
} from "@/lib/operations/http";
import { createOperationsStore } from "@/lib/operations/storage";
import { sendOperationsAlert } from "@/lib/operations/alert";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function handle(req: Request) {
  const local = isLocalOperationsRequest(req);
  return operationsRequest(req, {
    local,
    authenticate: local
      ? async () => ({ id: "local-operator", isAdmin: true })
      : getGoogleUser,
    store: () => createOperationsStore(local, req.headers.get("authorization")),
    observe: async (event) => {
      if (event.status < 500 || event.status > 599) return;
      const outcome = await sendOperationsAlert(event);
      console.info(JSON.stringify({
        event: "operations_alert", requestId: event.requestId,
        status: event.status, outcome,
      }));
    },
  });
}
export const GET = handle;
export const PUT = handle;
