import { fetchOpenPrograms } from "@/lib/data/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// [합격 가능성 진단 분기 — pre 전용 화면] 실적 없이 신청 가능한 공고.
// 실적을 '만드는' 유형(교육·멘토링·바우처·컨설팅)만 규칙 필터 — LLM 호출 없음.
const PRE_RE = /교육|멘토링|바우처|컨설팅|아카데미|사관학교|스쿨|캠프|역량\s*강화|특강/;

function byDeadline(a: { applyEnd: string | null }, b: { applyEnd: string | null }): number {
  return (a.applyEnd ?? "9999-99-99").localeCompare(b.applyEnd ?? "9999-99-99");
}

export async function GET() {
  try {
    const { programs, usingSample } = await fetchOpenPrograms();
    const list = programs
      .filter((p) => PRE_RE.test(`${p.supportField} ${p.title}`))
      .sort(byDeadline)
      .slice(0, 8);
    return Response.json({ programs: list, usingSample });
  } catch (err) {
    console.error("[programs/pre] 조회 실패:", err);
    return Response.json({ programs: [], usingSample: false });
  }
}
