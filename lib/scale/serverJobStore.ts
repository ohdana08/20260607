import { createAdminClient } from "@/lib/supabase/admin";
import { RpcJobStore } from "./jobs";

// Server/worker only. Caller authenticates owner and binds payment before enqueue.
export function createServerJobStore() {
  const client = createAdminClient();
  return new RpcJobStore((name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(3_000)));
}
