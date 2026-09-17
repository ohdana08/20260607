import { randomUUID } from "node:crypto";

interface PrestageStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: string, options: { nx: true; px: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

export const PRESTAGE_FINALIZE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;
export const PRESTAGE_RELEASE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])`;

type Reservation =
  | { state: "completed" }
  | { state: "busy" }
  | { state: "reserved"; complete(): Promise<boolean>; release(): Promise<void> };

// The marker is committed only after a successful DB insert. Token checks fence
// cleanup from an expired owner; a lease cannot make Redis + Postgres atomic.
export async function reservePrestage(store: PrestageStore, userId: string): Promise<Reservation> {
  const key = `gp:prestage:${userId}`;
  const token = `pending:${randomUUID()}`;
  if (await store.set(key, token, { nx: true, px: 30_000 }) !== "OK") {
    const marker = await store.get<unknown>(key);
    const completed = (typeof marker === "number" && Number.isFinite(marker)) ||
      (typeof marker === "string" && /^\d+$/.test(marker));
    return { state: completed ? "completed" : "busy" };
  }
  return {
    state: "reserved",
    async complete() {
      return await store.eval(PRESTAGE_FINALIZE, [key], [token, Date.now()]) === 1;
    },
    async release() { await store.eval(PRESTAGE_RELEASE, [key], [token]); },
  };
}
