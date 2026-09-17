import { getGoogleUser } from "@/lib/auth/googleUser";
import {
  isLocalOperationsRequest,
  operationsRequest,
} from "@/lib/operations/http";
import { createOperationsStore } from "@/lib/operations/storage";
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
  });
}
export const GET = handle;
export const PUT = handle;
