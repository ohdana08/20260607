// 서비스 잠금(리뉴얼/Coming Soon) 스위치.
// true  → 모든 AI 호출(=비용) 차단 + 화면에 "리뉴얼 중" 표시
// false → 정상 운영
// 다시 열 때는 이 값을 false 로 바꾸고 배포하면 됩니다.
// (환경변수 MAINTENANCE_MODE=off 를 넣으면 코드 수정 없이도 즉시 열 수 있어요.)
export const MAINTENANCE: boolean = process.env.MAINTENANCE_MODE === "off" ? false : true;

// AI/비용이 드는 API 라우트 맨 앞에서 호출 — 잠금 상태면 503으로 즉시 차단(LLM 호출 없음).
export function maintenanceGate(): Response | null {
  if (!MAINTENANCE) return null;
  return Response.json(
    { error: "지금은 더 좋은 모습으로 준비 중이에요. 곧 다시 열어드릴게요! 🙏", maintenance: true },
    { status: 503 },
  );
}
