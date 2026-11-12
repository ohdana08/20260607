import { parseEntryConditions } from "@/lib/entry/conditions";
import { getEntryResults } from "@/lib/entry/catalog";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 2048) return Response.json({ error: "입력 크기를 확인해 주세요." }, { status: 413 });
    const body = await request.text();
    if (body.length > 2048) return Response.json({ error: "입력 크기를 확인해 주세요." }, { status: 413 });
    let value: unknown;
    try { value = JSON.parse(body); } catch { return Response.json({ error: "조건을 다시 선택해 주세요." }, { status: 400 }); }
    const conditions = parseEntryConditions(value);
    if (!conditions) return Response.json({ error: "네 가지 조건을 선택해 주세요." }, { status: 400 });
    return Response.json(await getEntryResults(conditions), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "공고를 불러오지 못했어요. 잠시 후 다시 확인해 주세요." }, { status: 503 });
  }
}
