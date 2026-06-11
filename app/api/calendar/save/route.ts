import { saveProgram, type SavedProgram } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { leadId, program } = (body ?? {}) as {
    leadId?: unknown;
    program?: Partial<SavedProgram>;
  };
  if (typeof leadId !== "string" || !leadId || !program?.id || !program?.title) {
    return Response.json({ error: "정보가 부족해요." }, { status: 400 });
  }

  const ok = await saveProgram(leadId, {
    id: String(program.id),
    title: String(program.title),
    applyEnd: program.applyEnd ?? null,
    url: program.url ?? "",
    supportField: program.supportField ?? "",
    region: program.region ?? "",
  });
  if (!ok) return Response.json({ error: "회원 정보를 찾지 못했어요. 다시 가입해 주세요." }, { status: 404 });
  return Response.json({ ok: true });
}
