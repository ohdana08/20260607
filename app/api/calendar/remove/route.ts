import { removeProgram } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { leadId, programId } = (body ?? {}) as { leadId?: unknown; programId?: unknown };
  if (typeof leadId !== "string" || typeof programId !== "string") {
    return Response.json({ error: "정보가 부족해요." }, { status: 400 });
  }
  await removeProgram(leadId, programId);
  return Response.json({ ok: true });
}
