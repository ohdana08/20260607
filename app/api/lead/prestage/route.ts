import { Redis } from "@upstash/redis";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/plan/paidAccess";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [합격 가능성 진단 분기] 실적 없는(pre) 유입을 leads 에 stage='pre' 로 기록.
// 유료 CTA를 보지 않은 '실적 만들기 전 단계' 리드 — 교육·멘토링·바우처 안내 대상.
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const user = await getAuthedUser(req);
  if (!user) return Response.json({ ok: false, error: "로그인이 필요해요." }, { status: 401 });

  // 같은 계정의 중복 기록 방지 (재진단해도 leads 행은 1개만)
  const r = getRedis();
  if (r) {
    const first = await r.set(`gp:prestage:${user.id}`, Date.now(), { nx: true });
    if (first === null) return Response.json({ ok: true, dup: true });
  }

  const row = {
    name: `[진단-pre] ${user.email || user.id}`,
    contact: user.email || user.id,
    request_type: "general",
    source: "diagnosis_pre",
    message: "합격 가능성 진단 — 실적 없음(pre): 실적 만드는 공고(교육·멘토링·바우처) 안내 노출",
    consent: true,
    consent_at: new Date().toISOString(),
  };

  try {
    const db = createAdminClient();
    const { error } = await db.from("leads").insert({ ...row, stage: "pre" });
    if (error) {
      // stage 컬럼 미생성(03-evidence-map.sql 미실행) 대비 — 컬럼 없이라도 리드는 남긴다
      const retry = await db.from("leads").insert(row);
      if (retry.error) throw new Error(retry.error.message);
      console.warn("[lead/prestage] stage 컬럼 없이 저장됨 — supabase/03-evidence-map.sql 실행 필요");
    }
  } catch (err) {
    console.error("[lead/prestage] leads 저장 실패:", err);
    return Response.json({ ok: false }, { status: 503 });
  }
  return Response.json({ ok: true });
}
