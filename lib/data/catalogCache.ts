import { Redis } from "@upstash/redis";
import type { Program } from "@/lib/match/types";
import { SnapshotCache } from "@/lib/scale/snapshotCache";
import { RedisSnapshotStore } from "@/lib/scale/redisSnapshotStore";
import { getOpenPrograms } from "@/lib/supabase/programs";

let cache: SnapshotCache<Program[]> | null = null;
// Roll out explicitly after staging: only public catalog rows, never sessions,
// entitlements or user-specific recommendation results, enter this shared cache.
export async function getCatalogPrograms(): Promise<Program[]> {
  if (process.env.PROGRAM_CACHE_ENABLED !== "on") return getOpenPrograms();
  if (!cache) {
    const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("catalog cache not configured");
    const redis = new Redis({ url, token, retry: { retries: 0 }, signal: () => AbortSignal.timeout(750) });
    cache = new SnapshotCache(new RedisSnapshotStore(redis, "gp:{catalog-v1}:open"), (signal) => getOpenPrograms(3000, signal));
  }
  return cache.get();
}
