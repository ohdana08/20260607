import { createLead } from "@/lib/leads";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { name, contact } = (body ?? {}) as { name?: unknown; contact?: unknown };
  if (typeof name !== "string" || !name.trim() || typeof contact !== "string" || !contact.trim()) {
    return Response.json({ error: "이름과 연락처(이메일 또는 전화)를 입력해 주세요." }, { status: 400 });
  }

  const lead = await createLead(name, contact);
  if (!lead) {
    return Response.json({ error: "지금은 저장이 어려워요. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
  return Response.json({ lead });
}
