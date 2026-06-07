import { isValidCode } from "@/lib/plan/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const code = (body as { code?: unknown })?.code;
  return Response.json({ ok: isValidCode(code) });
}
