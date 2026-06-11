import { listSaved } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const leadId = new URL(req.url).searchParams.get("leadId") ?? "";
  if (!leadId) return Response.json({ saved: [] });
  const saved = await listSaved(leadId);
  return Response.json({ saved });
}
