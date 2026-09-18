// 사전 심사 한 번을 추가하는 대신 내부 초안 생성 뒤 근거 충돌·필수 공백을 의무 점검한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "작성 준비도는 새 근거 확인·최종 심사 흐름으로 통합됐어요. 화면을 새로고침해 주세요." },
    { status: 410 },
  );
}
