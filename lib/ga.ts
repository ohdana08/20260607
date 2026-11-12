// G-5TN5XW0T2J는 홈페이지·블로그와 공유하는 기존 BCC 스트림이다.
// ddakfit 식별자와 hostname으로 분리하며 두 전송 경로를 동시에 사용하지 않는다.
import { captureUtm, getAttribution, readUtm } from "./utm";
import { GROBLE_CHECKOUT_URL, GROBLE_PRESENTATION_CHECKOUT_URL, GROBLE_BUNDLE_CHECKOUT_URL } from "./config";

function checkoutItemId(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["groble.im", "www.groble.im"].includes(url.hostname)) return "";
    return /^\/payment\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1] ?? "";
  } catch { return ""; }
}

// Public URLs are available in the client; server-only product env is not.
export const CHECKOUT_ITEM_IDS: Readonly<Record<"word" | "presentation" | "word_presentation_bundle", string>> = {
  word: checkoutItemId(GROBLE_CHECKOUT_URL),
  presentation: checkoutItemId(GROBLE_PRESENTATION_CHECKOUT_URL),
  word_presentation_bundle: checkoutItemId(GROBLE_BUNDLE_CHECKOUT_URL),
};

export type GaEvent =
  | "entry_conditions_submit"
  | "entry_results_view"
  | "push_optin"
  | "push_optout"
  | "pwa_install_prompt"
  | "pwa_install_complete"
  | "page_view"
  | "auth_gate_view"
  | "login_start"
  | "login"
  | "login_error"
  | "plan_session_start"
  | "paywall_view"
  | "begin_checkout" // 구 호출 호환: checkout_link_click로 교정. 결제창 내부 시작과 구분.
  | "checkout_link_click"
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
  | "click_pay" // 유료 초안 버튼 클릭 (price 파라미터는 lib/config.ts의 판매가 사용)
  | "pay_blocked" // 결제 버튼을 눌렀으나 제출유형 미확인·간단신청 판정으로 안내만 표시 (2026-11-08)
  | "complete_payment" // 구 호출 호환: plan_session_start로 교정, 결제 아님
  | "complete_draft" // 유료 초안 생성 완료
  | "review_prompt_shown" // 후기 팝업 노출
  | "review_submitted" // 후기 작성 완료
  | "review_public_consent" // 후기 공개 동의
  // 유료 전환 파이프 — 공유 BCC 스트림의 ddakfit 트래픽
  | "sign_up" // 구 호출 호환: login_start로 교정, 가입 성공 아님
  | "groble_click" // 그로블 결제 링크 버튼 클릭
  | "order_verified" // 주문번호 인증 완료 (is_paid 전환)
  // 합격 가능성 진단(2026-07-10 확정 설계)
  | "evidence_check" // 실적 체크 제출 — items(콤마 문자열)·count. 체크 조합이 곧 시장 데이터
  | "no_evidence_view" // 실적 없는(pre) 전용 화면 노출 — 재료 없는 유입 비율 측정
  // 무료→유료 전환 구조 개선(2026-07-11 디자인수정) — 단계별 이탈 측정
  | "scope_intro_view" // 진입 시 무료·유료 범위 안내 화면 노출
  | "diagnosis_start" // 무료·유료 안내에서 '무료 진단 시작하기' 클릭
  | "plain_flow_step_view" // 쉬운 말 찾기 흐름의 단계 도달(자유입력 내용은 전송하지 않음)
  | "plain_flow_answer" // 쉬운 말 선택지 응답(정해진 선택값·건너뛰기 여부만 전송)
  | "draft_preview_click" // 무료 결과에서 '초안 목차 보기' 클릭
  | "draft_preview_view" // 초안 목차 미리보기 화면 도달
  | "checkout_start" // 미리보기에서 결제 화면 진입 (click_pay와 함께 발화)
  // 완성 키트(2026-07-12) — 초안 하단 블록
  | "prompt_copy_click" // ChatGPT/Gemini 완성 프롬프트 복사
  | "consult_cta_click" // 사업계획서 컨설팅 문의(카톡채널) 클릭
  | "repurchase_cta_click" // 초안 완성 후 "추가 이용권 결제" CTA 클릭 (2026-07-13 소진 정책)
  | "repurchase_verified" // 소진 후 새 주문번호로 이용권 갱신 성공 (2026-07-14, QA 제외)
  // 발표자료 베타 — 최종 사업계획서 근거를 재사용하는 후속 퍼널
  | "presentation_interview_start" // 발표자료 티키타카 시작
  | "presentation_checkout_click" // 별도 발표자료 그로블 결제 진입
  | "presentation_order_verified" // 발표자료 단품/묶음 주문번호 인증 완료
  | "presentation_outline_generate" // 슬라이드 원고·대본 생성
  | "presentation_brief_download" // 검증 통과 발표 원고·데이터 부록 다운로드
  | "presentation_pptx_download" // 편집 가능한 발표자료 PPTX 다운로드
  | "presentation_pdf_download" // 제출·공유용 발표자료 PDF 다운로드
  // 랜딩 리뉴얼(2026-07-14) — /landing 전용 클릭 이벤트
  | "cta_free_diagnosis" // "무료 진단 시작" 계열 CTA 클릭 (location 파라미터로 위치 구분)
  | "cta_direct_program" // 이미 지원할 공고가 있는 사람의 바로 시작 CTA 클릭
  | "cta_view_finder" // "무료로 어떻게 찾아주는지 보기" 계열 CTA 클릭
  | "cta_view_demo" // "가상 결과 예시 보기" CTA 클릭
  | "cta_paid_checkout" // 가격 카드 "DOCX 받기" 결제 CTA 클릭
  | "demo_tab_view" // 랜딩 데모 탭 전환(초기창업자/예비창업자/기관납품형)
  | "faq_open" // 랜딩 FAQ 항목 펼침
  // 모두의창업 2차 전용 모드(2026-09-02)
  | "modoo_campaign_click" // 랜딩 상단 캠페인 안내 클릭
  | "view_modoo_2026_campaign" // 캠페인 페이지 진입
  | "modoo_draft_start" // 작성 초안 생성 시작
  | "modoo_material_upload" // 작성 근거 자료 읽기 완료
  | "modoo_draft_complete" // 작성 초안 생성 완료
  | "modoo_draft_error" // 작성 초안 생성 실패
  | "modoo_answer_copy" // 항목별 답변 복사
  | "modoo_draft_docx_download" // 작성 초안 Word 다운로드
  | "modoo_official_apply_click"; // 공식 온라인 지원서 이동

type GtagWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  ddakfitGaIds?: Set<string>;
  ddakfitAnalyticsIdentity?: "pending" | "guest" | "member" | "excluded";
};

export const BCC_GA_ID = "G-5TN5XW0T2J";
export function measurementIds(primary = process.env.NEXT_PUBLIC_GA_ID): string[] {
  const id = primary || BCC_GA_ID;
  return /^G-[A-Z0-9]+$/.test(id) ? [id] : [];
}

// In-memory only; store already-filtered snapshots, never caller-owned/raw params.
const pendingEvents: Array<{ event: GaEvent; params: Record<string, unknown> }> = [];
const PENDING_LIMIT = 20;
const PENDING_EVENTS = new Set<GaEvent>([
  "scope_intro_view", "plain_flow_step_view", "auth_gate_view", "chat_started",
  "diagnosis_start", "plain_flow_answer",
]);

function analyticsEnvironmentAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return false;
  if (process.env.NEXT_PUBLIC_VERCEL_ENV && process.env.NEXT_PUBLIC_VERCEL_ENV !== "production") return false;
  if (window.location.hostname !== "ddakfit.bccconsulting.kr") return false;
  if (window.location.pathname === "/operations" || window.location.pathname.startsWith("/operations/")) return false;
  if ((window as GtagWindow).ddakfitAnalyticsIdentity === "excluded") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (["qa", "admin", "code", "review", "localReview"].some(k => q.has(k))) {
      sessionStorage.setItem("gp_analytics_excluded", "1");
      return false;
    }
    return sessionStorage.getItem("gp_analytics_excluded") !== "1";
  } catch { return false; }
}

