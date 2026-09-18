import { Redis } from "@upstash/redis";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/plan/paidAccess";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { reservePrestage } from "@/lib/leads/prestageReservation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [합격 가능성 진단 분기] 실적 없는(pre) 유입을 leads 에 stage='pre' 로 기록.
// 유료 CTA를 보지 않은 '실적 만들기 전 단계' 리드 — 교육·멘토링·바우처 안내 대상.
function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token, retry: { retries: 0 }, signal: () => AbortSignal.timeout(750) });
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter, rl.unavailable);

  const user = await getAuthedUser(req);
  if (!user) return Response.json({ ok: false, error: "로그인이 필요해요." }, { status: 401 });

  let reservation: Awaited<ReturnType<typeof reservePrestage>>;
  try {
    const r = getRedis();
    if (!r) throw new Error("prestage storage unavailable");
    reservation = await reservePrestage(r, user.id);
  } catch {
    console.error(JSON.stringify({ component: "lead_prestage", event: "reservation_unavailable" }));
    return Response.json({ ok: false }, { status: 503, headers: { "Retry-After": "5" } });
  }
  if (reservation.state === "completed") return Response.json({ ok: true, dup: true });
  if (reservation.state === "busy") return Response.json({ ok: false }, { status: 503, headers: { "Retry-After": "5" } });

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
    const { error } = await db.from("leads").insert({ ...row, stage: "pre" }).abortSignal(AbortSignal.timeout(10_000));
    if (error) {
      // stage 컬럼 미생성(03-evidence-map.sql 미실행) 대비 — 컬럼 없이라도 리드는 남긴다
      if (!["42703", "PGRST204"].includes(error.code) || !/stage/i.test(error.message)) throw error;
      const retry = await db.from("leads").insert(row).abortSignal(AbortSignal.timeout(10_000));
      if (retry.error) throw new Error(retry.error.message);
      console.warn(JSON.stringify({ component: "lead_prestage", event: "stage_column_missing" }));
    }
  } catch {
    await reservation.release().catch(() => {
      console.error(JSON.stringify({ component: "lead_prestage", event: "reservation_release_failed" }));
    });
    console.error(JSON.stringify({ component: "lead_prestage", event: "insert_failed" }));
    return Response.json({ ok: false }, { status: 503, headers: { "Retry-After": "5" } });
  }
  // DB success is authoritative. If Redis finalization fails, acknowledge the
  // persisted row and expose a retryable deduplication gap rather than lose it.
  if (!await reservation.complete().catch(() => false)) {
    console.warn(JSON.stringify({ component: "lead_prestage", event: "dedup_finalize_failed" }));
    return Response.json({ ok: true, deduplicationPending: true });
  }
  return Response.json({ ok: true });
}
