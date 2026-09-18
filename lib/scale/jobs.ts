export interface Job {
  id: string; queue: string; owner_id: string; payload: Record<string, unknown>;
  state: "queued" | "running" | "succeeded" | "dead";
  attempts: number; lease_token: string | null; lease_until: string | null;
  runtime_deadline: string | null;
}
export interface JobStore {
  claim(queue: string): Promise<Job | null>;
  heartbeat(id: string, token: string): Promise<boolean>;
  complete(id: string, token: string, result: Record<string, unknown>): Promise<boolean>;
  fail(id: string, token: string, code: string, retryable: boolean): Promise<boolean>;
}
// The adapter accepts the existing server-side Supabase client's rpc function.
// It must never be initialized with a browser client or exposed to unauthenticated users.
export interface JobRpc {
  (name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
export class RpcJobStore implements JobStore {
  constructor(private readonly rpc: JobRpc) {}
  private async call(name: string, args: Record<string, unknown>) {
    const { data, error } = await this.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async enqueue(queue: string, ownerId: string, key: string, payload: Record<string, unknown>) {
    return await this.call("scale_enqueue", { p_queue: queue, p_owner: ownerId, p_key: key, p_payload: payload }) as Job;
  }
  async claim(queue: string) {
    const jobs = await this.call("scale_claim", { p_queue: queue }) as Job[];
    return jobs[0] ?? null;
  }
  async heartbeat(id: string, token: string) { return await this.call("scale_heartbeat", { p_id: id, p_token: token }) === true; }
  async complete(id: string, token: string, result: Record<string, unknown>) {
    return await this.call("scale_complete", { p_id: id, p_token: token, p_result: result }) === true;
  }
  async fail(id: string, token: string, code: string, retryable: boolean) {
    return await this.call("scale_fail", { p_id: id, p_token: token, p_code: code, p_retryable: retryable }) === true;
  }
}
export class JobFailure extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable = false) {
    super(code);
    this.code = /^[A-Z0-9_]{1,64}$/.test(code) ? code : "HANDLER_FAILED";
    this.retryable = retryable;
  }
}
export type JobHandler = (job: Job, signal: AbortSignal) => Promise<Record<string, unknown>>;

// One slot of a dedicated worker, not fire-and-forget work inside a Next.js request.
// Handlers must honor AbortSignal and use immutable attempt-specific artifact keys.
export async function processOneJob(store: JobStore, queue: string, handler: JobHandler, heartbeatMs = 10_000) {
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 5) throw new Error("invalid heartbeat interval");
  const job = await store.claim(queue);
  if (!job) return "idle" as const;
  const token = job.lease_token;
  if (!token || !job.runtime_deadline) throw new Error("invalid claimed job");
  const controller = new AbortController();
  let lost = false, renewing = false;
  const renew = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try { if (!await store.heartbeat(job.id, token)) { lost = true; controller.abort(); } }
    catch { lost = true; controller.abort(); }
    finally { renewing = false; }
  }, heartbeatMs);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new JobFailure("WORKER_INTERRUPTED", true)), { once: true });
    deadline = setTimeout(() => controller.abort(), Math.max(0, Date.parse(job.runtime_deadline!) - Date.now()));
  });
  try {
    if (Date.parse(job.runtime_deadline) <= Date.now()) throw new JobFailure("WORKER_DEADLINE", true);
    const result = await Promise.race([handler(job, controller.signal), interrupted]);
    if (lost) return "lease_lost" as const;
    return await store.complete(job.id, token, result) ? "succeeded" as const : "lease_lost" as const;
  } catch (error) {
    if (lost) return "lease_lost" as const;
    const failure = error instanceof JobFailure ? error : new JobFailure("HANDLER_FAILED");
    return await store.fail(job.id, token, failure.code, failure.retryable) ? "failed" as const : "lease_lost" as const;
  } finally {
    clearInterval(renew);
    clearTimeout(deadline);
  }
}
