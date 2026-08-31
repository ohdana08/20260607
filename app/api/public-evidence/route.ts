import {
  getPublicEvidenceItems,
  rankPublicEvidenceItems,
  type PublicEvidenceStage,
} from "@/lib/data/publicEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawStage = url.searchParams.get("stage");
  const stage: PublicEvidenceStage | undefined =
    rawStage === "step5" || rawStage === "step6" ? rawStage : undefined;
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  const items = query
    ? rankPublicEvidenceItems(query, stage ?? "step6", 6)
    : getPublicEvidenceItems(stage);

  return Response.json({
    checkedAt: "2026-08-31",
    notice:
      "공식 출처 후보입니다. 원문·기준연도·이용조건을 확인한 뒤에만 사업계획서에 인용해야 합니다.",
    items,
  });
}
