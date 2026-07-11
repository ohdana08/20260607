import { SIGNUP_UPSTREAM } from "@/lib/auth/config";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 회원가입 프록시 — bcc-homepage 의 기존 /api/signup 을 서버 대 서버로 호출한다.
// (브라우저에서 직접 부르면 CORS 허용 목록에 gov-plan 도메인이 없어 막히므로 프록시가 필요)
export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { name, phone, email, password, privacyConsent, marketingConsent } = (body ?? {}) as {
    name?: unknown;
    phone?: unknown;
    email?: unknown;
    password?: unknown;
    privacyConsent?: unknown;
    marketingConsent?: unknown;
  };

  try {
    const upstream = await fetch(SIGNUP_UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        phone,
        email,
        password,
        privacyConsent: privacyConsent === true,
        marketingConsent: marketingConsent === true,
        consentSource: "govplan", // 어디서 가입했는지 profiles 에 남긴다
      }),
    });
    const data = await upstream.json().catch(() => ({}));
    return Response.json(data, { status: upstream.status });
  } catch {
    return Response.json(
      { error: "가입 서버와 연결하지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}
