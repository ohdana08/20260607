import { Redis } from "@upstash/redis";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validMonth, type OperationsMonth } from "./domain.ts";

export interface OperationsStore {
  read(month: string): Promise<OperationsMonth | null>;
  compareAndSet(
    month: string,
    expectedRevision: number,
    next: OperationsMonth,
  ): Promise<boolean>;
}
export const CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local revision = 0
if current then revision = cjson.decode(current).revision end
if revision ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;
const key = (month: string) => `gp:operations:v1:${month}`;
export class RedisOperationsStore implements OperationsStore {
  constructor(private readonly redis: Redis) {}
  async read(month: string) {
    return await this.redis.get<OperationsMonth>(key(month));
  }
  async compareAndSet(
    month: string,
    expectedRevision: number,
    next: OperationsMonth,
  ) {
    return (
      (await this.redis.eval(
        CAS_SCRIPT,
        [key(month)],
        [expectedRevision, JSON.stringify(next)],
      )) === 1
    );
  }
}
// Development only. The route factory never selects this adapter in production.
// One local Next.js process serializes writers; production uses Redis EVAL across instances.
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
      if ((current?.revision ?? 0) !== expectedRevision) return false;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.file(month)}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, this.file(month));
      return true;
    });
    queue = run.catch(() => {});
    return run;
  }
}
export function createOperationsStore(local: boolean): OperationsStore {
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
  const url = process.env.UPSTASH_REDIS_REST_URL,
    token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Operations storage not configured");
  return new RedisOperationsStore(
    new Redis({ url, token, retry: { retries: 1, backoff: () => 200 } }),
  );
}
