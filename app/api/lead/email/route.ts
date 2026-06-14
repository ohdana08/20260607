import { isEmail, saveEmailCapture } from "@/lib/diagnosis";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [이메일 캡처 게이트] 진단 시작 전 이메일 + 동의 저장 (구글시트/GAS).
// 비밀번호는 받지 않는다. 필수 동의 없으면 거부.
export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "review");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { email, privacyConsent, marketingConsent } = (body ?? {}) as {
    email?: unknown;
    privacyConsent?: unknown;
    marketingConsent?: unknown;
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

  const ok = await saveEmailCapture({
    email,
    privacyConsent: true,
    marketingConsent: Boolean(marketingConsent),
  });

  if (!ok) {
    return Response.json(
      { ok: false, error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
  return Response.json({ ok: true });
}
