export const PRESENTATION_MAX_REVISIONS = 2;
export const PRESENTATION_REVISION_WINDOW_DAYS = 30;
export const PRESENTATION_AI_HARD_CAP_KRW = 3000;

export const PRESENTATION_OUTCOME_NOTICE =
  "발표자료와 예상 질의응답은 준비를 돕는 결과물이며 서류·발표평가 통과 또는 선정을 보장하지 않습니다.";

export const PRESENTATION_REVISION_NOTICE =
  "발표자료 상품은 최초 PPTX/PDF 제공일로부터 30일 이내 최대 2회의 묶음 AI 수정이 포함됩니다. 수정은 같은 지원사업·사업아이템·발표 조건에 한하며, 다른 공고·아이템·전면 재작성은 별도 주문입니다.";

export function configuredPresentationAiHardCapKrw(): number {
  const parsed = Number(process.env.PRESENTATION_AI_HARD_CAP_KRW);
  if (!Number.isFinite(parsed) || parsed <= 0) return PRESENTATION_AI_HARD_CAP_KRW;
  return Math.min(PRESENTATION_AI_HARD_CAP_KRW, Math.round(parsed));
}
