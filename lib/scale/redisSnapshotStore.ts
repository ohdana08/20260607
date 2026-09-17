import type { Snapshot, SnapshotStore } from "./snapshotCache";

export interface SnapshotRedis {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: string, options: { nx: true; px: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}
export const PUBLISH_SNAPSHOT = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('PSETEX', KEYS[1], ARGV[3], ARGV[2])
redis.call('DEL', KEYS[2])
return 1`;
export const RELEASE_SNAPSHOT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export class RedisSnapshotStore<T> implements SnapshotStore<T> {
  constructor(private readonly redis: SnapshotRedis, private readonly key: string) {}
  async read() {
    const value = await this.redis.get<Snapshot<T>>(this.key);
    if (!value || !Number.isFinite(value.freshUntil) || !Number.isFinite(value.staleUntil) || value.staleUntil < value.freshUntil) return null;
    return value;
  }
  async acquire(token: string, leaseMs: number) {
    return (await this.redis.set(`${this.key}:lock`, token, { nx: true, px: leaseMs })) === "OK";
  }
  async publish(token: string, snapshot: Snapshot<T>, ttlMs: number) {
    return (await this.redis.eval(PUBLISH_SNAPSHOT, [this.key, `${this.key}:lock`], [token, JSON.stringify(snapshot), ttlMs])) === 1;
  }
  async release(token: string) { await this.redis.eval(RELEASE_SNAPSHOT, [`${this.key}:lock`], [token]); }
}
