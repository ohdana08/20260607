// GA4 측정 헬퍼 — 모든 핵심 퍼널 이벤트를 한 곳에서 발화한다.
// 측정 ID는 공개돼도 되는 값이므로 NEXT_PUBLIC_* 로 둔다. (비밀 아님)
// GTM이 깔려 있으면 dataLayer로, GA4(gtag)가 직접 깔려 있으면 gtag로 보낸다.
// 둘 다 없으면(로컬 등) 조용히 무시한다.

export type GaEvent =
  // 앞단(이메일 캡처) 퍼널
  | "view_landing" // 랜딩 진입
  | "submit_email" // 이메일 캡처 완료
  | "marketing_consent" // 마케팅 수신 동의
  | "download_template" // 무료 표준 사업계획서 양식 다운로드
  | "report_sent" // 진단 보고서 이메일 발송 완료
  | "start_diagnosis" // 7단계 자가진단 시작
  | "view_diagnosis_result" // 진단 결과 화면(맛보기) 도달
  | "view_diagnosis_report" // (구) 진단 리포트 도달 — 호환 유지
  | "click_pay" // 49,900원 버튼 클릭
  | "complete_payment" // 결제 완료 (// TODO: PG연동 후)
  | "complete_draft" // 유료 초안 생성 완료
  | "review_prompt_shown" // 후기 팝업 노출
  | "review_submitted" // 후기 작성 완료
  | "review_public_consent"; // 후기 공개 동의

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
