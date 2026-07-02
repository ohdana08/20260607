import { checkCodeForProgram } from "@/lib/plan/access";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 코드 무차별 대입(결제 우회) 방지 — 코드 검증보다 먼저 제한(점검표 문제 3)
  const rl = await checkRateLimit(req, "verify");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const { code, programId } = (body ?? {}) as { code?: unknown; programId?: unknown };
  const res = await checkCodeForProgram(code, programId);
  return Response.json({ ok: res.ok, reason: res.reason });
}
