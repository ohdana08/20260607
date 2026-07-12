import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import { buildPlanDocxBuffer, type PlanDocxChart, type PlanDocxSection } from "@/lib/plan/docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { code, programId, title, sections, charts } = (body ?? {}) as {
    code?: string;
    programId?: string;
    title?: string;
    sections?: PlanDocxSection[];
    charts?: PlanDocxChart[];
  };
  void programId;

  // 유료 관문(2026-07-09): 주문번호 인증(is_paid) 또는 마스터 코드
  const access = await checkDraftAccess(req, code);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  if (!Array.isArray(sections) || sections.length === 0) {
    return Response.json({ error: "내보낼 내용이 없어요." }, { status: 400 });
  }

  const buffer = await buildPlanDocxBuffer(title, sections, charts ?? []);

  const filename = encodeURIComponent(`${title || "사업계획서"}.docx`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="plan.docx"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
    },
  });
}
