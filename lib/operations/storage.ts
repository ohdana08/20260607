import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validMonth, type OperationsMonth } from "./domain.ts";
import { AUTH_ANON_KEY, AUTH_URL } from "../auth/config.ts";

export interface OperationsStore {
  read(month: string): Promise<OperationsMonth | null>;
  compareAndSet(
    month: string,
    expectedRevision: number,
    next: OperationsMonth,
  ): Promise<OperationsMonth | null>;
}
export class OperationsStorageAccessError extends Error {
  constructor() {
    super("Operations storage access denied");
    this.name = "OperationsStorageAccessError";
  }
}
export const OPERATIONS_RPC_TIMEOUT_MS = 3_000;
export class PostgresOperationsStore implements OperationsStore {
  private readonly authorization: string;
  constructor(
    authorization: string,
    private readonly scope: string,
    private readonly capability: string,
    private readonly transport: typeof fetch = fetch,
    private readonly timeoutMs = OPERATIONS_RPC_TIMEOUT_MS,
  ) {
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token || /\s/.test(token)) throw new Error("Operations authentication required");
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(scope) || !/^[A-Za-z0-9_-]{43,128}$/.test(capability)) {
      throw new Error("Operations storage not configured");
    }
    this.authorization = `Bearer ${token}`;
  }
  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.transport(`${AUTH_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: AUTH_ANON_KEY,
          Authorization: this.authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...args, p_scope: this.scope, p_capability: this.capability }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 401 || response.status === 403) throw new OperationsStorageAccessError();
      if (!response.ok) throw new Error("RPC unavailable");
      return await response.json();
    } catch (error) {
      if (error instanceof OperationsStorageAccessError) throw error;
      // Never propagate PostgREST bodies, JWTs or transport error details.
      // In particular, do not retry a write whose commit outcome is unknown.
      throw new Error("Operations storage unavailable");
    }
  }
  async read(month: string): Promise<OperationsMonth | null> {
    if (!validMonth(month)) throw new Error("Invalid operations month");
    const value = await this.rpc("ddakfit_operations_read", { p_month: month });
    return this.state(value, month);
  }
  private state(value: unknown, month: string): OperationsMonth | null {
    if (value === null) return null;
    const state = value as OperationsMonth;
    if (!state || state.schemaVersion !== 1 || state.goal?.month !== month ||
      !Number.isSafeInteger(state.revision) || state.revision < 1 ||
      !Array.isArray(state.snapshots) || !Array.isArray(state.videos) || !Array.isArray(state.audit)) {
      throw new Error("Operations storage unavailable");
    }
    return state;
  }
  async compareAndSet(
    month: string,
    expectedRevision: number,
    next: OperationsMonth,
  ) {
    if (!validMonth(month) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      expectedRevision > 1_000_000_000_000 || next.revision !== expectedRevision + 1 || next.goal?.month !== month) {
      throw new Error("Invalid operations revision");
    }
    const result = await this.rpc("ddakfit_operations_compare_and_set", {
      p_month: month, p_expected_revision: expectedRevision, p_next: next,
    });
    const stored = this.state(result, month);
    if (stored && stored.revision !== expectedRevision + 1) throw new Error("Operations storage unavailable");
    return stored;
  }
}
// Development only. The route factory never selects this adapter in production.
// One local Next.js process serializes writers; hosted deployments use Postgres CAS.
let queue: Promise<unknown> = Promise.resolve();
export class LocalOperationsStore implements OperationsStore {
  constructor(private readonly directory: string) {}
  private file(month: string) {
    if (!validMonth(month)) throw new Error("invalid month");
    return path.join(this.directory, `${month}.json`);
  }
  async read(month: string): Promise<OperationsMonth | null> {
    try {
      return JSON.parse(
        await readFile(this.file(month), "utf8"),
      ) as OperationsMonth;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async compareAndSet(
    month: string,
    expectedRevision: number,
    next: OperationsMonth,
  ) {
    const run = queue.then(async () => {
      const current = await this.read(month);
      if ((current?.revision ?? 0) !== expectedRevision) return null;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file(month)}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, this.file(month));
      return structuredClone(next);
    });
    queue = run.catch(() => {});
    return run;
  }
}
export function createOperationsStore(local: boolean, authorization: string | null = null): OperationsStore {
  if (local) {
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.OPS_LOCAL_MODE !== "on"
    )
      throw new Error("Local operations storage disabled");
    return new LocalOperationsStore(
      path.join(process.cwd(), ".local", "operations"),
    );
  }
  return new PostgresOperationsStore(
    authorization ?? "",
    process.env.OPS_POSTGRES_SCOPE ?? "",
    process.env.OPS_POSTGRES_CAPABILITY ?? "",
  );
}
