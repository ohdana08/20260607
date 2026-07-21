// 그로블 결제창 링크 (39,900원 사업계획서 초안 이용권).
// 비어 있으면 결제 버튼 대신 안내문이 뜬다.
// 2026-07-11 신상품 전환: 구 상품 products/9CYRhi(49,900원, 판매중단) → 새 상품 payment/RJczGx(39,900원).
export const GROBLE_CHECKOUT_URL = "https://www.groble.im/payment/RJczGx";
// 그로블 웹훅 payload의 data.object.content.id 값 — 재구매 verify가 이 상품만 인정한다(2026-07-14).
export const GROBLE_PRODUCT_ID = "RJczGx";

// 유료 초안 판매가 — 화면 표기용(2026-07-11 그로블 신상품 가격). 숫자는 GA4 price 파라미터용.
export const PRICE_LABEL = "39,900원";
export const PRICE_KRW = 39900;

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
