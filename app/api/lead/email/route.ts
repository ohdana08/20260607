import { isEmail, saveEmailCapture } from "@/lib/diagnosis";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [이메일 캡처 게이트] 진단 시작 전 이메일 + 동의 저장.
// 1순위: BCC CRM과 같은 Supabase의 leads 테이블 (홈페이지 폼 /api/lead 와 동일 테이블).
// 폴백: Supabase 실패 시에만 기존 GAS 구글시트 (리드 유실 방지).
// 비밀번호는 받지 않는다. 필수 동의 없으면 거부.
const DEFAULT_SOURCE = "threads_chatbot";

// 클라이언트가 보낸 source(UTM 기반)를 정제. 없거나 비면 기본값.
function cleanSource(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_SOURCE;
  const s = raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);
  return s || DEFAULT_SOURCE;
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "review");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { email, privacyConsent, marketingConsent, source } = (body ?? {}) as {
    email?: unknown;
    privacyConsent?: unknown;
    marketingConsent?: unknown;
    source?: unknown;
  };

  if (!isEmail(email)) {
    return Response.json({ ok: false, error: "이메일을 정확히 입력해 주세요." }, { status: 400 });
  }
  if (!privacyConsent) {
    return Response.json(
      { ok: false, error: "진단 보고서 발송을 위한 개인정보 수집·이용 동의가 필요해요." },
      { status: 400 },
    );
  }

  const contact = email.trim();
  const marketing = Boolean(marketingConsent);
  const name = contact.split("@")[0] || "챗봇 리드"; // 이메일 앞부분을 이름으로
  const leadSource = cleanSource(source); // UTM 기반(없으면 threads_chatbot)

  // 1순위: Supabase leads (CRM 통합 단일 소스)
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("leads").insert({
      name,
      contact,
      request_type: "general",
      source: leadSource,
      // 마케팅 동의 전용 컬럼이 없어 message에 함께 보존
      message: `진단 챗봇 이메일 게이트 · 마케팅수신: ${marketing ? "Y" : "N"}`,
      consent: true,
      consent_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return Response.json({ ok: true, store: "supabase" });
  } catch (err) {
    // 2순위(폴백): Supabase 장애/미설정 시에만 기존 GAS로 저장 → 리드 유실 방지
    console.error("[lead/email] supabase insert 실패, GAS 폴백:", err);
    const ok = await saveEmailCapture({
      email: contact,
      privacyConsent: true,
      marketingConsent: marketing,
    });
    if (!ok) {
      return Response.json(
        { ok: false, error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." },
        { status: 502 },
      );
    }
    return Response.json({ ok: true, store: "gas_fallback" });
  }
}
