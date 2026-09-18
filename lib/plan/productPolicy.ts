export const PLAN_MAX_REVISIONS = 3;
export const PLAN_REVISION_WINDOW_DAYS = 30;

// 주문 1건의 AI 원가가 이 값을 넘기기 전에 다음 유료 호출을 차단한다.
// 3회의 계약상 수정권까지 정상적으로 제공할 수 있도록 일상적인 예상 원가가 아니라
// 비정상 입력·반복 호출을 막는 최후 방어선으로 둔다. 운영 실측에 따라 환경변수로 더
// 낮출 수 있지만 코드 기본값보다 높일 수는 없다.
export const PLAN_AI_HARD_CAP_KRW = 4500;

export const PLAN_OUTCOME_NOTICE =
  "선정 여부는 심사 경쟁률, 평가위원의 판단, 기관 예산과 정책 등 서비스가 통제할 수 없는 요소에 따라 달라지며 선정 결과를 보장하지 않습니다.";

export const PLAN_REVISION_NOTICE =
  "본 상품은 최초 최종본 1회와 최초 최종본 제공일로부터 30일 이내 최대 3회의 AI 수정이 포함됩니다. 수정은 동일 공고·동일 사업아이템·동일 양식에 한하며, 여러 요청을 한 번에 제출하는 묶음 수정 방식입니다. 새로운 공고, 사업아이템 변경 또는 전면 재작성은 별도 주문에 해당합니다.";

export function configuredPlanAiHardCapKrw(): number {
  const parsed = Number(process.env.PLAN_AI_HARD_CAP_KRW);
  if (!Number.isFinite(parsed) || parsed <= 0) return PLAN_AI_HARD_CAP_KRW;
  return Math.min(PLAN_AI_HARD_CAP_KRW, Math.round(parsed));
}