export function analyticsAllowed(): boolean {
  if (!analyticsEnvironmentAllowed()) return false;
  const identity = (window as GtagWindow).ddakfitAnalyticsIdentity;
  if (identity === "pending") return false;
  if (window.location.pathname === "/embed" || window.location.pathname.startsWith("/embed/")) {
    return identity === "member" || identity === "guest";
  }
  return true;
}

function notifyAnalyticsState(): void {
  try { window.dispatchEvent?.(new Event("ddakfit-analytics-state")); } catch { /* analytics must not block auth */ }
}

export function excludeAnalytics(): void {
  pendingEvents.length = 0;
  try { sessionStorage.setItem("gp_analytics_excluded", "1"); } catch { /* storage blocked */ }
  if (typeof window !== "undefined") {
    (window as GtagWindow).ddakfitAnalyticsIdentity = "excluded";
    notifyAnalyticsState();
  }
}

export function setAnalyticsIdentity(identity: "pending" | "guest" | "member" | "excluded"): void {
  if (typeof window === "undefined") return;
  if (identity === "excluded") { excludeAnalytics(); return; }
  const w = window as GtagWindow;
  if (w.ddakfitAnalyticsIdentity === "excluded") { pendingEvents.length = 0; return; }
  if (identity === "pending" && w.ddakfitAnalyticsIdentity !== "pending") pendingEvents.length = 0;
  w.ddakfitAnalyticsIdentity = identity;
  if (identity === "member" || identity === "guest") {
    // Drain before notification so a re-entrant render cannot replay twice.
    const queued = pendingEvents.splice(0);
    if (analyticsAllowed()) for (const entry of queued) emitEvent(entry.event, entry.params);
  }
  notifyAnalyticsState();
}

export function safePageLocation(): string {
  const url = new URL(window.location.pathname, window.location.origin);
  const utm = readUtm(new URLSearchParams(window.location.search));
  for (const [key, value] of Object.entries(utm)) url.searchParams.set(`utm_${key}`, value);
  return url.toString();
}

export function initializeAnalytics(): boolean {
  if (!analyticsAllowed()) return false;
  const ids = measurementIds();
  if (!ids.length) return false;
  const w = window as GtagWindow;
  w.dataLayer ??= [];
  // Keep Google's canonical command queue shape until gtag.js downloads.
  // eslint-disable-next-line prefer-rest-params
  w.gtag ??= function () { w.dataLayer!.push(arguments); };
  if (!w.ddakfitGaIds) {
    w.ddakfitGaIds = new Set();
    w.gtag("js", new Date());
  }
  for (const id of ids) {
    if (w.ddakfitGaIds.has(id)) continue;
    w.gtag("config", id, { send_page_view: false, page_location: safePageLocation(), page_referrer: "", page_title: "ddakfit", site_id: "ddakfit", app_id: "ddakfit" });
    w.ddakfitGaIds.add(id);
  }
  return true;
}

