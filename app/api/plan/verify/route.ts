import { checkCodeForProgram } from "@/lib/plan/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
