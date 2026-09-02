// 그로블 결제창 링크 (29,900원 사업계획서 초안 이용권).
// 비어 있으면 결제 버튼 대신 안내문이 뜬다.
// 2026-08-04 가격 조정: payment/RJczGx 상품을 29,900원으로 운영.
export const GROBLE_CHECKOUT_URL = "https://www.groble.im/payment/RJczGx";
// 그로블 웹훅 payload의 data.object.content.id 값 — 재구매 verify가 이 상품만 인정한다(2026-07-14).
export const GROBLE_PRODUCT_ID = "RJczGx";

// 발표자료 추가 상품과 Word+발표자료 묶음 상품은 그로블에서 상품을 만든 뒤
// Vercel 환경변수로 연결한다. 값이 없으면 결제 버튼과 주문 인증을 모두 닫아
// 존재하지 않는 상품 또는 잘못된 결제로 권한이 열리지 않게 한다.
export const GROBLE_PRESENTATION_CHECKOUT_URL =
  process.env.NEXT_PUBLIC_GROBLE_PRESENTATION_CHECKOUT_URL?.trim() ?? "";
export const GROBLE_PRESENTATION_PRODUCT_ID =
  process.env.GROBLE_PRESENTATION_PRODUCT_ID?.trim() ?? "";
export const GROBLE_BUNDLE_CHECKOUT_URL =
  process.env.NEXT_PUBLIC_GROBLE_BUNDLE_CHECKOUT_URL?.trim() ?? "";
export const GROBLE_BUNDLE_PRODUCT_ID = process.env.GROBLE_BUNDLE_PRODUCT_ID?.trim() ?? "";

// 유료 초안 판매가 — 화면 표기와 GA4 price 파라미터의 단일 출처.
export const PRICE_LABEL = "29,900원";
export const PRICE_KRW = 29900;

// 발표자료는 사업계획서 Word에 포함되지 않는 별도 후속 상품이다.
export const PRESENTATION_PRICE_LABEL = "19,900원";
export const PRESENTATION_PRICE_KRW = 19900;
export const BUNDLE_PRICE_LABEL = "44,900원";
export const BUNDLE_PRICE_KRW = 44900;

export function isPlanProductId(productId?: string): boolean {
  return Boolean(productId && (productId === GROBLE_PRODUCT_ID || productId === GROBLE_BUNDLE_PRODUCT_ID));
}

export function isPresentationProductId(productId?: string): boolean {
  return Boolean(
    productId &&
      (productId === GROBLE_PRESENTATION_PRODUCT_ID || productId === GROBLE_BUNDLE_PRODUCT_ID),
  );
}

export function isBundleProductId(productId?: string): boolean {
  return Boolean(productId && productId === GROBLE_BUNDLE_PRODUCT_ID);
}

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
