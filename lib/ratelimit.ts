import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// 사용량 제한(IP당). Upstash 환경변수가 없으면 제한 없이 통과(개발/초기).
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN 가 설정되면 자동 활성화.
type Kind =
  | "chat"
  | "match"
  | "fitcheck"
  | "planChat"
  | "planDraft"
  | "planReview"
  | "diagnose"
  | "campaignDraft"
  | "review"
  | "verify";

// 무료(비용 노출) 엔드포인트는 빡빡하게, 유료(코드 보유)는 느슨하게.
const RULES: Record<Kind, { limit: number; window: `${number} m` | `${number} h` }> = {
  chat: { limit: 40, window: "1 h" }, // 대화 메시지
  match: { limit: 15, window: "1 h" }, // 추천(LLM 호출)
  fitcheck: { limit: 30, window: "1 h" }, // 무료 적합도 확인(문서 읽기)
  planChat: { limit: 80, window: "1 h" }, // 유료 2차 대화
  planDraft: { limit: 50, window: "1 h" }, // 유료 초안(항목 5개=1회)
  planReview: { limit: 30, window: "1 h" }, // 유료 작성 준비도·모의심사·수정
  diagnose: { limit: 40, window: "1 h" }, // 무료 7단계 자가진단 + 리포트
  campaignDraft: { limit: 5, window: "1 h" }, // 마감형 무료 전용 지원서 초안
  review: { limit: 10, window: "1 h" }, // 후기 작성(스팸 방지)
  verify: { limit: 10, window: "1 h" }, // 이용권 코드 확인(무차별 대입 방지)
};

let redis: Redis | null = null;
const limiters = new Map<Kind, Ratelimit>();

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (!redis) redis = new Redis({ url, token });
  return redis;
}

function getLimiter(kind: Kind): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  if (!limiters.has(kind)) {
    const rule = RULES[kind];
    limiters.set(
      kind,
      new Ratelimit({
        redis: r,
        limiter: Ratelimit.slidingWindow(rule.limit, rule.window),
        prefix: `rl:${kind}`,
        analytics: false,
      }),
    );
  }
  return limiters.get(kind)!;
}

function ipOf(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
}

export async function checkRateLimit(
  req: Request,
  kind: Kind,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const limiter = getLimiter(kind);
  if (!limiter) return { ok: true }; // 미설정 → 통과
  try {
    const res = await limiter.limit(ipOf(req));
    if (res.success) return { ok: true };
    return { ok: false, retryAfter: Math.max(1, Math.ceil((res.reset - Date.now()) / 1000)) };
  } catch (err) {
    console.error("[ratelimit] error, allowing request", err);
    return { ok: true }; // 장애 시 막지 않음
  }
}

export function tooManyRequests(retryAfter?: number): Response {
  return Response.json(
    { error: "잠시 너무 많이 사용했어요. 잠깐 쉬었다가 다시 시도해 주세요 🙏" },
    {
      status: 429,
      headers: retryAfter ? { "Retry-After": String(retryAfter) } : {},
    },
  );
}
