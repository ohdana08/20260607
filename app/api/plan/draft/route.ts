// 구형 목차별 Opus 호출은 주문당 호출 수·비용을 예측할 수 없어 폐쇄했다.
// 새 클라이언트는 근거 → 전략 → /draft-batch(최대 3회) 흐름을 사용한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "작성 방식이 개선됐어요. 화면을 새로고침한 뒤 근거 확인부터 다시 시작해 주세요." },
    { status: 410 },
  );
}
