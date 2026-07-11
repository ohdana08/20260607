import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [합격 가능성 진단] 체크항목→평가항목 매핑표 조회 (읽기 전용).
// 원본은 Supabase evidence_map — bcc-admin 에서 수정한다 (하드코딩 금지).
// 민감정보 없음(공개돼도 무방한 매핑표)이라 인증 없이 제공, 5분 CDN 캐시.
export async function GET() {
  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("evidence_map")
      .select("item, market, growth, feasibility, capability")
      .order("sort_order", { ascending: true })
      .order("item", { ascending: true });
    if (error) throw new Error(error.message);
    return Response.json(
      { rows: data ?? [] },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("[evidence-map] 조회 실패:", err);
    return Response.json(
      { error: "진단 항목을 불러오지 못했어요. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  }
}
