import { getEntryProgram } from "@/lib/entry/catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id || id.length > 300 || /[\x00-\x1f]/.test(id)) return Response.json({ error: "공고를 확인해 주세요." }, { status: 400 });
  try { return Response.json({ program: await getEntryProgram(id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "공고를 불러오지 못했어요." }, { status: 503 }); }
}
