// GA4 측정 헬퍼 — 모든 핵심 퍼널 이벤트를 한 곳에서 발화한다.
// 측정 ID는 공개돼도 되는 값이므로 NEXT_PUBLIC_* 로 둔다. (비밀 아님)
// GTM이 깔려 있으면 dataLayer로, GA4(gtag)가 직접 깔려 있으면 gtag로 보낸다.
// 둘 다 없으면(로컬 등) 조용히 무시한다.

export type GaEvent =
  // 앞단(이메일 캡처) 퍼널
  | "view_landing" // 랜딩 진입
  | "submit_email" // 이메일 캡처 완료
  | "marketing_consent" // 마케팅 수신 동의
  | "open_official_link" // K-Startup 공식 사업공고·양식 바로가기 클릭
  | "report_sent" // 진단 보고서 이메일 발송 완료
  // 단계별 이탈 측정(v3) — 어느 단계에서 빠지는지 GA4에서 보기 위함
  | "chat_started" // 사용자가 첫 답변을 입력(인테이크 시작)
  | "validation_answered" // 검증 질문까지 마쳐 추천 준비 완료(1막+1.5막 통과)
  | "recommendation_shown" // 공고 추천이 화면에 표시됨
  | "recommendation_empty" // 추천 0건 발생 (근접 공고 + 알림 신청 유도 노출)
  | "plan_writing_started" // '사업계획서 쓰기'를 눌러 작성 단계 진입
  | "start_diagnosis" // 7단계 자가진단 시작
  | "view_diagnosis_result" // 진단 결과 화면(맛보기) 도달
  | "view_diagnosis_report" // (구) 진단 리포트 도달 — 호환 유지
  | "click_pay" // 유료 초안 버튼 클릭 (price 파라미터에 당시 판매가 — 2026-07-11부터 39,900원)
  | "complete_payment" // 결제 완료 (// TODO: PG연동 후)
  | "complete_draft" // 유료 초안 생성 완료
  | "review_prompt_shown" // 후기 팝업 노출
  | "review_submitted" // 후기 작성 완료
  | "review_public_consent" // 후기 공개 동의
  // 유료 전환 파이프(2026-07-09 ③ 결정, G-5TN5XW0T2J 속성에서 측정)
  | "sign_up" // 진입 회원가입 완료 (가입 전환율)
  | "groble_click" // 그로블 결제 링크 버튼 클릭
  | "order_verified" // 주문번호 인증 완료 (is_paid 전환)
  // 합격 가능성 진단(2026-07-10 확정 설계)
  | "evidence_check" // 실적 체크 제출 — items(콤마 문자열)·count. 체크 조합이 곧 시장 데이터
  | "no_evidence_view" // 실적 없는(pre) 전용 화면 노출 — 재료 없는 유입 비율 측정
  // 무료→유료 전환 구조 개선(2026-07-11 디자인수정) — 단계별 이탈 측정
  | "scope_intro_view" // 진입 시 무료·유료 범위 안내 화면 노출
  | "diagnosis_start" // 무료·유료 안내에서 '무료 진단 시작하기' 클릭
  | "draft_preview_click" // 무료 결과에서 '초안 목차 보기' 클릭
  | "draft_preview_view" // 초안 목차 미리보기 화면 도달
  | "checkout_start" // 미리보기에서 결제 화면 진입 (click_pay와 함께 발화)
  // 완성 키트(2026-07-12) — 초안 하단 블록
  | "prompt_copy_click" // ChatGPT/Gemini 완성 프롬프트 복사
  | "consult_cta_click" // 사업계획서 컨설팅 문의(카톡채널) 클릭
  | "repurchase_cta_click" // 초안 완성 후 "추가 이용권 결제" CTA 클릭 (2026-07-13 소진 정책)
  | "repurchase_verified" // 소진 후 새 주문번호로 이용권 갱신 성공 (2026-07-14, QA 제외)
  // 랜딩 리뉴얼(2026-07-14) — /landing 전용 클릭 이벤트
  | "cta_free_diagnosis" // "무료 진단 시작" 계열 CTA 클릭 (location 파라미터로 위치 구분)
  | "cta_view_demo" // "가상 결과 예시 보기" CTA 클릭
  | "cta_paid_checkout" // 가격 카드 "DOCX 받기" 결제 CTA 클릭
  | "demo_tab_view" // 랜딩 데모 탭 전환(초기창업자/예비창업자/기관납품형)
  | "faq_open"; // 랜딩 FAQ 항목 펼침

type GtagWindow = Window & {
  dataLayer?: Record<string, unknown>[];
  gtag?: (...args: unknown[]) => void;
};

export function track(event: GaEvent, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const w = window as GtagWindow;
  try {
    // GTM 경유 (권장) — GTM 안에서 GA4 이벤트로 전달하도록 트리거 구성
    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event, ...params });
    }
    // gtag(GA4)가 직접 있으면 함께 발화 (GTM 미구성 시 안전망)
    if (typeof w.gtag === "function") {
      w.gtag("event", event, params);
    }
  } catch {
    /* 측정 실패는 기능에 영향 주지 않음 */
  }
}
