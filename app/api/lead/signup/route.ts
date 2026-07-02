import { createLead } from "@/lib/leads";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [회원가입 리드] Redis(캘린더 기능용) + Supabase leads(CRM 통합, bcc-admin 노출) 이중 저장.
// lead/email 라우트와 동일한 leads 테이블 사용 — 리드가 두 군데로 쪼개지지 않게 통합(점검표 문제 1).
const DEFAULT_SOURCE = "threads_chatbot";

// 클라이언트가 보낸 source(UTM 기반)를 정제. 없거나 비면 기본값.
function cleanSource(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_SOURCE;
  const s = raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);
  return s || DEFAULT_SOURCE;
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { name, contact, source, consent } = (body ?? {}) as {
    name?: unknown;
    contact?: unknown;
    source?: unknown;
    consent?: unknown;
  };
  if (typeof name !== "string" || !name.trim() || typeof contact !== "string" || !contact.trim()) {
    return Response.json({ error: "이름과 연락처(이메일 또는 전화)를 입력해 주세요." }, { status: 400 });
  }
  if (!consent) {
    return Response.json(
      { error: "개인정보 수집·이용 동의가 필요해요." },
      { status: 400 },
    );
  }

  const lead = await createLead(name, contact);
  if (!lead) {
    return Response.json({ error: "지금은 저장이 어려워요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }

  // Supabase leads 에도 insert (bcc-admin 대시보드 노출용).
  // 실패해도 Redis 저장은 이미 성공했으므로 가입 자체는 막지 않는다(리드 유실 방지, 로그로 추적).
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("leads").insert({
      name: name.trim(),
      contact: contact.trim(),
      request_type: "general",
      source: cleanSource(source),
      message: "진단 챗봇 회원가입(캘린더 저장)",
      consent: true,
      consent_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[lead/signup] supabase insert 실패 (Redis에는 저장됨):", err);
  }

  return Response.json({ lead });
}
