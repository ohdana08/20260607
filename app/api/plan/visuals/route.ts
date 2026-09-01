// 근거 없는 독립 도식 생성을 막기 위해 전략팩 안의 evidence id가 있는 도식만 생성한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "도식은 근거 확인과 전략 설계 단계에서 자동 선택됩니다. 화면을 새로고침해 주세요." },
    { status: 410 },
  );
}