function safeParams(params: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const key of ["count", "file_count", "rating", "price", "faq_index"]) {
    const v = params[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e8) clean[key] = v;
  }
  if (typeof params.more === "boolean") clean.more = params.more;
  const enums: Record<string, string[]> = {
    method: ["google"], product: ["word", "presentation", "word_presentation_bundle"],
    path: ["find", "direct"], mode: ["button"],
    location: ["nav", "hero", "mobile", "pricing_free", "pricing_paid", "pricing_bundle", "final", "top_notice", "draft_result"],
    step: ["scope", "path", "chosen", "find-years", "find-region", "find-type", "find-sector", "find-desc", "find-results", "notice", "form", "form-pick", "diagnosis", "result", "handoff", "preview", "business_start", "region", "needed_help", "next_goal", "business_description"],
    value: ["provided", "skipped"], demo_type: ["early", "pre", "b2g"],
    stage: ["available", "shown", "oauth", "finder", "diagnosis", "draft", "checkout"], error_code: ["oauth_failed", "network", "unavailable"],
  };
  for (const [key, values] of Object.entries(enums)) if (typeof params[key] === "string" && values.includes(params[key] as string)) clean[key] = params[key];
  return clean;
}

export function track(event: GaEvent, params: Record<string, unknown> = {}): void {
  if ((event as string) === "purchase" || (event as string) === "refund") return;
  try {
    if (!analyticsEnvironmentAllowed()) { pendingEvents.length = 0; return; }
    if (!analyticsAllowed() && !PENDING_EVENTS.has(event)) return;
    captureUtm();
    const attribution = getAttribution();
    const clean = safeParams(params);
    if (event === "begin_checkout" || event === "checkout_link_click") {
      if (!clean.product || typeof clean.price !== "number" || clean.price <= 0) return;
      clean.currency = "KRW";
      clean.value = clean.price;
      const itemId = CHECKOUT_ITEM_IDS[clean.product as keyof typeof CHECKOUT_ITEM_IDS];
      if (!itemId) return; // Unconfigured products must not invent a purchase item ID.
      clean.items = [{ item_id: itemId, price: clean.price, quantity: 1 }];
    }
    for (const kind of ["first", "latest"] as const) {
      for (const [key, value] of Object.entries(attribution[kind])) clean[`${kind}_${key}`] = value;
    }
    const payload = { ...clean, site_id: "ddakfit", app_id: "ddakfit", send_to: measurementIds().join(","),
      page_location: safePageLocation(), page_referrer: "", page_title: "ddakfit", transport_type: "beacon" };
    if (!analyticsAllowed()) {
      if (pendingEvents.length < PENDING_LIMIT) pendingEvents.push({ event, params: payload });
      return;
    }
    emitEvent(event, payload);
  } catch {
    /* 측정 실패는 기능에 영향 주지 않음 */
  }
}

function emitEvent(event: GaEvent, payload: Record<string, unknown>): void {
  try {
    if (!initializeAnalytics()) return;
    const name = event === "sign_up" ? "login_start" : event === "complete_payment" ? "plan_session_start" : event === "checkout_start" ? "paywall_view" : event === "begin_checkout" ? "checkout_link_click" : event;
    // Queue gtag commands only. Never also push a GTM custom-event object.
    (window as GtagWindow).gtag!("event", name, payload);
  } catch { /* queued analytics failures must not interrupt authentication */ }
}

const LOGIN_INTENT_KEY = "gp_login_intent_v1";
export function recordLoginStart(): void {
  try { sessionStorage.setItem(LOGIN_INTENT_KEY, String(Date.now())); } catch { /* ignore */ }
  track("login_start", { method: "google" });
}

export function recordLoginSuccess(googleSession: boolean): void {
  if (!googleSession) return;
  try {
    const started = Number(sessionStorage.getItem(LOGIN_INTENT_KEY));
    sessionStorage.removeItem(LOGIN_INTENT_KEY);
    if (!started || Date.now() - started < 0 || Date.now() - started > 10 * 60 * 1000) return;
    track("login", { method: "google" });
  } catch { /* no intent means no inferred success */ }
}

export function trackCheckout(product: "word" | "presentation" | "word_presentation_bundle", price: number): void {
  if (!Number.isFinite(price) || price <= 0) return;
  track("checkout_link_click", { product, price });
}
