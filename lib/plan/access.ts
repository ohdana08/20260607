import { Redis } from "@upstash/redis";

// 이용권 코드 검증 (가벼운 검증형 결제).
// 유효한 코드는 Vercel 환경변수 ACCESS_CODES 에 콤마로 구분해 넣는다.
export function isValidCode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  const entered = code.trim().toUpperCase();
  if (!entered) return false;
  const valid = (process.env.ACCESS_CODES ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  return valid.includes(entered);
}

// ── 코드 ↔ 지원사업 1:1 바인딩 (Upstash) ─────────────────────────────────
// 코드는 "처음 사용한 지원사업 하나"에만 묶인다. 그 사업계획서는 계속 수정 가능하지만,
// 다른 지원사업을 쓰려면 새 코드(=재결제)가 필요하다.
let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

export type CodeCheck = { ok: boolean; reason?: "invalid" | "used_elsewhere" };

export async function checkCodeForProgram(
  code: unknown,
  programId: unknown,
): Promise<CodeCheck> {
  if (!isValidCode(code)) return { ok: false, reason: "invalid" };
  const r = getRedis();
  // Redis 없거나 사업 식별자 없으면 바인딩 생략(유효성만으로 통과 — 안전 폴백)
  if (!r || typeof programId !== "string" || !programId) return { ok: true };

  const key = `codebind:${(code as string).trim().toUpperCase()}`;
  const bound = await r.get<string>(key);
  if (bound == null) {
    // 첫 사용 → 이 사업에 묶기 (동시요청 대비 NX)
    const set = await r.set(key, programId, { nx: true });
    if (set === null) {
      const now = await r.get<string>(key);
      return now === programId ? { ok: true } : { ok: false, reason: "used_elsewhere" };
    }
    return { ok: true };
  }
  return bound === programId ? { ok: true } : { ok: false, reason: "used_elsewhere" };
}
