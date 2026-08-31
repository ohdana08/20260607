"use client";
/* eslint-disable react-hooks/set-state-in-effect -- 브라우저 저장소·URL·외부 인증 결과를 마운트 후 복원하는 상태 머신입니다. */

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { Recommendation, Program } from "@/lib/match/types";
import {
  PLAN_SECTIONS,
  buildRegionNotice,
  ensureFormTableNotice,
  ensureConditionalRegionNotice,
  extractBusinessRegion,
  formTocToPlanSections,
  preferredRegionNoticeHeading,
  sanitizeFormToc,
} from "@/lib/plan/sections";
import {
  reviewReportSections,
  type PlanReadinessAssessment,
  type PlanReviewReport,
} from "@/lib/plan/reviewer";
import { track } from "@/lib/ga";
import { captureUtm, getLeadSource } from "@/lib/utm";
import { useAuth, authedHeaders, forceRefreshToken, AuthModal } from "@/components/auth/AuthGate";
import { GROBLE_CHECKOUT_URL, PRICE_LABEL, PRICE_KRW } from "@/lib/config";
import {
  EvidenceDiagnosisForm,
  EvidenceSheetCard,
  DraftPreviewCard,
  PreStageCard,
} from "@/components/chat/EvidenceDiagnosis";
import DiagnosisWizard, {
  type WizardStart,
  type WizPayload,
  type FindState,
} from "@/components/chat/DiagnosisWizard";
import PublicEvidencePanel from "@/components/chat/PublicEvidencePanel";
import { NATIONWIDE } from "@/lib/match/buttonFilter";
import { deriveConvYears } from "@/lib/match/convProfile";
import {
  buildSheet,
  isPreStage,
  FIXED_GAPS,
  type EvidenceRow,
  type EvidenceSheet,
} from "@/lib/diagnosis/evidence";
import { LOCAL_REVIEW_EVIDENCE_ROWS } from "@/lib/diagnosis/localReviewEvidence";
import {
  plainCheckReason,
  plainEligibilityLabel,
  plainProgramExplanation,
  plainSupportOption,
} from "@/lib/plain-language";

type Role = "user" | "assistant";
interface ChatImage {
  mediaType: string;
  data: string; // base64 (no prefix)
}
interface ChatFile {
  mediaType: string; // application/pdf
  data: string; // base64 (no prefix)
  name: string;
}
interface ChatDoc {
  name: string;
  text: string; // 워드 등에서 뽑아낸 글자 (전송 시 content에 합쳐짐)
}
interface Lead {
  id: string;
  name: string;
  contact: string;
}
interface SavedProgram {
  id: string;
  title: string;
  applyEnd: string | null;
  url: string;
  supportField: string;
  region: string;
  savedAt: number;
}
const LEAD_KEY = "gp_lead_v1";
const VIEWED_KEY = "gp_viewed_v1";
// 공고 선택·추천 결과 세션 보존(2026-07-12) — 화면 이동·위저드 리마운트·새로고침에도 유지
const SELPROG_KEY = "gp_selprog_v1";
const FIND_KEY = "gp_find_v1";
// 그로블 결제창을 연 흔적. 결제 후 돌아온 화면에서는 결제 버튼을 다시 보여주지 않는다.
const CHECKOUT_STARTED_KEY = "gp_checkout_started_v1";
const CHECKOUT_MARK_TTL_MS = 2 * 60 * 60 * 1000;
// 사업계획서 표준 양식(구글드라이브, 공개 뷰어) + K-Startup 모집중 공고 목록.
// 드라이브 폴더에 공고문·별첨 양식이 들어 있어 사용자가 바로 받아 써볼 수 있다.
const OFFICIAL_LINKS: { label: string; href: string }[] = [
  { label: "예비창업패키지 양식", href: "https://drive.google.com/drive/folders/1SkYXXPAGHo28h0BSsIw9KHUbAfZktpcS" },
  { label: "초기창업패키지 양식", href: "https://drive.google.com/drive/folders/1Y57CqqwsFdaoEcb12NbXqZFpOyDSdHrt" },
  { label: "K-Startup 모집중 공고", href: "https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do" },
];
interface Msg {
  role: Role;
  content: string;
  images?: ChatImage[];
  files?: ChatFile[];
  docs?: ChatDoc[];
}
type Mode = "intake" | "fitcheck" | "diagnose" | "paywall" | "plan";
interface DraftSection {
  heading: string;
  content: string;
}
interface Draft {
  title: string;
  sections: DraftSection[];
}
interface Chart {
  key: string;
  title: string;
  png: string;
  width: number;
  height: number;
}
// 합격 가능성 진단 결과 (2026-07-10 확정 설계 — 전부 무료 공개, LLM 호출 0회)
type EvidenceResult =
  | { kind: "sheet"; sheet: EvidenceSheet }
  | { kind: "pre" };

// ── 신청 자격 판정 (2026-07-12) ──────────────────────────────────────────
// 공고 분석(fitcheck)이 [자격요건]JSON[/자격요건] 마커로 요건을 구조화해 보내고,
// 결제 후 인터뷰(plan)는 [자격판정:충족|불확실|미충족] 마커로 판정을 보낸다.
// 마커는 화면에서 숨기고, 판정 전/미충족/불확실 상태에선 초안 생성을 게이트한다.
interface EligReqs {
  found?: boolean;
  required?: string[];
  disqualifiers?: string[];
  obligations?: string[];
}
type EligStatus = "충족" | "불확실" | "미충족";
interface DraftReadiness {
  ready: boolean;
  score: number;
  missing: string[];
}
interface ApplicationDecision {
  applicationKind?: "business-plan" | "simple-application" | "reservation" | "unknown";
  requiresBusinessPlan?: boolean | null;
  reason?: string;
}
const ELIG_REQ_RE = /\[자격요건\]([\s\S]*?)\[\/자격요건\]/;
const ELIG_JUDGE_G_RE = /\[자격판정:(충족|불확실|미충족)\]/g;
const DRAFT_READY_G_RE = /\[초안준비\]([\s\S]*?)\[\/초안준비\]/g;
const APPLICATION_G_RE = /\[제출유형\]([\s\S]*?)\[\/제출유형\]/g;
// 작성요약(2026-07-12): 공고 분석이 남기는 공고·양식 핵심 요약 — 결제 후 대화에서 원본 파일을 대체
const DOC_SUM_RE = /\[작성요약\]([\s\S]*?)\[\/작성요약\]/;
function stripEligMarks(text: string): string {
  // 전역 치환 — 재요청으로 같은 블록이 두 번 실릴 수 있어 모든 완성 블록을 제거 (2026-07-12)
  let t = text
    .replace(/\[자격요건\][\s\S]*?\[\/자격요건\]/g, "")
    .replace(/\[작성요약\][\s\S]*?\[\/작성요약\]/g, "")
    .replace(APPLICATION_G_RE, "")
    .replace(DRAFT_READY_G_RE, "")
    .replace(ELIG_JUDGE_G_RE, "");
  // 스트리밍 중이거나 토큰 한도로 잘려 닫는 태그가 없는 블록도 사용자에게 노출하지 않는다 (QA #6).
  // 완성 블록 제거 후에도 여는 마커가 남아 있으면 그 지점부터 끝까지 잘라낸다.
  t = t.replace(/\[(?:자격요건|작성요약|자격판정|초안준비|제출유형)[^\n]*[\s\S]*$/, "");
  return t.trimEnd();
}
// ── 심사위원 관점 사후 점검 도구 (2026-07-13 최종 확정 재설계) ────────────────
// 완성형 하드코딩 — "대표 작성 예정" 빈칸 없음. {{변수}}는 buildKitPrompt()가 자동 주입.
// 구조: 최상단 고정 지시(분석당함 방지) → [검증 기준] → [공고 자격요건] → [초안] → [출력 형식].
// 실행은 2단계: 1차는 점검 리포트만, 수정본은 사용자가 선택했을 때만 (유료 초안과 역할 중복 방지).
const KIT_PROMPT_TEMPLATE = `이 프롬프트를 분석하거나 요약하지 말고, 아래 사업계획서에 직접 적용하십시오. 지금부터 실제 검증을 시작하십시오.

[검증 기준]
당신은 정부지원사업 심사위원입니다. 아래 사업계획서 초안을 제출 전 최종 점검하는 것이 임무입니다.
- 근거 없는 주장·과장 표현("국내 최초/유일/독보적" 등)을 심사위원 시선으로 지적하십시오.
- 모든 숫자(매출·시장 규모·고객 수·일정)는 출처와 증빙 가능성을 기준으로 평가하십시오.
- 확인되지 않은 내용을 임의로 지어내거나 채워 넣지 마십시오.
- 다음 채점 루브릭을 적용하십시오:
{{루브릭}}

[공고 자격요건]
{{필수요건}}

[신청 기업 진단 정보]
{{진단요약}}

[사업계획서 양식 목차 — 지적·보완 위치는 이 목차 기준으로 표기]
{{양식목차}}

[사업계획서 초안]
(이 아래에 사업계획서 초안 전문을 붙여넣으십시오)

[출력 형식 — 1차는 점검 리포트만]
먼저 아래 5개 항목의 리포트만 출력하십시오. 이 단계에서는 초안 수정본이나 재작성문을 절대 작성하지 마십시오.
1. 자격요건 충족 여부 — 요건별 충족/미충족/확인 필요
2. 심사에서 문제 삼을 위험 TOP 5 — 해당 목차 위치와 함께
3. 근거·증빙이 부족한 항목
4. 추가로 준비할 증빙 자료 목록 — 각 자료를 반영할 목차 위치 포함
5. 수정 우선순위 — 높음/중간/낮음
리포트 마지막에 아래 선택지를 제시하고 사용자의 선택을 기다리십시오:
"다음 중 무엇을 도와드릴까요? ① 수정본 만들기 ② 증빙 목록만 보기 ③ 특정 목차만 보완"
사용자가 선택하기 전에는 전체 수정본을 작성하지 마십시오.`;

// 채점 루브릭 (30_dev/루브릭_초안채점_260710 확정안)
const KIT_RUBRIC = `□ 심사위원이 지적할 지점을 명시하는가 (0/1)
□ 삭감 1순위 비목(광고선전비 등)을 피하는가 (0/1)
□ '~할 예정입니다' → 과정·결과로 바꾸는가 (문장 3개 중 2개 이상 전환 시 1)
□ 공고문을 파싱해 평가 항목에 배치하는가 (0/1)`;

// 컨설팅 문의 — 카톡채널 (가격·약속 문구 없음)
const KAKAO_CONSULT_URL = "https://pf.kakao.com/_xbrxjxkxj/chat";

const SUMMARY_PREFIX =
  "[공고·양식 요약] 아래는 사용자가 올린 공고문·양식의 요약입니다. 원본 파일 대신 이 요약을 기준으로 진행하세요. 특히 '양식 목차'가 있으면 그 항목명·순서를 그대로 따르세요.\n\n";

// 양식 목차 결정적 추출(2026-07-12) — LLM 요약이 목차를 압축·누락할 수 있어(검증에서 확인됨),
// 업로드된 양식 텍스트에서 항목 라인(□, n., n-n.)을 코드로 직접 뽑아 요약에 원문 그대로 결합한다.
// 2026-07-14 보강: 실제 프리팁스·예창·초창 양식 3종으로 검증 중 발견한 오염 2가지 —
// ① hwpx 추출 시 <hp:lineBreak/> 같은 내부 XML 태그가 텍스트에 그대로 남아, 같은 항목이
//    태그 차이만으로 다른 문자열이 돼 있음 → 태그 제거로 정리.
// ② 표지 요약 페이지의 짧은 제목과 본문 섹션 제목이 같은 번호/기호로 두 번씩 잡히고
//    "00.00 ~ 00.00" 같은 날짜 표 칸까지 숫자 접두사 정규식에 걸림 → 한글 없는 줄 배제 +
//    같은 번호("2." "2-1.")·같은 □항목(부가어 무시 후 동일)은 가장 정보량 많은 한 줄만 채택.
function formHeadingDedupKey(l: string): string {
  const num = l.match(/^[0-9]{1,2}(-[0-9]{1,2})?\./)?.[0];
  if (num) return num;
  if (/^(□|■)/.test(l)) return l.replace(/^(□|■)\s*/, "").replace(/창업\s*아이템\s*/g, "").trim();
  return l;
}
function extractFormHeadings(text: string): string[] {
  const candidates = text
    .split(/\n/)
    .map((l) => l.replace(/<[^>]+>/g, "").trim()) // hwpx 내부 XML 태그 잔존분 제거
    .filter((l) => l.length >= 2 && l.length <= 60 && /^(□|■|[0-9]{1,2}(-[0-9]{1,2})?\.\s*\S)/.test(l))
    .filter((l) => /[가-힣]/.test(l)); // 날짜 표 칸 등 한글 없는 잡음 배제

  const bestByKey = new Map<string, string>();
  const order: string[] = [];
  for (const l of candidates) {
    const key = formHeadingDedupKey(l);
    const prev = bestByKey.get(key);
    if (!prev) order.push(key);
    if (!prev || l.length > prev.length) bestByKey.set(key, l);
  }
  return order.map((key) => bestByKey.get(key)!);
}

const GREETING =
  "안녕하세요! 사장님께 맞는 정부지원사업을 같이 찾아볼게요. 😊\n무료로 어디까지 받을 수 있는지 아래에서 먼저 확인해 주세요!";
// 인테이크 앞단 3문항(단계·지역·연령) — 버튼/선택지로 받아 LLM 호출 없이 수집 (점검표 문제 8)
interface IntakeProfile {
  stage: string;
  region: string;
  ageGroup: string;
}
const PROFILE_STAGES = ["예비창업 준비 중", "운영 중(사업자 있음)"];
const PROFILE_REGIONS = [
  "전국(어디든 가능)", "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];
const PROFILE_AGES = ["20대", "30대", "40대", "50대", "60대 이상"];
const PLAN_MIN_TURNS = 5; // 2차 대화를 최소 이만큼 한 뒤에야 초안 작성 가능
const READY_MARK = "[추천준비완료]"; // 인테이크 완료 신호(사용자에겐 숨김)
const PRICE = PRICE_LABEL; // 판매가 표기 — 원본은 lib/config.ts (2026-07-11 그로블 신상품 가격)
// 합격 가능성 진단 안내 (2026-07-10 확정 설계 — 버튼 2화면, 타이핑 불필요)
const DIAGNOSE_INTRO =
  "좋아요! 긴 문서를 쓰기 전에, **지금까지 해낸 일과 더 준비할 내용**을 1분 만에 확인해볼게요. 📋\n\n사람을 평가하는 게 아니라 **신청 준비 상태를 확인**하는 과정이에요. 아래에서 골라주시기만 하면 돼요 — 타이핑은 필요 없어요!";
// 후기 수집 팝업의 태그 선택지 (업무지시서 4-2)
const REVIEW_TAGS = [
  "막막했는데 구조가 잡혔다",
    "담당자가 헷갈릴 표현을 잡아줬다",
  "혼자선 못 쓸 부분을 채워줬다",
  "빠르게 초안이 나왔다",
  "어떤 사업에 맞는지 알려줬다",
];
// (구) 계좌이체+카톡+이용권 코드 흐름은 2026-07-09 그로블 주문번호 인증(Paywall)으로 대체됨.

// ── 대화 기록(이 브라우저에 저장) ──
const LS_KEY = "govplan_convos_v1";
interface SavedConvo {
  id: string;
  title: string;
  updatedAt: number;
  messages: { role: Role; content: string }[];
  // 진행 단계 영속화(2026-07-13 T3): 미복원 시 작성 세션이 intake로 리셋돼
  // 추천 버튼(userTurns 폴백)·/api/chat 오라우팅이 열리는 구멍(P0-2 실사고 경로)이 생긴다
  mode?: Mode;
  planStartIdx?: number;
  draftReadiness?: DraftReadiness;
  // 3문항 프로필 영속화(2026-07-14 P1): 미복원 시 복원된 대화의 추천이
  // 지역·단계 빈 값으로 나가 규칙 사전 필터가 통째로 꺼졌다 ("지역=-·단계=-" 로그)
  profile?: IntakeProfile;
}

function assistantTextClaimsDraftReady(text: string): boolean {
  return /(?:이제|지금까지)[^\n]{0,20}충분히 들었|초안(?:을)? 만들 준비가 (?:됐|되었)|사업계획서 초안 만들기[^\n]{0,40}버튼을 눌/.test(
    text,
  );
}

function inferSavedDraftReadiness(
  messages: SavedConvo["messages"],
  planStartIdx: number,
): DraftReadiness | null {
  const planMessages = messages.slice(planStartIdx);
  const turns = planMessages.filter((message) => message.role === "user").length;
  if (turns < PLAN_MIN_TURNS) return null;
  const assistantReady = [...planMessages]
    .reverse()
    .find((message) => message.role === "assistant" && assistantTextClaimsDraftReady(message.content));
  return assistantReady ? { ready: true, score: 80, missing: [] } : null;
}

// 복원 시 안전한 단계로 매핑 — diagnose(버튼 UI 상태 의존)·paywall(모달)은 fitcheck로
function restoreMode(saved?: Mode): Mode {
  if (saved === "plan" || saved === "fitcheck") return saved;
  if (saved === "diagnose" || saved === "paywall") return "fitcheck";
  return "intake";
}
function loadConvos(): SavedConvo[] {
  if (typeof window === "undefined") return [];
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function persistConvos(list: SavedConvo[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* 용량 초과 등은 무시 */
  }
}
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Chat() {
  // 유료 전환 파이프(2026-07-09): 로그인 세션 + 결제 확인(is_paid) 상태.
  // ⚠️ 토큰은 컨텍스트 값을 저장해 쓰지 말 것 — 만료 버그(§11) 재발.
  //    모든 인증 요청은 authedHeaders()로 요청 직전에 신선한 토큰을 받는다.
  const { session, paid, localReview, setPaid, email, signOut } = useAuth();
  const [payOpen, setPayOpen] = useState(false); // 상단 [결제 확인] 메뉴로 여는 모달
  const [paymentAfterAuth, setPaymentAfterAuth] = useState(false); // 로그인 후 주문번호 입력창 재오픈
  const [returningFromPayment, setReturningFromPayment] = useState(false);
  // 재구매(2026-07-14): 전역 paid=true여도 "이 진입은 소진돼서 새 주문번호가 필요하다"를
  // 구분한다 — Paywall에 paid 그대로 넘기면 항상 "결제 완료" 화면만 보여 입력폼이 안 뜬다.
  const [needsRepurchase, setNeedsRepurchase] = useState(false);
  // 로그인 게이트 B안(2026-07-10): 진단 결과 보기 직전에 로그인 요구
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingEvidence, setPendingEvidence] = useState<{ revenue: string; items: string[] } | null>(null);

  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<ChatFile[]>([]);
  const [pendingDocs, setPendingDocs] = useState<ChatDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [nearMisses, setNearMisses] = useState<Program[]>([]); // 추천 0건 시 근접 공고 (리드 수집 흐름)
  const [usingSample, setUsingSample] = useState(false);
  // GA4 단계 이벤트(v3): 세션당 한 번만 발화하도록 가드
  const chatStartedRef = useRef(false);
  const validationFiredRef = useRef(false);
  const recommendingRef = useRef(false); // 추천 이중 실행 방지 (state보다 빠른 동기 가드)
  const turnBusyRef = useRef(false); // 대화 턴(send/retry) 이중 전송 방지 — 연타 시 busy state 갱신 전 레이스 차단
  const planKickoffRef = useRef<string | null>(null); // 결제 CTA 연타·상태 레이스로 kickoff 중복 실행 방지

  const [provider, setProvider] = useState<"claude" | "openai">("claude");
  const [mode, setMode] = useState<Mode>("intake");
  // 인테이크 앞단 3문항(버튼) 결과 — /api/match 사전 필터에도 전달
  const [profile, setProfile] = useState<IntakeProfile | null>(null);
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);
  const [code, setCode] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [readinessChecking, setReadinessChecking] = useState(false);
  const [reviewingDraft, setReviewingDraft] = useState(false);
  const [revisingDraft, setRevisingDraft] = useState(false);
  const [planReview, setPlanReview] = useState<PlanReviewReport | null>(null);
  const [charts, setCharts] = useState<Chart[] | null>(null);
  const [planStartIdx, setPlanStartIdx] = useState(0); // 2차 대화 시작 지점
  // 합격 가능성 진단 (2026-07-10 확정 설계) — 매핑표는 evidence_map 테이블(하드코딩 금지)
  const [evMap, setEvMap] = useState<EvidenceRow[] | null>(null);
  const [evMapError, setEvMapError] = useState(false);
  const [evResult, setEvResult] = useState<EvidenceResult | null>(null);
  const [evPrograms, setEvPrograms] = useState<Program[] | null>(null); // pre: 실적 만드는 공고
  const [evProgramsLoading, setEvProgramsLoading] = useState(false);
  // 초안 미리보기(2026-07-11 디자인수정) — 무료 결과와 결제 사이의 전환 화면 (구 대화 호환용)
  const [previewOpen, setPreviewOpen] = useState(false);
  // 신청 자격 판정(2026-07-12) — 요건(공고 분석에서 추출)·판정(인터뷰에서 갱신)·강행 여부
  const [eligReqs, setEligReqs] = useState<EligReqs | null>(null);
  const [eligStatus, setEligStatus] = useState<EligStatus | null>(null);
  const [eligOverride, setEligOverride] = useState(false);
  // LLM이 매 답변 뒤 구조화해 보내는 정보 충족도. 횟수만 채워 초안을 만드는 것을 막는다.
  const [draftReadiness, setDraftReadiness] = useState<DraftReadiness | null>(null);
  // 스트리밍이 빈 응답/끊김으로 끝났을 때 재시도 버튼 노출 (2026-07-12 "..." 멈춤 버그)
  const [retryable, setRetryable] = useState(false);
  const [kickoffError, setKickoffError] = useState<string | null>(null);
  // 공고·양식 작성요약(2026-07-12) — 있으면 결제 후 대화에서 문서 원본 대신 이걸 보낸다 (프롬프트 69K→수천 토큰)
  const [docSummary, setDocSummary] = useState<string | null>(null);
  // 완성 키트용 진단지 보존 — evResult는 결제 시 리셋되므로 초안 시점까지 별도 유지 (2026-07-12)
  const [kitSheet, setKitSheet] = useState<EvidenceSheet | null>(null);
  // 찾기 결과 세션 캐시(2026-07-12) — 공고 선택으로 위저드가 리마운트돼도 추천 목록·조건 유지
  const [findCache, setFindCache] = useState<FindState | null>(null);
  const [seenRecs, setSeenRecs] = useState<Recommendation[]>([]);
  function saveFindResults(fs: FindState) {
    setFindCache(fs);
    setSeenRecs((prev) => {
      const ids = new Set(prev.map((r) => r.program.id));
      const next = [...prev, ...fs.recommendations.filter((r) => !ids.has(r.program.id))].slice(-120);
      try {
        sessionStorage.setItem(FIND_KEY, JSON.stringify({ cache: fs, seen: next }));
      } catch {
        /* 용량 초과 등 무시 */
      }
      return next;
    });
  }
  // 양식 목차 원문(코드 추출) — LLM 요약의 목차 압축·누락을 막는 결정적 보강
  const [formToc, setFormToc] = useState<string[]>([]);
  // 진단 위저드(2026-07-12 전면 적용) — null이면 챗 화면, 아니면 해당 시작 지점의 전체 화면 흐름
  const [wizardStart, setWizardStart] = useState<WizardStart | null>(null);
  // 위저드에서 올린 공고·양식의 AI 분석(스트리밍 상태) — 결과 화면 '이 공고의 핵심' 블록에 표시
  const [wizAnalysis, setWizAnalysis] = useState<{ text: string; busy: boolean }>({ text: "", busy: false });
  const wizardActive = wizardStart !== null;
  // 후기 수집 팝업
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  // 회원(리드) + 관심사업 캘린더
  const [lead, setLead] = useState<Lead | null>(null);
  const [saved, setSaved] = useState<SavedProgram[]>([]);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupName, setSignupName] = useState("");
  const [signupContact, setSignupContact] = useState("");
  const [signupBusy, setSignupBusy] = useState(false);
  const [signupConsent, setSignupConsent] = useState(false);
  const [viewed, setViewed] = useState<SavedProgram[]>([]); // 비회원이 본 공고(이 브라우저 임시)
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  // 회원이면 서버 저장본, 비회원이면 본 공고 임시목록
  const calItems = lead ? saved : viewed;
  const collectedIds = new Set(calItems.map((s) => s.id));

  // 단일 userProfile 동기화(2026-07-12): 대화에서 정정한 업력·3문항 지역을 버튼 플로우 프리필로
  const derivedYearsBucket = (() => {
    try {
      const t = messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
      return deriveConvYears(t)?.bucket ?? null;
    } catch {
      return null;
    }
  })();
  const prefillRegionVal =
    findCache?.region ??
    (profile?.region ? (profile.region.includes("전국") ? NATIONWIDE : profile.region) : null);

  const [convoId, setConvoId] = useState<string>("");
  const [convos, setConvos] = useState<SavedConvo[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userTurns = messages.filter((m) => m.role === "user").length;
  const planUserTurns = messages.slice(planStartIdx).filter((m) => m.role === "user").length;
  const draftAnswersReady =
    draftReadiness?.ready === true && draftReadiness.score >= 80 && draftReadiness.missing.length === 0;
  // 인테이크에서 핵심 정보(운영상태·업력·지역·나이·업종·필요한 도움)를 다 들으면 AI가 신호를 보냄.
  // 신호를 못 받아도 충분히 대화(6턴)하면 잠기지 않게 풀어줌(안전장치).
  const readyToRecommend =
    messages.some((m) => m.role === "assistant" && m.content.includes(READY_MARK)) ||
    userTurns >= 6;
  const programStage = mode === "fitcheck" || mode === "diagnose" || mode === "plan";
  // 대화 시작 전, 앞단 3문항 폼이 떠 있는 상태 (이때는 텍스트 입력 잠금)
  const profileFormVisible = mode === "intake" && !profile && messages.length === 1 && !recs;

  // 앞단 3문항 완료 — LLM 호출 없이 대화에 [내 정보]로 기록하고 아이템 질문으로 진행
  function submitProfile(p: IntakeProfile) {
    setProfile(p);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `[내 정보] 사업 단계: ${p.stage} / 지역: ${p.region} / 연령대: ${p.ageGroup}` },
      {
        role: "assistant",
        content: "좋아요, 확인했어요! 그럼 어떤 사업을 구상 중이세요? 한 문장으로 편하게 말씀해 주세요. 😊",
      },
    ]);
    // GA4: 인테이크 첫 답변(버튼 선택)이 이뤄진 순간 — 세션당 1회
    if (!chatStartedRef.current) {
      chatStartedRef.current = true;
      track("chat_started");
    }
    focusInput();
  }

  function startTour() {
    const d = driver({
      showProgress: true,
      nextBtnText: "다음 →",
      prevBtnText: "← 이전",
      doneBtnText: "시작하기",
      steps: [
        {
          popover: {
            title: "환영해요! 👋",
            description:
              "사업 얘기부터 시작하면 지금 신청할 수 있는 지원을 찾고, 필요한 경우 공식 양식 워드 초안까지 이어져요. 어려운 용어는 몰라도 괜찮아요!",
          },
        },
        {
          element: '[data-tour="input"]',
          popover: {
            title: "여기에 답을 적어요 ✍️",
            description: "편하게 대화하듯 답해 주세요. 챗봇이 하나씩 물어봐요.",
          },
        },
        {
          element: '[data-tour="send"]',
          popover: {
            title: "보내기",
            description:
              "몇 번 대화하면 입력창 위에 '✨ 지원사업 추천받기' 버튼이 생겨요. 누르면 나에게 맞는 사업이 나와요!",
          },
        },
        {
          element: '[data-tour="history"]',
          popover: {
            title: "지난 대화 보기 🕘",
            description: "예전에 나눈 대화를 여기서 다시 볼 수 있어요.",
          },
        },
        {
          popover: {
            title: "3단계면 끝나요 📋",
            description:
              "①지금 하는 일과 지역에 맞는 지원 찾기 → ②내가 신청해도 되는지 확인 → ③필요할 때만 사업계획서 완성!",
          },
        },
        {
          popover: {
            title: "그럼 시작해볼까요? 😊",
            description: "먼저 '어떤 사업을 구상 중인지'부터 편하게 답해보세요!",
          },
        },
      ],
    });
    d.drive();
  }

  // 첫 진입: UTM 캡처(/embed 직접 유입 시 URL에서 읽어 sessionStorage 보관)
  useEffect(() => {
    captureUtm();
    const params = new URLSearchParams(window.location.search);
    // 운영자 테스트용: ?code=마스터코드 로 접속하면 결제 없이 초안 관문 통과
    const mc = params.get("code");
    if (mc) setCode(mc);
    // 그로블 결제 완료 화면의 '도우미로 돌아가기'로 복귀하면 주문번호 입력창만 바로 연다.
    let fromGroble = params.get("payment") === "complete";
    try {
      fromGroble ||= new URL(document.referrer).hostname.endsWith("groble.im");
    } catch {
      /* referrer가 없으면 일반 진입으로 처리 */
    }
    try {
      const checkoutAt = Number(localStorage.getItem(CHECKOUT_STARTED_KEY) ?? 0);
      fromGroble ||= checkoutAt > 0 && Date.now() - checkoutAt < CHECKOUT_MARK_TTL_MS;
    } catch {
      /* localStorage 차단 환경에서는 referrer만 사용 */
    }
    if (fromGroble) {
      setReturningFromPayment(true);
      setPayOpen(true);
    }
  }, []);

  // 첫 진입: 튜토리얼 1회 자동 실행
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("tour_seen_v1")) return;
    const t = setTimeout(() => {
      try {
        startTour();
        localStorage.setItem("tour_seen_v1", "1");
      } catch {
        /* ignore */
      }
    }, 700);
    return () => clearTimeout(t);
  }, []);

  // 첫 진입: 저장된 대화 불러오기 + 가장 최근 대화를 화면에 이어서 보여줌
  // (새로고침해도 대화가 사라지지 않게)
  useEffect(() => {
    const list = loadConvos();
    setConvos(list);
    const recent = list.find((c) => c.messages.some((m) => m.role === "user"));
    const requestedStart = new URLSearchParams(window.location.search).get("start");
    const startsNewFlow = requestedStart === "find" || requestedStart === "direct";
    if (requestedStart === "direct") {
      setMessages([{ role: "assistant", content: GREETING }]);
      setConvoId(genId());
      startDirect();
    } else if (requestedStart === "find") {
      setMessages([{ role: "assistant", content: GREETING }]);
      setConvoId(genId());
      setWizardStart("find");
      setSelectedProgram(null);
      persistProgram(null);
    } else if (recent) {
      setMessages(recent.messages.map((m) => ({ role: m.role, content: m.content })));
      setConvoId(recent.id);
      // 진행 단계 복원(2026-07-13 T3) — 작성 세션이 intake로 리셋돼 추천이 다시 열리던 구멍 봉쇄
      setMode(restoreMode(recent.mode));
      const restoredPlanStart = Math.min(recent.planStartIdx ?? 0, recent.messages.length);
      setPlanStartIdx(restoredPlanStart);
      setDraftReadiness(
        recent.draftReadiness ?? inferSavedDraftReadiness(recent.messages, restoredPlanStart),
      );
    } else {
      setConvoId(genId());
      setWizardStart("scope"); // 첫 방문 — 지원사업 찾기/이미 정한 공고 두 선택지부터 시작
    }
    // 세션 보존 복원(2026-07-12): 선택 공고·추천 결과는 새로고침에도 유지
    try {
      if (!startsNewFlow) {
        const sp = sessionStorage.getItem(SELPROG_KEY);
        if (sp) setSelectedProgram(JSON.parse(sp) as Program);
        const fd = sessionStorage.getItem(FIND_KEY);
        if (fd) {
          const parsed = JSON.parse(fd) as { cache?: FindState; seen?: Recommendation[] };
          if (parsed.cache) setFindCache(parsed.cache);
          if (Array.isArray(parsed.seen)) setSeenRecs(parsed.seen);
        }
      }
    } catch {
      /* 손상된 세션 데이터는 무시 */
    }
    // 첫 진입 URL과 저장 대화는 마운트 시 한 번만 해석한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 대화가 바뀔 때마다 이 브라우저에 자동 저장(이미지 제외, 사용자 발화 있을 때만)
  useEffect(() => {
    if (!convoId) return;
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser) return;
    const title = firstUser.content.trim().slice(0, 30) || "새 대화";
    const stripped = messages.map((m) => ({ role: m.role, content: m.content }));
    setConvos((prev) => {
      const others = prev.filter((c) => c.id !== convoId);
      const next = [
        {
          id: convoId,
          title,
          updatedAt: Date.now(),
          messages: stripped,
          mode,
          planStartIdx,
          ...(draftReadiness ? { draftReadiness } : {}),
          ...(profile ? { profile } : {}),
        },
        ...others,
      ].slice(0, 50);
      persistConvos(next);
      return next;
    });
  }, [messages, convoId, mode, planStartIdx, profile, draftReadiness]);

  function newChat() {
    setMessages([{ role: "assistant", content: GREETING }]);
    setWizardStart("scope"); // 새 대화는 두 가지 출발점 선택부터
    setWizAnalysis({ text: "", busy: false });
    resetEligibility();
    setRetryable(false);
    persistProgram(null);
    setFindCache(null);
    setSeenRecs([]);
    try {
      sessionStorage.removeItem(FIND_KEY);
    } catch {
      /* ignore */
    }
    setRecs(null);
    setDraft(null);
    setCharts(null);
    setSelectedProgram(null);
    setCode("");
    setMode("intake");
    resetEvidence();
    setReviewOpen(false);
    setReviewDone(false);
    setPendingImages([]);
    setInput("");
    setConvoId(genId());
    setHistoryOpen(false);
  }

  function loadChat(c: SavedConvo) {
    setMessages(
      c.messages.length > 0
        ? c.messages.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: "assistant", content: GREETING }],
    );
    setWizardStart(null); // 기존 대화 열람 — 챗 화면으로
    setWizAnalysis({ text: "", busy: false });
    resetEligibility();
    setRetryable(false);
    setRecs(null);
    setDraft(null);
    setCharts(null);
    setSelectedProgram(null);
    setMode(restoreMode(c.mode)); // 진행 단계 복원(2026-07-13 T3)
    setProfile(c.profile ?? null); // 3문항 프로필 복원(2026-07-14 P1) — 이전 대화 프로필 누수도 차단
    setPlanStartIdx(Math.min(c.planStartIdx ?? 0, c.messages.length));
    setDraftReadiness(
      c.draftReadiness ?? inferSavedDraftReadiness(c.messages, Math.min(c.planStartIdx ?? 0, c.messages.length)),
    );
    resetEvidence();
    setReviewOpen(false);
    setReviewDone(false);
    setPendingImages([]);
    setInput("");
    setConvoId(c.id);
    setHistoryOpen(false);
  }

  function deleteChat(id: string) {
    setConvos((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistConvos(next);
      return next;
    });
    if (id === convoId) newChat();
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, recs, recommending, mode, draft, drafting]);

  function replaceLast(content: string) {
    setMessages((prev) => {
      const copy = [...prev];
      copy[copy.length - 1] = { role: "assistant", content };
      return copy;
    });
  }

  function resetEligibility() {
    setEligReqs(null);
    setEligStatus(null);
    setEligOverride(false);
    setDocSummary(null);
    setFormToc([]);
    setKitSheet(null);
    setDraftReadiness(null);
    setPlanReview(null);
    setReadinessChecking(false);
    setReviewingDraft(false);
    setRevisingDraft(false);
    setKickoffError(null);
    planKickoffRef.current = null;
  }

  // 사후 점검 프롬프트 조립 — {{변수}} 자동 주입 (완성형 템플릿, 빈칸 없음)
  function buildKitPrompt(): string {
    const 진단 = kitSheet
      ? `강점: ${kitSheet.strengths.map((s) => s.sentence).join(" / ") || "(없음)"}\n보완: ${[
          ...kitSheet.gaps.map((g) => `${g} 근거 부족`),
          ...FIXED_GAPS,
        ].join(" / ")}`
      : "(진단 미실시)";
    const 요건 = eligReqs?.required?.length
      ? eligReqs.required.map((r) => `- ${r}`).join("\n")
      : "(공고에서 자동 확인된 필수 요건 없음 — 공고문에서 직접 확인)";
    const 목차 = formToc.length > 0 ? formToc.join("\n") : "(별도 양식 없음 — 표준 목차 기준)";
    return KIT_PROMPT_TEMPLATE.replace("{{진단요약}}", 진단)
      .replace("{{필수요건}}", 요건)
      .replace("{{양식목차}}", 목차)
      .replace("{{루브릭}}", KIT_RUBRIC);
  }

  // 결제 후 대화 경량화(2026-07-12): 작성요약이 있으면 문서 원본(base64 PDF·추출 텍스트) 대신
  // 요약을 첫 사용자 턴으로 넣는다. 요약이 없으면(마커 미수신) 기존대로 원본을 보낸다 — 안전 폴백.
  // 양식 목차는 코드 추출본(formToc)을 항상 함께 실어 원문 항목명·순서를 보존한다.
  function summaryHead(): Msg[] {
    if (!docSummary) return [];
    const tocBlock =
      formToc.length > 0
        ? `\n\n■ 양식 목차(원문에서 그대로 추출 — 반드시 이 항목명·순서로 작성):\n${formToc.join("\n")}`
        : "";
    return [{ role: "user", content: `${SUMMARY_PREFIX}${docSummary}${tocBlock}` }];
  }
  function lightenForPlan(ms: Msg[]): Msg[] {
    if (!docSummary) return foldDocs(ms);
    // 마지막 사용자 턴의 첨부만 원본 유지(2026-07-12 통합진단 ⓐ) — 인터뷰 중간 첨부가
    // 경량화에 떼여 빈 메시지(Anthropic 400)가 되거나 조용히 유실되던 버그 수정.
    // 이전 턴 첨부는 요약이 대신하므로 프롬프트 비대는 재발하지 않는다.
    let lastUser = -1;
    for (let i = ms.length - 1; i >= 0; i--) {
      if (ms[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    const lightened: Msg[] = ms.map((m, i) => {
      if (i === lastUser) {
        const folded = foldDocs([m])[0]; // 문서 텍스트는 content로 합치고 이미지·PDF는 유지
        return { ...folded, content: folded.content || "(첨부 파일 참고)" };
      }
      return {
        role: m.role,
        content: m.content.replace(RECOVERY_RE, "") || "(첨부 파일 참고)",
      };
    });
    return [...summaryHead(), ...lightened];
  }

  // 어시스턴트 응답에서 자격·요약·초안 준비도 마커를 읽어 상태를 갱신하고 화면에서는 숨긴다.
  function absorbEligMarkers(text: string): string {
    const req = text.match(ELIG_REQ_RE);
    if (req) {
      try {
        const parsed = JSON.parse(req[1]) as EligReqs;
        setEligReqs(parsed);
      } catch {
        /* JSON 깨짐 — 요건 없음으로 둔다 */
      }
    }
    const sum = text.match(DOC_SUM_RE);
    if (sum && sum[1].trim().length >= 40) setDocSummary(sum[1].trim());
    let judge: EligStatus | null = null;
    for (const m of text.matchAll(ELIG_JUDGE_G_RE)) judge = m[1] as EligStatus;
    if (judge) {
      setEligStatus(judge);
      if (judge === "충족") setEligOverride(false); // 충족되면 강행 상태 해제
    }
    let readiness: DraftReadiness | null = null;
    for (const match of text.matchAll(DRAFT_READY_G_RE)) {
      try {
        const parsed = JSON.parse(match[1]) as Partial<DraftReadiness>;
        const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
        const missing = Array.isArray(parsed.missing)
          ? parsed.missing.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 7)
          : [];
        readiness = {
          ready: parsed.ready === true && score >= 80 && missing.length === 0,
          score,
          missing,
        };
      } catch {
        /* 깨진 판정은 준비 미확인 상태로 유지 */
      }
    }
    if (readiness) {
      setDraftReadiness(readiness);
    } else if (planUserTurns >= PLAN_MIN_TURNS && assistantTextClaimsDraftReady(text)) {
      // 새로고침 전 구버전 응답이나 마커 누락 응답도, AI의 명시적 완료 선언으로 안전하게 복구한다.
      setDraftReadiness({ ready: true, score: 80, missing: [] });
    }
    let application: ApplicationDecision | null = null;
    for (const match of text.matchAll(APPLICATION_G_RE)) {
      try {
        const parsed = JSON.parse(match[1]) as ApplicationDecision;
        const validKind = ["business-plan", "simple-application", "reservation", "unknown"].includes(
          parsed.applicationKind ?? "",
        );
        const validRequirement =
          parsed.requiresBusinessPlan === true ||
          parsed.requiresBusinessPlan === false ||
          parsed.requiresBusinessPlan === null;
        if (validKind && validRequirement) application = parsed;
      } catch {
        /* 깨진 제출유형 판정은 미확인 상태로 둔다 */
      }
    }
    if (application && selectedProgram) {
      const nextProgram: Program = {
        ...selectedProgram,
        applicationKind: application.applicationKind,
        requiresBusinessPlan: application.requiresBusinessPlan,
        applicationKindReason:
          typeof application.reason === "string"
            ? application.reason.trim().slice(0, 160)
            : selectedProgram.applicationKindReason,
      };
      setSelectedProgram(nextProgram);
      persistProgram(nextProgram);
    }
    return stripEligMarks(text);
  }

  // 스트림 오류 복구 문구는 다음 턴 LLM 입력에서 제외 — 토큰 낭비 방지 (점검표 문제 10)
  const RECOVERY_RE = /\n*\(죄송해요, 잠시 문제가 생겼어요\. 다시 (한 번 )?보내주시겠어요\?\)/g;

  // 추천/작성/도식 호출엔 이미지를 빼고 텍스트만 보냄(비용·토큰 절약).
  function stripImages(ms: Msg[]) {
    return ms.map(({ role, content }) => ({ role, content: content.replace(RECOVERY_RE, "") }));
  }

  // 워드에서 뽑은 글자를 전송 직전 content에 합쳐줌 (화면엔 칩으로만 표시)
  function foldDocs(ms: Msg[]): Msg[] {
    return ms.map((m) => {
      if (!m.docs || m.docs.length === 0) return { ...m, content: m.content.replace(RECOVERY_RE, "") };
      const note = m.docs
        .map((d) => `\n\n[첨부한 문서 "${d.name}"의 내용]\n${d.text}`)
        .join("");
      const { docs: _drop, ...rest } = m;
      void _drop;
      return { ...rest, content: (m.content.replace(RECOVERY_RE, "") || "") + note };
    });
  }

  function readBase64(f: File): Promise<string> {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] ?? "");
      r.readAsDataURL(f);
    });
  }

  // 첨부 변환(사진/PDF/워드 → 전송 가능한 형태) — 챗 입력창과 진단 위저드가 공용으로 쓴다
  async function convertFiles(files: FileList | null): Promise<WizPayload> {
    const imgs: ChatImage[] = [];
    const pdfs: ChatFile[] = [];
    const wordDocs: ChatDoc[] = [];
    if (!files) return { imgs, pdfs, docs: wordDocs };
    for (const f of Array.from(files).slice(0, 3)) {
      const lower = f.name.toLowerCase();
      const isImage = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf" || lower.endsWith(".pdf");
      const isWord = lower.endsWith(".docx");
      const isHwpx = lower.endsWith(".hwpx");
      const isHwp = lower.endsWith(".hwp");
      // 텍스트 파일(2026-07-12 ⓓ): 사업 소개·강의안·메모를 .txt/.md로 들고 오는 경우가 흔함
      const isText =
        lower.endsWith(".txt") ||
        lower.endsWith(".md") ||
        f.type === "text/plain" ||
        f.type === "text/markdown";
      if (!isImage && !isPdf && !isWord && !isHwp && !isHwpx && !isText) {
        alert(
          `${f.name}: 사진(JPG/PNG), PDF, 워드(.docx), 한글(.hwp/.hwpx), 텍스트(.txt/.md)만 첨부할 수 있어요.`,
        );
        continue;
      }
      if (f.size > 3 * 1024 * 1024) {
        alert(`${f.name}: 파일은 3MB 이하만 가능해요. (크면 필요한 페이지만 캡처해서 사진으로 올려주세요.)`);
        continue;
      }
      if (isText) {
        // 기존 문서 텍스트 추출 경로(docs) 재사용 — 워드·한글 추출본과 동일하게 전송된다
        try {
          const text = (await f.text()).trim();
          if (!text) {
            alert(`${f.name}: 파일에서 글자를 읽지 못했어요.`);
            continue;
          }
          wordDocs.push({ name: f.name, text: text.slice(0, 50000) });
        } catch {
          alert(`${f.name}: 파일을 읽는 중 문제가 생겼어요.`);
        }
        continue;
      }
      // 구형 한글(HWP)은 브라우저 번들에서 파서가 깨질 수 있어 서버에서 텍스트만 추출한다.
      if (isHwp) {
        try {
          const form = new FormData();
          form.append("file", f);
          const response = await fetch("/api/files/extract", { method: "POST", body: form });
          const result = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
          const text = result.text ?? "";
          if (text.trim().length >= 30) {
            wordDocs.push({ name: f.name, text });
            continue;
          }
          throw new Error(result.error || "추출된 글자가 너무 적음");
        } catch (error) {
          alert(
            `${f.name}: ${error instanceof Error ? error.message : "한글 파일을 읽지 못했어요."}\n` +
              `파일이 손상됐거나 암호가 설정된 경우에는 한글에서 PDF로 저장한 뒤 올려주세요.`,
          );
          continue;
        }
      }
      // HWPX는 표준 ZIP/XML 형식이라 브라우저에서 바로 읽는다.
      if (isHwpx) {
        try {
          const { extractHwpxText } = await import("@/lib/hwp/extract");
          const text = await extractHwpxText(await f.arrayBuffer());
          if (text.trim().length >= 30) {
            wordDocs.push({ name: f.name, text });
            continue;
          }
          throw new Error("추출된 글자가 너무 적음");
        } catch {
          alert(
            `${f.name}: HWPX 파일을 읽지 못했어요. 파일이 손상됐거나 암호가 설정된 경우에는 PDF로 저장한 뒤 올려주세요.`,
          );
          continue;
        }
      }
      if (isWord) {
        // 워드는 브라우저에서 글자만 뽑아 텍스트로 전송 (용량·API 제약 회피)
        try {
          const mod = await import("mammoth/mammoth.browser");
          const extractRawText = mod.extractRawText ?? mod.default?.extractRawText;
          const arrayBuffer = await f.arrayBuffer();
          const { value } = await extractRawText({ arrayBuffer });
          const text = (value || "").trim();
          if (!text) {
            alert(`${f.name}: 워드에서 글자를 읽지 못했어요. PDF로 저장해서 올려주세요.`);
            continue;
          }
          wordDocs.push({ name: f.name, text });
        } catch {
          alert(`${f.name}: 워드를 읽는 중 문제가 생겼어요. PDF로 저장해서 올려주세요.`);
        }
        continue;
      }
      const data = await readBase64(f);
      if (!data) continue;
      if (isImage) imgs.push({ mediaType: f.type, data });
      else pdfs.push({ mediaType: "application/pdf", data, name: f.name });
    }
    return { imgs, pdfs, docs: wordDocs };
  }

  async function handleFiles(files: FileList | null) {
    const { imgs, pdfs, docs } = await convertFiles(files);
    if (imgs.length) setPendingImages((p) => [...p, ...imgs].slice(0, 3));
    if (pdfs.length) setPendingFiles((p) => [...p, ...pdfs].slice(0, 3));
    if (docs.length) setPendingDocs((p) => [...p, ...docs].slice(0, 3));
  }

  // 회원 정보 + 비회원이 본 공고(임시) 불러오기
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEAD_KEY);
      if (raw) {
        const l = JSON.parse(raw) as Lead;
        if (l?.id) {
          setLead(l);
          refreshSaved(l.id);
        }
      }
      const v = sessionStorage.getItem(VIEWED_KEY);
      if (v) setViewed(JSON.parse(v));
    } catch {
      /* ignore */
    }
  }, []);

  // 공고를 '보면' 자동으로 캘린더에 모음 (회원이면 서버, 비회원이면 이 브라우저 임시)
  function viewProgram(p: Program) {
    if (collectedIds.has(p.id)) return;
    if (lead) {
      doSave(lead.id, p);
      return;
    }
    setViewed((prev) => {
      if (prev.some((v) => v.id === p.id)) return prev;
      const next = [
        ...prev,
        {
          id: p.id,
          title: p.title,
          applyEnd: p.applyEnd,
          url: p.url,
          supportField: p.supportField,
          region: p.region,
          savedAt: Date.now(),
        },
      ];
      try {
        sessionStorage.setItem(VIEWED_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function refreshSaved(leadId: string) {
    try {
      const res = await fetch(`/api/calendar/list?leadId=${encodeURIComponent(leadId)}`);
      const d = await res.json();
      setSaved(Array.isArray(d.saved) ? d.saved : []);
    } catch {
      /* ignore */
    }
  }

  async function doSave(leadId: string, p: Program) {
    try {
      await fetch("/api/calendar/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          program: {
            id: p.id,
            title: p.title,
            applyEnd: p.applyEnd,
            url: p.url,
            supportField: p.supportField,
            region: p.region,
          },
        }),
      });
      refreshSaved(leadId);
    } catch {
      /* ignore */
    }
  }

  async function submitSignup() {
    if (!signupName.trim() || !signupContact.trim() || !signupConsent || signupBusy) return;
    setSignupBusy(true);
    try {
      const res = await fetch("/api/lead/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: signupName,
          contact: signupContact,
          source: getLeadSource(), // UTM 기반 source (없으면 기본값은 서버에서 처리)
          consent: signupConsent,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d?.error ?? "가입에 실패했어요.");
        return;
      }
      const l = d.lead as Lead;
      setLead(l);
      try {
        localStorage.setItem(LEAD_KEY, JSON.stringify(l));
      } catch {
        /* ignore */
      }
      // 가입 전에 '본 공고들'을 서버 캘린더로 옮겨 저장
      for (const v of viewed) {
        await doSave(l.id, {
          id: v.id,
          title: v.title,
          applyEnd: v.applyEnd,
          url: v.url,
          supportField: v.supportField,
          region: v.region,
        } as Program);
      }
      setViewed([]);
      try {
        sessionStorage.removeItem(VIEWED_KEY);
      } catch {
        /* ignore */
      }
      setSignupOpen(false);
      setSignupName("");
      setSignupContact("");
      setSignupConsent(false);
      setCalendarOpen(true);
    } catch {
      alert("연결에 문제가 생겼어요. 다시 시도해 주세요.");
    } finally {
      setSignupBusy(false);
    }
  }

  async function removeSaved(programId: string) {
    if (!lead) {
      setViewed((prev) => {
        const next = prev.filter((s) => s.id !== programId);
        try {
          sessionStorage.setItem(VIEWED_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      return;
    }
    setSaved((prev) => prev.filter((s) => s.id !== programId));
    try {
      await fetch("/api/calendar/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, programId }),
      });
    } catch {
      /* ignore */
    }
  }

  // 보낸 메시지 '제자리 수정' — 내용만 고치고 나머지 대화는 그대로 둔다
  function startEdit(globalIndex: number) {
    if (busy) return;
    const m = messages[globalIndex];
    if (!m || m.role !== "user") return;
    setEditingIndex(globalIndex);
    setEditingText(m.content.replace(READY_MARK, ""));
  }
  function saveEdit() {
    if (editingIndex == null) return;
    const idx = editingIndex;
    const text = editingText.trim();
    setEditingIndex(null);
    setEditingText("");
    if (!text) return;
    if (mode === "plan") setDraftReadiness(null);
    // 결제 모달 상태 등 LLM 턴이 없는 화면에서는 내용만 교체 (기존 동작)
    if (mode === "paywall" || busy) {
      setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, content: text } : m)));
      return;
    }
    // 표준 채팅 UX(2026-07-12): 수정한 메시지 이후 대화를 잘라내고, 수정 내용 기준으로 응답 재생성.
    // 첨부(이미지·파일·문서)는 원래 메시지 것을 그대로 유지한다.
    const base = messages
      .slice(0, idx + 1)
      .map((m, i) => (i === idx ? { ...m, content: text } : m));
    if (idx + 1 < planStartIdx) setPlanStartIdx(idx + 1); // 단계 구분선이 잘린 지점 뒤로 남지 않게
    void regenerateFrom(base);
  }
  function cancelEdit() {
    setEditingIndex(null);
    setEditingText("");
  }

  // 현재 모드에 맞는 대화 턴 요청 — send()와 retryLast()가 공용으로 사용
  function turnRequest(history: Msg[]): { endpoint: string; payload: unknown } {
    const endpoint =
      mode === "plan"
        ? "/api/plan/chat"
        : mode === "fitcheck"
          ? "/api/plan/fitcheck"
          : mode === "diagnose"
            ? "/api/plan/diagnose"
            : "/api/chat";
    const payload =
      mode === "plan"
        ? { messages: lightenForPlan(history), code, program: selectedProgram, eligibility: eligReqs, provider }
        : mode === "fitcheck"
          ? { messages: foldDocs(history), program: selectedProgram, provider }
          : mode === "diagnose"
            ? { messages: foldDocs(history), program: selectedProgram, kind: "chat", provider }
            : { messages: stripImages(history), provider }; // 추천(intake)은 가벼운 텍스트만
    return { endpoint, payload };
  }

  // 응답이 끊긴 마지막 턴을 다시 시도 — 오류 말풍선을 걷어내고 같은 요청을 재실행 (2026-07-12)
  async function retryLast() {
    if (busy || turnBusyRef.current) return;
    const hist = [...messages];
    while (hist.length > 0 && hist[hist.length - 1].role === "assistant") hist.pop();
    if (hist.length === 0 || hist[hist.length - 1].role !== "user") return;
    await regenerateFrom(hist);
  }

  // 주어진 대화(마지막이 사용자 턴)를 기준으로 어시스턴트 응답을 새로 생성 — 재시도·메시지 수정 공용
  async function regenerateFrom(hist: Msg[]) {
    turnBusyRef.current = true;
    if (mode === "plan") setDraftReadiness(null);
    setRetryable(false);
    setMessages([...hist, { role: "assistant", content: "" }]);
    setBusy(true);
    const { endpoint, payload } = turnRequest(hist);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        replaceLast("응답이 끊겼어요. 다시 시도해 주세요.");
        setRetryable(true);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        replaceLast(mode === "plan" || mode === "fitcheck" ? stripEligMarks(acc) : acc);
      }
      if (!acc.trim()) {
        replaceLast("응답이 끊겼어요. 다시 시도해 주세요.");
        setRetryable(true);
        return;
      }
      const clean = absorbEligMarkers(acc);
      if (clean !== acc) replaceLast(clean);
    } catch {
      replaceLast("응답이 끊겼어요. 다시 시도해 주세요.");
      setRetryable(true);
    } finally {
      turnBusyRef.current = false;
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (
      (!text &&
        pendingImages.length === 0 &&
        pendingFiles.length === 0 &&
        pendingDocs.length === 0) ||
      busy ||
      turnBusyRef.current || // 연타 이중 전송 차단 (2026-07-12 통합진단 ⓑ)
      mode === "paywall"
    )
      return;
    turnBusyRef.current = true;
    if (mode === "plan") setDraftReadiness(null);
    // intake(추천 초기 대화)는 첨부를 모델에 보내지 않는다(stripImages 가 PDF/이미지 제거).
    // PDF·이미지만 올리면 빈 메시지가 돼 API 가 거부하므로, 에러 대신 안내하고 첨부는 떼어낸다.
    if (mode === "intake" && (pendingFiles.length > 0 || pendingImages.length > 0)) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "📄 사진·PDF 같은 첨부 파일은 사업계획서 작성 단계에서 활용할게요. 지금은 간단히 텍스트로 알려주세요!",
        },
      ]);
      setPendingFiles([]);
      setPendingImages([]);
      turnBusyRef.current = false;
      return;
    }
    const userMsg: Msg = {
      role: "user",
      content: text,
      ...(pendingImages.length > 0 ? { images: pendingImages } : {}),
      ...(pendingFiles.length > 0 ? { files: pendingFiles } : {}),
      ...(pendingDocs.length > 0 ? { docs: pendingDocs } : {}),
    };
    // GA4: 인테이크 단계에서 사용자가 첫 답변을 입력한 순간(세션당 1회)
    if (mode === "intake" && !chatStartedRef.current && text) {
      chatStartedRef.current = true;
      track("chat_started");
    }
    const history = [...messages, userMsg];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setPendingImages([]);
    setPendingFiles([]);
    setPendingDocs([]);
    setBusy(true);
    setRetryable(false);

    const { endpoint, payload } = turnRequest(history);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        replaceLast("잠시 너무 많이 사용했어요. 잠깐 쉬었다가 다시 해주세요 🙏");
        setRetryable(true);
        return;
      }
      if (res.status === 402) {
        // 서버가 사유(이용권 소진 등)를 보내면 그대로 노출 (2026-07-13)
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        replaceLast(
          typeof d?.error === "string"
            ? d.error
            : "이 기능은 결제 확인이 필요해요. 상단 [💳 결제 확인]에서 그로블 주문번호를 입력해 주세요.",
        );
        return;
      }
      if (!res.ok || !res.body) {
        // 서버가 이유를 담아 보낸 경우(JSON error) 그대로 보여준다 — generic 문구가 원인을 가리면 안 됨.
        // (2026-07-11: OPENAI 키 미설정 503이 "답변을 가져오지 못했어요"로만 보이던 문제)
        const serverMsg = await res
          .json()
          .then((d) => (typeof d?.error === "string" ? d.error : null))
          .catch(() => null);
        if (res.status === 503 && provider === "openai") {
          setProvider("claude"); // 미설정 프로바이더에 갇히지 않게 자동 복귀
          replaceLast(
            `${serverMsg ?? "ChatGPT 연결이 아직 준비되지 않았어요."}\n\nClaude로 바꿔뒀어요 — 방금 질문을 한 번만 다시 보내주세요!`,
          );
          return;
        }
        replaceLast(serverMsg ?? "죄송해요, 답변을 가져오지 못했어요. 다시 시도해 주세요.");
        setRetryable(true);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        replaceLast(mode === "plan" || mode === "fitcheck" ? stripEligMarks(acc) : acc);
      }
      // 빈 응답으로 정상 종료(스트림 중단·무응답) — "..."로 멈춰 보이던 버그 (2026-07-12)
      if (!acc.trim()) {
        replaceLast("응답이 끊겼어요. 다시 시도해 주세요.");
        setRetryable(true);
        return;
      }
      // 자격 마커 흡수(2026-07-12) — 판정 상태 갱신 + 화면에서 마커 제거
      if (mode === "plan" || mode === "fitcheck") {
        const clean = absorbEligMarkers(acc);
        if (clean !== acc) replaceLast(clean);
      }
      // GA4: 검증 질문까지 마쳐 추천 준비 완료(1막+1.5막 통과 신호) — 세션당 1회
      if (mode === "intake" && !validationFiredRef.current && acc.includes(READY_MARK)) {
        validationFiredRef.current = true;
        track("validation_answered");
      }
    } catch {
      replaceLast("응답이 끊겼어요. 다시 시도해 주세요.");
      setRetryable(true);
    } finally {
      turnBusyRef.current = false;
      setBusy(false);
    }
  }

  async function fetchRecs(append: boolean) {
    // ref 가드(2026-07-12): 빠른 연속 클릭 시 state 갱신 전에 두 번 실행돼
    // "딱 맞는 사업이 안 보여요"가 이중 출력되던 버그 — 동기 가드로 차단
    if (mode !== "intake" || drafting || recommendingRef.current || busy) return;
    recommendingRef.current = true;
    setRecommending(true);
    if (!append) setRecs(null);
    try {
      const excludeIds = append && recs ? recs.map((r) => r.program.id) : [];
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({
          messages: stripImages(messages),
          provider,
          excludeIds,
          // 사전 필터용(지역·단계·연령). 3문항 폼을 안 거쳤으면 버튼 플로우(찾기 4단계)에서
          // 확정한 지역을 폴백으로 — 위저드→챗 전환 시 지역이 빈 값으로 나가던 구멍 (2026-07-14 P1)
          profile: profile ?? (findCache?.region ? { region: findCache.region } : undefined),
          buttonYears: findCache?.years, // 버튼 플로우에서 확정한 업력 — 대화 경로도 같은 프로필을 읽는다
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: data?.error ?? "추천을 가져오지 못했어요." }]);
        return;
      }
      setUsingSample(Boolean(data.usingSample));
      const incoming: Recommendation[] = Array.isArray(data.recommendations) ? data.recommendations : [];
      if (append) {
        if (incoming.length === 0) {
          const emptyMsg =
            "음, 더 찾아봤는데 추가로 딱 맞는 사업이 안 보여요. 대화를 조금 더 들려주시면 다시 찾아볼게요!";
          // 같은 안내가 연속으로 두 번 쌓이지 않게 — 공백 차이까지 무시하고 비교 (2026-07-12 QA #5)
          setMessages((m) =>
            m[m.length - 1]?.content.trim() === emptyMsg
              ? m
              : [...m, { role: "assistant", content: emptyMsg }],
          );
        } else {
          setRecs((prev) => {
            const seen = new Set((prev ?? []).map((r) => r.program.id));
            return [...(prev ?? []), ...incoming.filter((r) => !seen.has(r.program.id))];
          });
        }
      } else {
        setRecs(incoming);
        // 0건이면 근접 공고(마감/모집 전 라벨)로 리드 수집 흐름 노출
        setNearMisses(
          incoming.length === 0 && Array.isArray(data.nearMisses) ? (data.nearMisses as Program[]) : [],
        );
      }
      // GA4: 공고 추천이 화면에 뜬 순간 / 0건 발생 측정
      if (incoming.length > 0) track("recommendation_shown", { count: incoming.length, more: append });
      else if (!append) track("recommendation_empty");
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "추천을 가져오는 중 연결이 끊겼어요." }]);
    } finally {
      recommendingRef.current = false;
      setRecommending(false);
    }
  }
  const recommend = () => fetchRecs(false);
  const recommendMore = () => fetchRecs(true);

  function focusInput() {
    setTimeout(() => {
      inputRef.current?.focus();
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, 350);
  }

  // "이건 말고 맞는 사업 찾아줘" → 버튼 4단계 찾기 위저드 (2026-07-12: LLM 채팅 인테이크 대체)
  function switchToFind() {
    setMode("intake");
    setSelectedProgram(null);
    setRecs(null);
    setDraft(null);
    setCharts(null);
    resetEvidence();
    setWizAnalysis({ text: "", busy: false });
    setWizardStart("find");
  }

  // '직접 올린 공고' 프로그램 세팅 — 위저드 도움 방식 2(정한 공고 진단)의 공통 준비
  function makeCustomProgram() {
    const custom: Program = {
      id: `custom:${genId()}`,
      title: "직접 올린 안내문·작성 파일",
      summary: "",
      target: "",
      supportField: "",
      region: "",
      applyEnd: null,
      url: "",
      formUrl: null,
      source: "sample",
    };
    setSelectedProgram(custom);
    persistProgram(custom);
    setMode("fitcheck");
    setDraft(null);
    setCharts(null);
    resetEvidence();
    resetEligibility();
    setWizAnalysis({ text: "", busy: false });
    setMessages((m) => {
      setPlanStartIdx(m.length);
      return m;
    });
  }

  // 선택 공고 세션 보존 — 화면 이동·뒤로가기·새로고침에도 유지 (2026-07-12)
  function persistProgram(p: Program | null) {
    try {
      if (p) sessionStorage.setItem(SELPROG_KEY, JSON.stringify(p));
      else sessionStorage.removeItem(SELPROG_KEY);
    } catch {
      /* ignore */
    }
  }

  // 추천을 거치지 않고, 사용자가 가진 공고문/양식으로 바로 시작 → 위저드 '공고 입력'부터
  function startDirect() {
    track("plan_writing_started", { program: "직접 올린 안내문·작성 파일" });
    makeCustomProgram();
    setWizardStart("notice");
  }

  // ① (무료) 추천에서 공고 선택 → 위저드 '공고 입력'부터 (2026-07-12 단계형 전환)
  function chooseProgram(p: Program) {
    track("plan_writing_started", { program: p.title ?? "" });
    setSelectedProgram(p);
    persistProgram(p);
    setMode("fitcheck");
    setDraft(null);
    setCharts(null);
    resetEvidence();
    resetEligibility();
    setWizAnalysis({ text: "", busy: false });
    setMessages((m) => {
      setPlanStartIdx(m.length); // 이 사업 단계의 시작점
      return m;
    });
    setWizardStart("notice");
  }

  // ── 합격 가능성 진단 (2026-07-10 확정 설계) ──────────────────────────
  // 버튼식 2화면(월매출 + 확보 실적) → 매핑표(evidence_map)로 진단지 즉시 생성.
  // 이메일 게이트 폐지: 진입 회원가입 필수(2026-07-09 ③)라 이메일은 이미 계정에 있다.
  function resetEvidence() {
    setEvResult(null);
    setEvPrograms(null);
    setEvProgramsLoading(false);
    setPreviewOpen(false);
  }

  async function loadEvidenceMap() {
    setEvMapError(false);
    try {
      const res = await fetch("/api/evidence-map");
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(d?.rows)) throw new Error("map load failed");
      setEvMap(d.rows as EvidenceRow[]);
    } catch {
      if (localReview) {
        setEvMap(LOCAL_REVIEW_EVIDENCE_ROWS);
        setEvMapError(false);
      } else {
        setEvMapError(true);
      }
    }
  }

  // 위저드가 열리면 매핑표를 미리 불러둔다 (진단 단계 도달 전에 준비)
  useEffect(() => {
    if (wizardActive && !evMap) void loadEvidenceMap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardActive]);

  // 위저드 화면 2~3에서 모은 공고문·양식을 AI가 읽는다 (스트리밍).
  // 대화 기록(messages)에도 그대로 남겨서, 결제 후 사업계획서 작성이 이 맥락을 이어받는다.
  async function wizardAnalyze(payload: WizPayload, note: string) {
    // 양식 목차 결정적 추출 — 역할이 지정된 양식 파일에서, 없으면 업로드된 문서 전체에서
    const roleM = note.match(/'([^']+)'\s*파일이 사업계획서 양식/);
    const formDocs = roleM ? payload.docs.filter((d) => d.name === roleM[1]) : payload.docs;
    const toc = sanitizeFormToc(formDocs.flatMap((d) => extractFormHeadings(d.text)));
    if (toc.length >= 3) setFormToc(toc);

    const base =
      "올린 안내문과 작성할 파일을 읽고 알려주세요: ① 무엇을 도와주는지 ② 지금 정보로 내가 신청해도 되는지 ③ 어떤 내용을 준비해야 하는지. 어려운 말은 일상적인 말로 바꿔서 짧게 알려주세요.";
    const content = note.trim() ? `[안내문 링크/설명] ${note.trim()}\n\n${base}` : base;
    const userMsg: Msg = {
      role: "user",
      content,
      ...(payload.imgs.length > 0 ? { images: payload.imgs } : {}),
      ...(payload.pdfs.length > 0 ? { files: payload.pdfs } : {}),
      ...(payload.docs.length > 0 ? { docs: payload.docs } : {}),
    };
    const history = [...messages, userMsg];
    if (localReview) {
      const reviewText = selectedProgram
        ? `${plainProgramExplanation(selectedProgram)}\n\n로컬 검사에서는 외부 AI를 호출하지 않습니다. 실제 서비스에서는 안내문을 읽고 내가 신청해도 되는지와 준비할 내용을 쉬운 말로 정리합니다.`
        : "로컬 검사에서는 외부 AI를 호출하지 않습니다. 실제 서비스에서는 안내문을 쉬운 말로 정리합니다.";
      setMessages([...history, { role: "assistant", content: reviewText }]);
      setWizAnalysis({ text: reviewText, busy: false });
      return;
    }
    setMessages([...history, { role: "assistant", content: "" }]);
    setWizAnalysis({ text: "", busy: true });
    try {
      const res = await fetch("/api/plan/fitcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({ messages: foldDocs(history), program: selectedProgram, provider }),
      });
      if (!res.ok || !res.body) {
        const fail = "안내문을 읽지 못했어요. 준비 상태는 그대로 확인할 수 있고, 결제 전 대화에서 다시 올려주시면 돼요.";
        replaceLast(fail);
        setWizAnalysis({ text: "", busy: false });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        replaceLast(stripEligMarks(acc));
        setWizAnalysis({ text: acc, busy: true });
      }
      // 자격요건 마커 흡수(2026-07-12) — 구조화 요건 저장 + 화면 텍스트에서 제거
      const clean = absorbEligMarkers(acc);
      if (clean !== acc) replaceLast(clean);
      setWizAnalysis({ text: clean, busy: false });
    } catch {
      replaceLast("안내문을 읽는 중 연결이 끊겼어요.");
      setWizAnalysis((prev) => ({ ...prev, busy: false }));
    }
  }

  // 진단 시작 — 버튼 폼을 띄운다 (타이핑 없음, LLM 호출 없음)
  function enterDiagnose() {
    setMode("diagnose");
    resetEvidence();
    if (!evMap) void loadEvidenceMap();
    track("start_diagnosis", { program: selectedProgram?.title ?? "" });
    setMessages((m) => [...m, { role: "assistant", content: DIAGNOSE_INTRO }]);
  }

  // 화면 2 제출 → 로그인 게이트 B안: 결과 보기 직전이 게이트 지점.
  // 미로그인이면 답변을 보관하고 로그인 모달 → 성공 시 doSubmitEvidence 로 이어간다.
  function submitEvidence(revenue: string, items: string[]) {
    if (!session && !localReview) {
      setPendingEvidence({ revenue, items });
      setAuthOpen(true);
      return;
    }
    doSubmitEvidence(revenue, items);
  }

  // 분기 실행: 실적 1개 이상 = 진단지 / 실적 0개 = pre 전용 화면
  function doSubmitEvidence(revenue: string, items: string[]) {
    // 체크 조합이 곧 시장 데이터 (GA4 이벤트 파라미터는 스칼라만 — 콤마 문자열로)
    const realItems = items.filter((i) => i !== "해당 없음");
    // 진단 답변을 대화 기록에 남긴다 — 결제 후 사업계획서 작성이 이 정보를 이어받는다
    setMessages((prev) => [
      ...prev,
      { role: "user", content: `[신청 준비 확인] 한 달 평균 판매 금액: ${revenue} / 지금까지 해낸 일: ${items.join(", ")}` },
    ]);
    track("evidence_check", {
      items: items.join(","),
      count: realItems.length,
      revenue,
    });

    if (isPreStage(items)) {
      // 아직 실적이 쌓이기 전 단계 — 유료 CTA 노출 금지, leads stage='pre' 저장
      setEvResult({ kind: "pre" });
      track("no_evidence_view");
      void (async () => {
        try {
          await fetch("/api/lead/prestage", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
          });
        } catch {
          /* 기록 실패는 화면 흐름에 영향 없음 */
        }
      })();
      setEvProgramsLoading(true);
      fetch("/api/programs/pre")
        .then((r) => r.json())
        .then((d) => setEvPrograms(Array.isArray(d?.programs) ? d.programs : []))
        .catch(() => setEvPrograms([]))
        .finally(() => setEvProgramsLoading(false));
    } else {
      const sheet = buildSheet(evMap ?? [], items);
      setEvResult({ kind: "sheet", sheet });
      setKitSheet(sheet); // 완성 키트용 — 결제 후에도 유지
      track("view_diagnosis_result", { program: selectedProgram?.title ?? "" });
    }
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }

  // 무료 결과 → 초안 미리보기 (2026-07-11 디자인수정 3순위)
  // 결제 전에 목차·예시 문장을 먼저 보여준다. 여기서는 아직 결제를 요구하지 않는다.
  function openPreview() {
    track("draft_preview_click", { program: selectedProgram?.title ?? "" });
    setPreviewOpen(true);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 100);
  }

  // 결제 트리거 — PRICE_LABEL 가격 버튼. 초안 미리보기를 확인한 뒤에만 도달한다. (// TODO: PG 연동 자리)
  // 이메일은 진단 전 게이트에서 이미 받았으므로 결제 단계에선 추가 가입을 받지 않는다.
  async function clickPay() {
    if (!selectedProgram || selectedProgram.requiresBusinessPlan !== true) {
      alert(
        selectedProgram?.requiresBusinessPlan === false
          ? "이 지원은 긴 사업계획서가 필요하지 않아요. 공식 안내문에서 바로 신청해 주세요."
          : "긴 사업계획서가 필요한 지원인지 무료 확인부터 해주세요.",
      );
      return;
    }
    track("click_pay", { program: selectedProgram?.title ?? "", price: PRICE_KRW });
    track("checkout_start", { program: selectedProgram?.title ?? "", price: PRICE_KRW });
    // 이미 결제 확인(is_paid)된 계정: 이용권 소진 상태를 확인하고 진입 (2026-07-13)
    // 이용권 1건 = 초안 1건 — 다른 공고에 이미 사용했으면 추가 결제(paywall)로 라우팅.
    if (paid && selectedProgram) {
      try {
        const res = await fetch("/api/order/verify", { headers: await authedHeaders() });
        const d = (await res.json().catch(() => ({}))) as { usedProgramId?: string | null };
        if (d?.usedProgramId && d.usedProgramId !== selectedProgram.id) {
          setNeedsRepurchase(true); // 이 공고는 소진된 이용권으로는 못 씀 — 새 주문번호 입력폼 노출
          setMode("paywall");
          return;
        }
      } catch {
        /* 조회 실패 시엔 일단 진입 — 서버 관문(checkDraftAccess)이 최종 차단한다 */
      }
      await enterPlanMode(selectedProgram);
      return;
    }
    setMode("paywall");
  }

  // ③ (결제 후) 본격 작성 시작 — 앞서 올린 문서/대화를 그대로 이어서.
  // 정적 안내만 내보내고 끝나면 "답해 주세요"만 나가고 질문이 없다(2026-07-12 버그) —
  // 반드시 kickoffPlan()으로 서버가 첫 턴(자격 판정 → 첫 질문)을 즉시 생성하게 한다.
  async function enterPlanMode(p: Program) {
    const kickoffKey = `${convoId}:${p.id}`;
    if (planKickoffRef.current === kickoffKey) return;
    planKickoffRef.current = kickoffKey;

    // 결제 완료 측정 — 현재는 코드 검증 통과 시점. (// TODO: PG 연동 후 실제 결제 완료로 교체)
    track("complete_payment", { program: p.title ?? "", price: PRICE_KRW });
    setWizardStart(null); // 위저드 종료 → 결제 후 작성은 챗에서 이어간다
    setMode("plan");
    setDraft(null);
    setCharts(null);
    setPlanReview(null);
    setDraftReadiness(null);
    resetEvidence();
    setKickoffError(null);
    setSelectedProgram(p);
    persistProgram(p);

    // setState 직후 오래된 messages 클로저를 읽으면 첫 질문이 빈 응답 슬롯과 엇갈려 사라진다.
    // 결제 안내·빈 슬롯·API 입력이 모두 같은 스냅샷을 사용하도록 고정한다.
    const paidNotice: Msg = {
      role: "assistant",
      content: `✅ 결제가 확인됐어요! 이제 '${p.title}'의 공고·평가기준에 맞춰, 심사위원이 점수를 줄 수 있는 답변부터 함께 만들게요. 📝\n\n⚠️ 사업계획서의 모든 내용은 사실이어야 합니다. 허위 기재는 선정 취소·지원금 환수·형사처벌 사유가 됩니다. 본인이 설명하고 증빙할 수 있는 내용만 답해 주세요.`,
    };
    const kickoffBase = [...messages, paidNotice];
    setMessages([...kickoffBase, { role: "assistant", content: "" }]);
    await kickoffPlan(p, kickoffBase, kickoffKey);
    focusInput();
  }

  // 결제 직후 첫 턴을 서버가 먼저 시작한다 — 자격 요건이 있으면 판정부터, 없으면 첫 질문부터.
  // (트리거 지시문은 화면·저장 대화에는 남기지 않는다)
  async function kickoffPlan(p: Program, baseHistory: Msg[], kickoffKey: string) {
    const instruction: Msg = {
      role: "user",
      content:
        "(시작 신호) 결제가 확인되었습니다. 지금까지 올린 안내문·작성 파일과 제 답변을 바탕으로 시작해 주세요. 신청 조건이 있다면 이미 아는 정보로 먼저 확인하거나 필요한 질문부터 하고, 그다음 첫 질문을 하나만 해주세요. 더 물어볼 것이 없다면 '사업계획서 초안 만들기' 버튼을 누르라고 안내해 주세요.",
    };
    const history = [...baseHistory, instruction];
    setBusy(true);
    try {
      const res = await fetch("/api/plan/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({
          messages: lightenForPlan(history),
          code,
          program: p,
          eligibility: eligReqs,
          provider,
        }),
      });
      if (!res.ok || !res.body) {
        if (res.status === 402) {
          const d = (await res.json().catch(() => null)) as { error?: string } | null;
          replaceLast(typeof d?.error === "string" ? d.error : "결제 확인이 필요해요.");
          return;
        }
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        replaceLast(data?.error ?? "첫 작성 질문을 불러오지 못했어요. 아래 버튼으로 다시 시도해 주세요.");
        setKickoffError(data?.error ?? "첫 작성 질문을 불러오지 못했어요.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        replaceLast(stripEligMarks(acc));
      }
      if (!acc.trim()) {
        const message = "첫 작성 질문 응답이 끊겼어요. 아래 버튼으로 다시 시작할 수 있습니다.";
        replaceLast(message);
        setKickoffError(message);
        return;
      }
      const clean = absorbEligMarkers(acc);
      if (clean !== acc) replaceLast(clean);
    } catch {
      const message = "첫 작성 질문을 불러오는 중 연결이 끊겼어요. 아래 버튼으로 다시 시작할 수 있습니다.";
      replaceLast(message);
      setKickoffError(message);
    } finally {
      if (planKickoffRef.current === kickoffKey) planKickoffRef.current = null;
      setBusy(false);
    }
  }

  async function retryPlanKickoff() {
    if (!selectedProgram || busy || planKickoffRef.current) return;
    const kickoffKey = `${convoId}:${selectedProgram.id}:retry`;
    planKickoffRef.current = kickoffKey;
    setKickoffError(null);
    const baseHistory = messages.filter(
      (message, index) => !(index === messages.length - 1 && message.role === "assistant"),
    );
    setMessages([...baseHistory, { role: "assistant", content: "" }]);
    await kickoffPlan(selectedProgram, baseHistory, kickoffKey);
    focusInput();
  }

  // 결제 화면 닫기 — 진단 결과(미리보기)에서 왔다면 그 화면으로 되돌린다
  function closePaywall() {
    setPayOpen(false);
    if (mode === "paywall") setMode(evResult ? "diagnose" : "fitcheck");
  }

  // 그로블 주문번호 인증 (2026-07-09 ③ 결정: 셀프서비스 주문번호 인증)
  async function verifyOrder(orderNo: string): Promise<{ ok: boolean; error?: string }> {
    let res = await fetch("/api/order/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
      body: JSON.stringify({ orderNo }),
    });
    if (res.status === 401) {
      // 세션 만료 가능성 — 리프레시 토큰으로 강제 갱신 후 1회 재시도
      const fresh = await forceRefreshToken();
      if (fresh) {
        res = await fetch("/api/order/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${fresh}` },
          body: JSON.stringify({ orderNo }),
        });
      }
      if (res.status === 401) {
        // 갱신도 실패 — UI 를 실제 상태(로그아웃)와 일치시킨다
        await signOut();
        return { ok: false, error: "세션이 만료됐어요. 다시 로그인한 뒤 주문번호를 입력해 주세요." };
      }
    }
    const data = await res.json().catch(() => ({}));
    if (data?.ok) {
      setPaid(true);
      setNeedsRepurchase(false); // 새 주문번호로 이용권 교체됨 — 다음 진입은 정상 paid 화면
      setReturningFromPayment(false);
      try {
        localStorage.removeItem(CHECKOUT_STARTED_KEY);
      } catch {
        /* ignore */
      }
      // GA4 퍼널: 재구매 갱신과 최초 전환은 다른 이벤트로 구분 (QA 테스트 세션은 둘 다 측정 제외)
      if (!data.isQa) {
        if (data.renewed) track("repurchase_verified", { price: PRICE_KRW });
        else track("order_verified", { price: PRICE_KRW });
      }
      return { ok: true };
    }
    return { ok: false, error: String(data?.error || "확인에 실패했어요. 다시 시도해 주세요.") };
  }

  async function checkPlanReadiness(): Promise<PlanReadinessAssessment | null> {
    if (!selectedProgram) return null;
    setReadinessChecking(true);
    try {
      const res = await fetch("/api/plan/readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({
          messages: [...summaryHead(), ...stripImages(messages)],
          code,
          program: selectedProgram,
          formToc,
          provider,
        }),
      });
      const data = (await res.json().catch(() => null)) as (PlanReadinessAssessment & { error?: string }) | null;
      if (!res.ok || !data) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data?.error ?? "작성 준비도를 점검하지 못했어요. 잠시 후 다시 눌러주세요.",
          },
        ]);
        return null;
      }
      const missing = Array.from(new Set([...data.criticalGaps, ...data.nextQuestions])).slice(0, 7);
      setDraftReadiness({ ready: data.ready, score: data.score, missing: data.ready ? [] : missing });
      if (!data.ready) {
        const questions = missing.length
          ? missing.map((item, index) => `${index + 1}. ${item}`).join("\n")
          : "심사에서 판단할 수 있는 실제 상황·숫자·확인 자료를 더 알려주세요.";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `심사위원 관점으로 다시 점검해 보니 아직 초안을 만들기보다 먼저 채워야 할 내용이 있어요.\n\n${data.verdict}\n\n${questions}\n\n위에서 가장 먼저 답할 수 있는 것부터 하나씩 알려주세요.`,
          },
        ]);
      }
      return data;
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "작성 준비도 점검 중 연결이 끊겼어요. 잠시 후 다시 눌러주세요." },
      ]);
      return null;
    } finally {
      setReadinessChecking(false);
    }
  }

  async function auditDraftSections(sections: DraftSection[]): Promise<PlanReviewReport | null> {
    if (!selectedProgram || sections.length === 0) return null;
    setReviewingDraft(true);
    try {
      const res = await fetch("/api/plan/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({
          messages: [...summaryHead(), ...stripImages(messages)],
          sections,
          code,
          program: selectedProgram,
          formToc,
          provider,
        }),
      });
      const data = (await res.json().catch(() => null)) as (PlanReviewReport & { error?: string }) | null;
      if (!res.ok || !data) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data?.error ?? "초안 모의심사를 완료하지 못했어요. 다시 심사해 주세요." },
        ]);
        return null;
      }
      setPlanReview(data);
      return data;
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "초안 모의심사 중 연결이 끊겼어요. 초안 아래에서 다시 심사할 수 있어요." },
      ]);
      return null;
    } finally {
      setReviewingDraft(false);
    }
  }

  async function generateDraft() {
    if (!selectedProgram || drafting || !(paid || code) || !draftAnswersReady) return;
    setPlanReview(null);
    const assessed = await checkPlanReadiness();
    if (!assessed?.ready) return;
    const verifiedReadiness: DraftReadiness = { ready: true, score: assessed.score, missing: [] };
    setDrafting(true);
    setCharts(null);
    const title = `${selectedProgram.title} 사업계획서`;
    const formSections = formTocToPlanSections(formToc);
    const draftPlanSections = formSections ?? PLAN_SECTIONS;
    const draftFormToc = formSections?.map((s) => s.heading) ?? [];
    const userTextForRegion = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const regionRequirementText = [
      docSummary ?? "",
      selectedProgram.target,
      selectedProgram.summary,
      ...(eligReqs?.required ?? []),
      ...(eligReqs?.disqualifiers ?? []),
      ...(eligReqs?.obligations ?? []),
    ].join("\n");
    const regionNotice = buildRegionNotice(
      regionRequirementText,
      extractBusinessRegion(userTextForRegion, profile?.region ?? null),
    );
    const regionNoticeHeading = preferredRegionNoticeHeading(draftPlanSections.map((s) => s.heading));
    const sections: DraftSection[] = [];
    setDraft({ title, sections: [] });

    for (const sec of draftPlanSections) {
      sections.push({ heading: sec.heading, content: "" });
      setDraft({ title, sections: [...sections] });
      try {
        const res = await fetch("/api/plan/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
          body: JSON.stringify({
            // 작성요약(양식 목차 포함)을 앞에 실어 초안이 공고·양식 맥락을 유지하게 (2026-07-12)
            messages: [...summaryHead(), ...stripImages(messages)],
            code,
            program: selectedProgram,
            section: { heading: sec.heading, guide: sec.guide },
            formToc: draftFormToc.length > 0 ? draftFormToc : undefined,
            readiness: verifiedReadiness,
            provider,
          }),
        });
        if (res.status === 429) {
          sections[sections.length - 1].content = "(잠시 너무 많이 사용했어요. 잠깐 후 다시 시도해 주세요.)";
          setDraft({ title, sections: [...sections] });
          break;
        }
        if (res.status === 402) {
          // 이용권 소진 등 — 서버 사유를 그대로 보여주고 중단 (2026-07-13)
          const d = (await res.json().catch(() => null)) as { error?: string } | null;
          sections[sections.length - 1].content =
            typeof d?.error === "string" ? `(${d.error})` : "(추가 이용권 결제가 필요해요.)";
          setDraft({ title, sections: [...sections] });
          break;
        }
        if (!res.ok || !res.body) {
          sections[sections.length - 1].content = "(이 항목 작성에 실패했어요.)";
          setDraft({ title, sections: [...sections] });
          continue;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          sections[sections.length - 1].content = ensureConditionalRegionNotice(
            sec.heading,
            ensureFormTableNotice(sec.heading, acc),
            regionNotice,
            regionNoticeHeading,
          );
          setDraft({ title, sections: [...sections] });
        }
        sections[sections.length - 1].content = ensureConditionalRegionNotice(
          sec.heading,
          ensureFormTableNotice(sec.heading, acc),
          regionNotice,
          regionNoticeHeading,
        );
        setDraft({ title, sections: [...sections] });
      } catch {
        sections[sections.length - 1].content = ensureConditionalRegionNotice(
          sec.heading,
          ensureFormTableNotice(sec.heading, "(이 항목 작성 중 연결이 끊겼어요.)"),
          regionNotice,
          regionNoticeHeading,
        );
        setDraft({ title, sections: [...sections] });
      }
    }

    // 도식 자료 생성 (TAM/SAM/SOM·고객여정맵·퍼널·수익모델)
    try {
      const res = await fetch("/api/plan/visuals", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
        body: JSON.stringify({
          messages: [...summaryHead(), ...stripImages(messages)],
          code,
          program: selectedProgram,
          provider,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.charts) && data.charts.length > 0) setCharts(data.charts);
      }
    } catch {
      /* 도식 실패해도 초안은 유지 */
    }

    await auditDraftSections(sections);
    setDrafting(false);
    // 결과물 도달 측정 + 만족도 최고점에 후기 팝업 (한 번만)
    track("complete_draft", { program: selectedProgram?.title ?? "" });
    if (!reviewDone) {
      track("review_prompt_shown");
      setReviewOpen(true);
    }
  }

  async function reviseDraftFromReview() {
    if (!draft || !planReview || !selectedProgram || revisingDraft || reviewingDraft) return;
    const fixable = planReview.issues.filter((item) => item.canAutoFix);
    if (fixable.length === 0) return;
    setRevisingDraft(true);
    setPlanReview(null);
    const revised = draft.sections.map((section) => ({ ...section }));
    const norm = (value: string) => value.replace(/\s+/g, "").toLowerCase();
    let revisedCount = 0;
    for (let index = 0; index < revised.length && revisedCount < 10; index++) {
      const section = revised[index];
      const findings = fixable.filter((item) => {
        if (item.section === "전체") return true;
        const issueSection = norm(item.section);
        const heading = norm(section.heading);
        return issueSection === heading || issueSection.includes(heading) || heading.includes(issueSection);
      });
      if (findings.length === 0) continue;
      revisedCount++;
      try {
        const res = await fetch("/api/plan/revise", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
          body: JSON.stringify({
            messages: [...summaryHead(), ...stripImages(messages)],
            code,
            program: selectedProgram,
            section: { heading: section.heading },
            currentContent: section.content,
            findings,
            provider,
          }),
        });
        if (!res.ok || !res.body) continue;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          revised[index].content = acc;
          setDraft({ ...draft, sections: revised.map((item) => ({ ...item })) });
        }
      } catch {
        /* 해당 항목 원문을 유지하고 나머지 수정은 계속 */
      }
    }
    const revisedDraft = { ...draft, sections: revised };
    setDraft(revisedDraft);
    setRevisingDraft(false);
    await auditDraftSections(revised);
  }

  // 후기 저장 — 구글시트(GAS) 또는 Upstash로 영구 저장
  async function submitReview(payload: {
    rating: number;
    tags: string[];
    comment: string;
    publicConsent: boolean;
  }): Promise<boolean> {
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          bizField: selectedProgram?.title ?? "",
          name: lead?.name ?? "",
        }),
      });
      if (!res.ok) return false;
      track("review_submitted", { rating: payload.rating });
      if (payload.publicConsent) track("review_public_consent");
      setReviewDone(true);
      return true;
    } catch {
      return false;
    }
  }

  async function downloadDocx() {
    if (!draft || !(paid || code)) return;
    // 자격 미충족·불확실 강행 시 — 문서 맨 앞에도 경고 섹션을 넣는다 (2026-07-12)
    const eligWarnSections: DraftSection[] =
      eligOverride && (eligStatus === "미충족" || eligStatus === "불확실")
        ? [
            {
              heading: "⚠️ 신청 자격 확인 필요",
              content: `이 초안은 신청 자격이 ${
                eligStatus === "미충족" ? "충족되지 않은" : "확인되지 않은"
              } 상태에서 작성되었습니다. 제출 전에 공고문의 신청 자격 요건(업력·매출·투자 실적·추천서 등)을 반드시 직접 확인하세요.`,
            },
          ]
        : [];
    const res = await fetch("/api/plan/docx", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authedHeaders()) },
      body: JSON.stringify({
        code,
        programId: selectedProgram?.id,
        title: draft.title,
        sections: [
          ...eligWarnSections,
          ...draft.sections,
          ...(planReview ? reviewReportSections(planReview) : []),
        ],
        charts: charts ?? [],
      }),
    });
    if (!res.ok) {
      alert("다운로드에 실패했어요. 다시 시도해 주세요.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.title}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <main className="relative flex h-[100dvh] flex-col overflow-hidden bg-white">
      <header className="border-b border-zinc-100 px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <button
              onClick={() => setHistoryOpen(true)}
              title="내 대화 기록"
              data-tour="history"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
            >
              🕘
            </button>
            <button
              onClick={() => setCalendarOpen(true)}
              title="내 관심사업 캘린더"
              className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
            >
              📅
              {calItems.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white">
                  {calItems.length}
                </span>
              )}
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight">딱, 지원핏</h1>
              <p className="mt-0.5 text-xs text-zinc-500">
                사업 얘기만 해주세요. 어려운 말은 딱지원핏이 바꿔드릴게요.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => {
                setNeedsRepurchase(false); // 상단 메뉴는 일반 상태 확인 — 소진 입력폼으로 고정되지 않게
                setPayOpen(true);
              }}
              title="그로블 주문번호로 결제 확인"
              className={`flex h-8 items-center rounded-lg px-2 text-xs font-semibold ${
                paid ? "text-emerald-600 hover:bg-emerald-50" : "text-blue-600 hover:bg-blue-50"
              }`}
            >
              💳 결제 확인{paid ? " ✓" : ""}
            </button>
            {localReview ? (
              <span className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-700">
                로컬 검사
              </span>
            ) : session ? (
              <button
                onClick={() => void signOut()}
                title={email ? `${email} 로그아웃` : "로그아웃"}
                className="flex h-8 items-center rounded-lg px-2 text-xs font-medium text-zinc-400 hover:bg-zinc-100"
              >
                로그아웃
              </button>
            ) : (
              <button
                onClick={() => setAuthOpen(true)}
                title="로그인하면 확인 결과와 결제 내역이 계정에 연결돼요"
                className="flex h-8 items-center rounded-lg px-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
              >
                로그인
              </button>
            )}
            <button
              onClick={startTour}
              title="사용법 다시 보기"
              className="flex h-8 items-center rounded-lg px-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100"
            >
              ❓ 사용법
            </button>
            {/* AI 토글 숨김 (2026-07-11): OPENAI_API_KEY 미등록 상태라 당분간 Claude 전용.
                ChatGPT를 다시 열려면 Vercel에 키 등록 후 이 자리에 토글 복원 (git 이력 참고). */}
          </div>
        </div>
      </header>

      {localReview && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-xs font-semibold text-amber-800">
          배포 전 로컬 검사 화면 · 로그인·결제·외부 AI 호출 없이 사용자 흐름만 확인합니다
        </div>
      )}

      {/* 선택한 공고 고정 배너(2026-07-12) — 화면 이동·뒤로가기에도 유지, 언제든 진단 복귀 */}
      {selectedProgram && wizardStart !== "notice" && mode !== "plan" && mode !== "paywall" && (
        <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50 px-5 py-2 text-xs text-blue-900">
          <span className="min-w-0 flex-1 truncate">
            📌 선택한 지원: <b>{selectedProgram.title}</b>
          </span>
          <button
            onClick={() => setWizardStart("notice")}
            className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700"
          >
            내가 신청해도 되는지 확인하기 →
          </button>
        </div>
      )}
      {mode === "diagnose" && !wizardActive && (
        <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-2.5 text-xs font-semibold text-emerald-800">
          📋 신청 준비 확인 · <span className="text-emerald-900">{selectedProgram?.title}</span> — 지금까지
          해낸 일과 더 준비할 내용을 쉬운 말로 정리해드려요 (결제 전, 무료)
        </div>
      )}
      {mode === "plan" && (
        <div className="border-b border-blue-100 bg-blue-50 px-5 py-2.5 text-xs font-semibold text-blue-800">
          ✅ 이용권 확인 완료 · <span className="text-blue-900">{selectedProgram?.title}</span> 문서 작성 중 —
          대표님 사업 얘기만 편하게 들려주세요 ↓
        </div>
      )}

      {historyOpen && (
        <div className="absolute inset-0 z-30 flex">
          <div className="flex-1 bg-black/20" onClick={() => setHistoryOpen(false)} />
          <div className="flex w-64 max-w-[80%] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
              <span className="text-sm font-semibold">내 대화 기록</span>
              <button onClick={() => setHistoryOpen(false)} className="text-zinc-400 hover:text-zinc-700">
                ✕
              </button>
            </div>
            <button
              onClick={newChat}
              className="m-2 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              ＋ 새 대화 시작
            </button>
            <div className="flex-1 overflow-y-auto">
              {convos.length === 0 && (
                <p className="px-3 py-4 text-xs text-zinc-400">저장된 대화가 아직 없어요.</p>
              )}
              {convos.map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-1 px-2 ${c.id === convoId ? "bg-blue-50" : ""}`}
                >
                  <button
                    onClick={() => loadChat(c)}
                    className="flex-1 truncate py-2.5 text-left text-sm text-zinc-700"
                  >
                    {c.title}
                  </button>
                  <button
                    onClick={() => deleteChat(c.id)}
                    title="삭제"
                    className="shrink-0 px-1 text-zinc-300 hover:text-red-500"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {((mode === "paywall" && selectedProgram) || payOpen) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closePaywall}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closePaywall}
              aria-label="닫기"
              className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            >
              ✕
            </button>
            <Paywall
              program={mode === "paywall" ? selectedProgram : null}
              paid={paid && !needsRepurchase}
              loggedIn={Boolean(session)}
              returningFromPayment={returningFromPayment}
              onRequireLogin={() => {
                setPayOpen(false);
                setPaymentAfterAuth(true);
                setAuthOpen(true);
              }}
              onUnlock={() => {
                setPayOpen(false);
                setNeedsRepurchase(false);
                if (mode === "paywall" && selectedProgram) void enterPlanMode(selectedProgram);
              }}
              onCancel={closePaywall}
              verifyOrder={verifyOrder}
            />
          </div>
        </div>
      )}

      {/* 로그인 게이트 B안 — 진단 결과 보기 직전. 성공 시 보관한 답변으로 결과 표시 */}
      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onDone={() => {
            setAuthOpen(false);
            if (paymentAfterAuth) {
              setPaymentAfterAuth(false);
              setPayOpen(true);
              return;
            }
            const p = pendingEvidence;
            setPendingEvidence(null);
            if (p) doSubmitEvidence(p.revenue, p.items);
          }}
        />
      )}

      {/* 후기 수집 팝업 — 초안 완성 직후(만족도 최고점) */}
      {reviewOpen && (
        <ReviewModal
          onClose={() => setReviewOpen(false)}
          onSubmit={submitReview}
        />
      )}

      {/* 가입(간단 정보) 모달 — 관심사업 저장 시 */}
      {signupOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setSignupOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-zinc-900">💾 내 캘린더 저장하기</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              간단한 정보만 남기면, 지금까지 <b>본 공고들의 마감일을 캘린더로 모아</b> 안전하게 보관하고
              알려드려요. 비밀번호 없어요!
            </p>
            <div className="mt-4 space-y-2">
              <input
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                placeholder="이름 (예: 홍길동)"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
              <input
                value={signupContact}
                onChange={(e) => setSignupContact(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitSignup()}
                placeholder="이메일 또는 전화번호"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-zinc-600">
              <input
                type="checkbox"
                checked={signupConsent}
                onChange={(e) => setSignupConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
              />
              <span>
                <b>(필수)</b> 개인정보 수집·이용에 동의합니다. 수집 항목: 이름·연락처 / 이용 목적:
                마감 알림·맞춤 안내 / 동의 거부 시 캘린더 저장이 불가해요.
              </span>
            </label>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setSignupOpen(false)}
                className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
              >
                취소
              </button>
              <button
                onClick={submitSignup}
                disabled={signupBusy || !signupName.trim() || !signupContact.trim() || !signupConsent}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {signupBusy ? "저장 중…" : "저장하고 캘린더 담기"}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-zinc-400">
              입력하신 정보는 마감 알림·맞춤 안내에만 사용돼요.
            </p>
          </div>
        </div>
      )}

      {/* 내 관심사업 캘린더 (드로어) */}
      {calendarOpen && (
        <div className="absolute inset-0 z-40 flex">
          <div className="flex-1 bg-black/20" onClick={() => setCalendarOpen(false)} />
          <div className="flex w-80 max-w-[85%] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-3">
              <span className="text-sm font-semibold">
                📅 내 관심사업{lead ? ` · ${lead.name}님` : ""}
              </span>
              <button onClick={() => setCalendarOpen(false)} className="text-zinc-400 hover:text-zinc-700">
                ✕
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {!lead && calItems.length > 0 && (
                <button
                  onClick={() => setSignupOpen(true)}
                  className="w-full rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-700"
                >
                  💾 회원가입하고 이 캘린더 저장하기 (마감 알림 받기)
                </button>
              )}
              {!lead && calItems.length > 0 && (
                <p className="px-1 text-[11px] leading-5 text-amber-600">
                  ⚠️ 지금은 이 브라우저에만 임시 저장돼요. 가입해야 안전하게 보관돼요!
                </p>
              )}
              {calItems.length === 0 && (
                <p className="px-1 py-4 text-xs leading-5 text-zinc-400">
                  아직 살펴본 지원이 없어요. 추천에서 <b>「공식 안내문 보기」</b>를 누르면 여기 자동으로 모여요!
                </p>
              )}
              {calItems.map((s) => {
                const dl = deadlineLabel(s.applyEnd);
                return (
                  <div key={s.id} className="rounded-xl border border-zinc-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold leading-5 text-zinc-800">{s.title}</span>
                      <button
                        onClick={() => removeSaved(s.id)}
                        title="삭제"
                        className="shrink-0 text-zinc-300 hover:text-red-500"
                      >
                        🗑
                      </button>
                    </div>
                    <div
                      className={`mt-1 text-[11px] ${dl.urgent ? "font-semibold text-red-600" : "text-zinc-500"}`}
                    >
                      📅 {dl.text}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-400">
                      {[s.supportField, s.region].filter(Boolean).join(" · ")}
                    </div>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-[11px] text-blue-600 hover:underline"
                      >
                        공식 안내문 ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 진단 위저드 (2026-07-12) — 시안 그대로 한 화면 한 단계. 활성 시 챗 영역 전체를 대체 */}
      {wizardActive && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-4 sm:p-6">
          <DiagnosisWizard
            key={convoId + (wizardStart ?? "")}
            start={wizardStart ?? "scope"}
            program={selectedProgram}
            evMap={evMap}
            evMapError={evMapError}
            onRetryMap={() => void loadEvidenceMap()}
            evResult={evResult}
            evPrograms={evPrograms}
            evProgramsLoading={evProgramsLoading}
            analysis={wizAnalysis}
            convertFiles={convertFiles}
            onDirectProgram={makeCustomProgram}
            onChooseProgram={chooseProgram}
            onViewProgram={viewProgram}
            hasLead={Boolean(lead)}
            onSignup={() => setSignupOpen(true)}
            onAnalyze={(payload, note) => void wizardAnalyze(payload, note)}
            onSubmitEvidence={submitEvidence}
            onPay={clickPay}
            initialFind={findCache}
            seenRecs={seenRecs}
            onFindResults={saveFindResults}
            derivedYears={derivedYearsBucket}
            prefillRegion={prefillRegionVal}
          />
        </div>
      )}

      {!wizardActive && (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-5">
      {/* 본문 폭 제한(§11-1) — 대화도 시안처럼 좁은 컬럼으로 집중 */}
      <div className="mx-auto w-full max-w-[820px] space-y-3">
        {/* 1단계: 인테이크 대화 (+추천) — 사업 선택 후에도 위에 그대로 보임 */}
        {(programStage ? messages.slice(0, planStartIdx) : messages).map((m, i) =>
          editingIndex === i ? (
            <EditBox
              key={i}
              value={editingText}
              onChange={setEditingText}
              onSave={saveEdit}
              onCancel={cancelEdit}
            />
          ) : (
            <Bubble key={i} m={m} busy={busy} onEdit={() => startEdit(i)} />
          ),
        )}

        {/* 인테이크 앞단 3문항 — 버튼/선택지 (LLM 호출 0회) */}
        {profileFormVisible && <IntakeProfileForm onSubmit={submitProfile} />}

        {recommending && (
          <div className="mr-auto rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600">
            맞는 지원사업을 찾는 중이에요… 🔎
          </div>
        )}

        {mode === "intake" && recs && (
          <Recommendations
            recs={recs}
            nearMisses={nearMisses}
            usingSample={usingSample}
            onChoose={chooseProgram}
            onMore={recommendMore}
            loadingMore={recommending}
            onView={viewProgram}
            collectedIds={collectedIds}
            hasLead={Boolean(lead)}
            onSignup={() => setSignupOpen(true)}
          />
        )}

        {/* 2단계: 선택한 사업 (적합도 확인 → 작성) — 구분선으로 명확히 분리 */}
        {programStage && (
          <>
            <div className="flex items-center gap-2 py-1">
              <div className="h-px flex-1 bg-blue-200" />
              <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-bold text-white">
                {mode === "fitcheck"
                  ? "🔎 여기서부터 내가 신청해도 되는지 확인 (무료)"
                  : mode === "diagnose"
                    ? "🩺 여기서부터 지금 준비된 것 확인 (무료)"
                    : "✍️ 여기서부터 사업계획서 작성"}
              </span>
              <div className="h-px flex-1 bg-blue-200" />
            </div>
            {messages.slice(planStartIdx).map((m, i) =>
              editingIndex === planStartIdx + i ? (
                <EditBox
                  key={`stage-${i}`}
                  value={editingText}
                  onChange={setEditingText}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                />
              ) : (
                <Bubble
                  key={`stage-${i}`}
                  m={m}
                  busy={busy}
                  onEdit={() => startEdit(planStartIdx + i)}
                />
              ),
            )}
          </>
        )}

        {/* 합격 가능성 진단 — 폼(2화면) → 진단지(전부 무료) → 초안 미리보기 → 결제.
            한 화면 = 한 단계: 미리보기가 열리면 진단지는 잠시 접는다 (2026-07-11 디자인수정) */}
        {mode === "diagnose" &&
          (!evResult ? (
            <EvidenceDiagnosisForm
              rows={evMap}
              mapError={evMapError}
              onRetryMap={() => void loadEvidenceMap()}
              onSubmit={submitEvidence}
            />
          ) : evResult.kind === "pre" ? (
            <PreStageCard programs={evPrograms} loading={evProgramsLoading} />
          ) : previewOpen ? (
            <DraftPreviewCard
              sheet={evResult.sheet}
              onPay={clickPay}
              onBack={() => setPreviewOpen(false)}
              onView={() => track("draft_preview_view", { program: selectedProgram?.title ?? "" })}
            />
          ) : (
            <EvidenceSheetCard sheet={evResult.sheet} onPreview={openPreview} />
          ))}

        {mode === "plan" && selectedProgram && <PublicEvidencePanel program={selectedProgram} />}

        {draft && (
          <DraftView
            draft={draft}
            drafting={drafting}
            reviewing={reviewingDraft}
            revising={revisingDraft}
            review={planReview}
            charts={charts}
            onDownload={downloadDocx}
            onReview={() => void auditDraftSections(draft.sections)}
            onRevise={() => void reviseDraftFromReview()}
            eligWarn={
              eligOverride && (eligStatus === "미충족" || eligStatus === "불확실") ? eligStatus : null
            }
            kitPrompt={buildKitPrompt()}
            onRepurchase={() => {
              track("repurchase_cta_click", { price: PRICE_KRW });
              setNeedsRepurchase(true); // 초안 완주 = 이번 이용권 소진 — 새 주문번호 입력폼부터
              setPayOpen(true);
            }}
          />
        )}
      </div>
      </div>
      )}

      {mode !== "paywall" && !wizardActive && (
        <div className="mx-auto w-full max-w-[820px]">
          {/* 응답 끊김 재시도 (2026-07-12) — "..."로 조용히 멈추는 대신 원인 안내 + 원클릭 재시도 */}
          {retryable && !busy && (
            <div className="px-4 pt-2">
              <button
                onClick={() => void retryLast()}
                className="w-full rounded-xl border border-amber-300 bg-amber-50 py-2.5 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                🔁 응답이 끊겼어요 — 다시 시도하기
              </button>
            </div>
          )}
          {/* 캘린더 저장(가입) 배너 — 추천 탐색 중에만. 진단·작성 중에는 노출하지 않는다 (§12) */}
          {mode === "intake" && !lead && !nudgeDismissed && calItems.length > 0 && (
            <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <span className="flex-1">
                📅 방금 본 지원 <b>{calItems.length}개</b>를 한곳에 모았어요! 마감을 놓치지 않게 저장할까요?
              </span>
              <button
                onClick={() => setSignupOpen(true)}
                className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700"
              >
                저장(가입)
              </button>
              <button
                onClick={() => setNudgeDismissed(true)}
                className="shrink-0 text-blue-400 hover:text-blue-600"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
          )}
          {mode === "intake" && userTurns >= 1 && !recs && (
            <div className="border-t border-zinc-100 px-4 pt-3">
              <button
                onClick={recommend}
                disabled={recommending || busy || !readyToRecommend}
                className="w-full rounded-xl bg-blue-50 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {readyToRecommend
                  ? "✨ 이 내용으로 지원사업 추천받기"
                  : "✨ 지원 찾기 — 몇 가지만 더 답해 주세요"}
              </button>
              {!readyToRecommend && (
                <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                  나에게 안 맞는 지원이 나오지 않도록, 사업을 시작한 시기와 지역 같은 질문에 답해 주세요.
                </p>
              )}
            </div>
          )}
          {/* 진행 안내·직접 경로·표준양식 — 대화가 시작되면 숨긴다 (§12: 현재 단계만 노출) */}
          {mode === "intake" && !recs && userTurns === 0 && (
            <div className="px-4 pt-2 space-y-2">
              {/* 진행 단계 목차 — 처음 온 사람이 '어떻게 흘러가는지' 한눈에 (책 목차처럼) */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-blue-800">📋 이렇게 3단계로 진행돼요</p>
                <ol className="mt-1.5 space-y-1 text-[11px] leading-4 text-zinc-600">
                  <li className="flex gap-1.5">
                    <span className="font-bold text-blue-600">1.</span>
                    <span>지금 하는 일·사업 시작 시기·지역에 맞는 지원 찾기</span>
                  </li>
                  <li className="flex gap-1.5">
                    <span className="font-bold text-blue-600">2.</span>
                    <span>내가 신청할 수 있는지와 더 준비할 내용 확인</span>
                  </li>
                  <li className="flex gap-1.5">
                    <span className="font-bold text-blue-600">3.</span>
                    <span>필요할 때만 내 말을 공식 사업계획서로 바꾸기</span>
                  </li>
                </ol>
              </div>

              {/* 이미 공고/양식 있는 사람 — 연노랑으로 시선 강조 (로직 동일) */}
              <button
                onClick={startDirect}
                className="w-full rounded-xl border border-yellow-300 bg-yellow-50 py-2.5 text-xs font-semibold text-yellow-800 transition-colors hover:bg-yellow-100"
              >
                📄 이미 보고 있는 지원사업이 있어요 → 무료로 확인하기
              </button>

              {/* 공식 사업공고·양식 어디서 찾나요 — K-Startup 공식 링크(무료, 가입 불필요) */}
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
                <p className="text-[11px] font-semibold text-zinc-600">
                  📑 사업계획서 표준 양식 무료로 받기 (한 번 써보세요)
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {OFFICIAL_LINKS.map((l) => (
                    <a
                      key={l.label}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => track("open_official_link", { name: l.label })}
                      className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                    >
                      {l.label} ↗
                    </a>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-4 text-zinc-400">
                  처음 사업을 시작하는 사람이 많이 쓰는 작성 파일을 바로 받아볼 수 있어요. 막히면 위에서 함께
                  준비 상태를 확인해 드려요.
                </p>
              </div>
            </div>
          )}
          {mode === "fitcheck" && (
            <div className="border-t border-zinc-100 px-4 pt-3">
              {/* 왜 바로 안 쓰고 진단부터인지 — 설명은 2줄 이내, 무료·유료 경계는 버튼 아래 명시 (§9·§11) */}
              <div className="mb-2 rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-800">
                이미 만든 매출·고객·거래 기록 중 무엇을 보여주면 좋은지 먼저 정리해드려요. 버튼만 누르면
                1분이면 됩니다.
              </div>
              <button
                onClick={enterDiagnose}
                className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white transition-colors hover:bg-blue-700"
              >
                지금 준비된 내용 무료로 확인하기
              </button>
              <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                여기까지는 무료 · 공식 사업계획서 워드 초안은 1회 {PRICE}입니다.
              </p>
              <button
                onClick={switchToFind}
                className="mt-2 w-full rounded-xl border border-zinc-200 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50"
              >
                🔄 이 사업 말고, 나에게 맞는 지원사업 찾아줘
              </button>
            </div>
          )}
          {mode === "plan" && (
            <div className="border-t border-zinc-100 px-4 pt-3">
              {kickoffError && (
                <div className="mb-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
                  <p>{kickoffError}</p>
                  <button
                    type="button"
                    onClick={() => void retryPlanKickoff()}
                    disabled={busy}
                    className="mt-2 w-full rounded-lg bg-red-600 py-2 font-bold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? "첫 질문을 다시 불러오는 중…" : "첫 작성 질문 다시 불러오기"}
                  </button>
                </div>
              )}
              {/* 신청 자격 게이트(2026-07-12) — 판정 전·미충족·불확실 상태에선 초안 진행을 막는다 */}
              {eligStatus === "미충족" && !eligOverride ? (
                <>
                  <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800">
                    ❌ 현재 정보로는 이 공고의 <b>신청 자격에 해당하지 않아</b> 초안 생성을 잠시
                    막아뒀어요. 자격이 생기는 정보(투자·매출·지원금 실적 등)가 있다면 위 대화에서
                    알려주세요 — 판정이 갱신돼요.
                  </div>
                  <button
                    onClick={switchToFind}
                    className="w-full rounded-xl bg-blue-600 py-3 text-base font-bold text-white transition-colors hover:bg-blue-700"
                  >
                    🔄 조건이 맞는 다른 지원사업 찾아보기
                  </button>
                  <button
                    onClick={() => setEligOverride(true)}
                    className="mt-1.5 w-full py-1 text-center text-[11px] text-zinc-400 underline underline-offset-2 hover:text-zinc-600"
                  >
                    자격 미충족을 알고도 초안을 진행할게요 (초안에 확인 필요 표시가 들어가요)
                  </button>
                </>
              ) : eligStatus === "불확실" && !eligOverride ? (
                <>
                  <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">
                    ⚠️ <b>신청 자격이 아직 확실하지 않아요.</b> 위 안내(투자·지원금 실적, 추천기관
                    추천서 등)를 확인해 대화에서 답해 주시면 판정이 갱신되고 초안을 진행할 수 있어요.
                  </div>
                  <button
                    onClick={() => setEligOverride(true)}
                    className="w-full rounded-xl border border-amber-300 bg-white py-2.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50"
                  >
                    확인했어요 — 그래도 초안 진행하기 (초안에 확인 필요 표시가 들어가요)
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={generateDraft}
                    disabled={
                      drafting ||
                      readinessChecking ||
                      busy ||
                      planUserTurns < PLAN_MIN_TURNS ||
                      !draftAnswersReady ||
                      (Boolean(eligReqs?.found) && eligStatus === null)
                    }
                    className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {readinessChecking
                      ? "심사위원 관점으로 작성 준비도를 확인하는 중…"
                      : drafting
                        ? reviewingDraft
                          ? "초안을 심사위원 관점으로 다시 검토하는 중…"
                          : "초안과 도식을 만드는 중이에요…"
                      : Boolean(eligReqs?.found) && eligStatus === null
                        ? "📄 초안 만들기 — 먼저 신청 자격 확인 질문에 답해 주세요"
                        : planUserTurns < PLAN_MIN_TURNS
                          ? `📄 초안 만들기 — 대화를 조금 더 해주세요 (${planUserTurns}/${PLAN_MIN_TURNS})`
                          : !draftAnswersReady
                            ? `📄 초안 만들기 — 답변을 더 채워주세요 (${draftReadiness?.score ?? 0}%)`
                            : "🔎 작성 준비도 심사 후 사업계획서 만들기"}
                  </button>
                  {planUserTurns < PLAN_MIN_TURNS && (
                    <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                      질문에 충분히 답할수록 사업계획서가 좋아져요. 위 대화를 이어가 주세요.
                    </p>
                  )}
                  {planUserTurns >= PLAN_MIN_TURNS && !draftAnswersReady && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
                      <b>아직 초안을 만들기엔 답변이 부족해요.</b>
                      {draftReadiness?.missing.length ? (
                        <ul className="mt-1 list-disc pl-4">
                          {draftReadiness.missing.slice(0, 3).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1">위 질문에 구체적인 상황·근거·숫자를 포함해 답해 주세요.</p>
                      )}
                    </div>
                  )}
                  {eligStatus === "충족" && (
                    <p className="mt-1.5 text-center text-[11px] text-emerald-600">
                      ✅ 신청 자격이 확인된 공고예요.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* 진단(diagnose)은 버튼만으로 진행 — 텍스트 입력창은 숨긴다 (LLM 호출 0회) */}
          {mode !== "diagnose" && (
          <div className="border-t border-zinc-100 p-4">
            {programStage && (
              <p className="mb-2 text-center text-[11px] leading-4 text-zinc-400">
                💡 사진·PDF·워드·한글(.hwp/.hwpx) 모두 괜찮아요 — 📎로 올리면 진단과 사업계획서가 더 정확해져요
              </p>
            )}
            {(pendingImages.length > 0 || pendingFiles.length > 0 || pendingDocs.length > 0) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {pendingImages.map((im, k) => (
                  <div key={`img-${k}`} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:${im.mediaType};base64,${im.data}`}
                      alt="첨부"
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                    <button
                      onClick={() => setPendingImages((p) => p.filter((_, i) => i !== k))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white"
                      aria-label="첨부 제거"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {pendingFiles.map((f, k) => (
                  <div
                    key={`file-${k}`}
                    className="relative flex max-w-[200px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700"
                  >
                    <span>📄</span>
                    <span className="truncate">{f.name}</span>
                    <button
                      onClick={() => setPendingFiles((p) => p.filter((_, i) => i !== k))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white"
                      aria-label="첨부 제거"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {pendingDocs.map((d, k) => (
                  <div
                    key={`doc-${k}`}
                    className="relative flex max-w-[200px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700"
                  >
                    <span>📝</span>
                    <span className="truncate">{d.name}</span>
                    <button
                      onClick={() => setPendingDocs((p) => p.filter((_, i) => i !== k))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-xs text-white"
                      aria-label="첨부 제거"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-200 text-lg text-zinc-500 hover:bg-zinc-50">
                📎
                <input
                  type="file"
                  accept="image/*,application/pdf,.pdf,.docx,.hwp,.hwpx,.txt,.md"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                data-tour="input"
                disabled={profileFormVisible}
                placeholder={
                  profileFormVisible
                    ? "먼저 위에서 세 가지를 골라주세요 👆"
                    : "여기에 답을 입력하세요… (📎로 사진·PDF·워드·한글 첨부)"
                }
                className="max-h-32 flex-1 resize-none rounded-2xl border border-zinc-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-zinc-50"
              />
              <button
                onClick={send}
                disabled={
                  busy ||
                  profileFormVisible ||
                  // 첨부만 있어도 전송 가능해야 함 — pendingDocs 누락으로 문서 계열(워드·한글·txt)
                  // 단독 첨부 시 버튼이 비활성이던 버그 (2026-07-12)
                  (!input.trim() &&
                    pendingImages.length === 0 &&
                    pendingFiles.length === 0 &&
                    pendingDocs.length === 0)
                }
                data-tour="send"
                className="shrink-0 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                보내기
              </button>
            </div>
          </div>
          )}
        </div>
      )}
    </main>
  );
}

// 인테이크 앞단 3문항(단계·지역·연령) 버튼 폼 — LLM 호출 없이 수집 (점검표 문제 8)
function IntakeProfileForm({ onSubmit }: { onSubmit: (p: IntakeProfile) => void }) {
  const [stage, setStage] = useState("");
  const [region, setRegion] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const ready = Boolean(stage && region && ageGroup);
  const pick = (cur: string, v: string) =>
    `rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
      cur === v
        ? "border-blue-500 bg-blue-50 text-blue-700"
        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
    }`;
  return (
    <div className="mr-auto w-full max-w-[95%] rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-zinc-700">1️⃣ 사업 단계가 어떻게 되세요?</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PROFILE_STAGES.map((v) => (
              <button key={v} onClick={() => setStage(v)} className={pick(stage, v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-700">
            2️⃣ 어느 지역에서 하세요? <span className="font-normal text-zinc-400">(지역 제한 사업이 많아요)</span>
          </p>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className={`mt-1.5 w-full rounded-xl border px-3 py-2 text-xs outline-none focus:border-blue-500 ${
              region ? "border-blue-500 bg-blue-50 text-blue-700" : "border-zinc-200 bg-white text-zinc-600"
            }`}
          >
            <option value="">지역을 골라주세요</option>
            {PROFILE_REGIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-xs font-semibold text-zinc-700">
            3️⃣ 연령대는요? <span className="font-normal text-zinc-400">(나이로 자격이 갈리는 경우가 있어요)</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PROFILE_AGES.map((v) => (
              <button key={v} onClick={() => setAgeGroup(v)} className={pick(ageGroup, v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        onClick={() => ready && onSubmit({ stage, region, ageGroup })}
        disabled={!ready}
        className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
      >
        {ready ? "이걸로 시작하기 →" : "세 가지를 모두 골라주세요"}
      </button>
    </div>
  );
}

function EditBox({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="ml-auto flex w-full max-w-[85%] flex-col items-end gap-2">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        className="w-full resize-none rounded-2xl border-2 border-blue-400 px-4 py-3 text-sm leading-6 text-zinc-900 outline-none"
      />
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50"
        >
          취소
        </button>
        <button
          onClick={onSave}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          저장하고 다시 답변받기
        </button>
      </div>
    </div>
  );
}

// **별표** 마크다운을 볼드로 렌더링 — LLM 응답의 별표가 그대로 노출되지 않게 (v4.1 소정리)
function renderBold(text: string): ReactNode {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : p));
}

function Bubble({ m, busy, onEdit }: { m: Msg; busy: boolean; onEdit?: () => void }) {
  const isUser = m.role === "user";
  return (
    <div className={isUser ? "ml-auto flex max-w-[85%] flex-col items-end" : "mr-auto max-w-[85%]"}>
      <div
        className={
          isUser
            ? "whitespace-pre-wrap rounded-2xl rounded-br-sm bg-blue-600 px-4 py-3 text-sm leading-6 text-white"
            : "whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-900"
        }
      >
        {m.images && m.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {m.images.map((im, k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={k}
                src={`data:${im.mediaType};base64,${im.data}`}
                alt="첨부 이미지"
                className="h-20 w-20 rounded-lg object-cover"
              />
            ))}
          </div>
        )}
        {((m.files && m.files.length > 0) || (m.docs && m.docs.length > 0)) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(m.files ?? []).map((f, k) => (
              <span
                key={`f${k}`}
                className="flex max-w-[200px] items-center gap-1 rounded-lg bg-black/10 px-2 py-1 text-xs"
              >
                📄 <span className="truncate">{f.name}</span>
              </span>
            ))}
            {(m.docs ?? []).map((d, k) => (
              <span
                key={`d${k}`}
                className="flex max-w-[200px] items-center gap-1 rounded-lg bg-black/10 px-2 py-1 text-xs"
              >
                📝 <span className="truncate">{d.name}</span>
              </span>
            ))}
          </div>
        )}
        {renderBold(stripEligMarks(m.content.replace(READY_MARK, ""))) || (busy ? "…" : "")}
      </div>
      {isUser && onEdit && !busy && (
        <button
          onClick={onEdit}
          className="mt-1 text-[11px] text-zinc-400 transition-colors hover:text-blue-600"
        >
          ✏️ 수정
        </button>
      )}
    </div>
  );
}

// 마감일 → 사람이 읽기 쉬운 라벨 (D-day, 상시, 마감)
function deadlineLabel(applyEnd: string | null): { text: string; urgent: boolean } {
  if (!applyEnd) return { text: "상시 모집 (마감일 없음)", urgent: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${applyEnd}T00:00:00`);
  const days = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (Number.isNaN(days)) return { text: applyEnd, urgent: false };
  if (days < 0) return { text: `마감됨 (${applyEnd})`, urgent: false };
  if (days === 0) return { text: `⏰ 오늘 마감! (${applyEnd})`, urgent: true };
  return { text: `D-${days} · ${applyEnd}까지`, urgent: days <= 7 };
}

function Recommendations({
  recs,
  nearMisses,
  usingSample,
  onChoose,
  onMore,
  loadingMore,
  onView,
  collectedIds,
  hasLead,
  onSignup,
}: {
  recs: Recommendation[];
  nearMisses: Program[];
  usingSample: boolean;
  onChoose: (p: Program) => void;
  onMore: () => void;
  loadingMore: boolean;
  onView: (p: Program) => void;
  collectedIds: Set<string>;
  hasLead: boolean;
  onSignup: () => void;
}) {
  if (recs.length === 0) {
    // 추천 0건 — 근접 공고 + 알림 신청(가입)으로 리드 수집 (v4.1 패치 2)
    return (
      <div className="mr-auto max-w-[90%] space-y-3">
        <div className="space-y-2 rounded-2xl bg-zinc-100 px-4 py-3 text-sm leading-6 text-zinc-700">
          <p>
            지금 <b>신청할 수 있는 지원</b> 중에선 사장님께 딱 맞는 게 안 보였어요 😢 큰 지원은 보통
            1년에 한두 번만 열려서, 지금은 모집이 닫혀 있을 수 있어요. (말씀해주신 내용은 잘
            기억하고 있어요!)
          </p>
        </div>
        {nearMisses.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-500">그래도 답해주신 내용과 가까웠던 지원이에요 👇</p>
            {nearMisses.map((p) => (
              <div key={p.id} className="rounded-2xl border border-zinc-200 bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold leading-5 text-zinc-800">{p.title}</h3>
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                    🕐 지금은 마감/모집 전
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5">{plainSupportOption(p.supportField).label}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5">{p.region}</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5">{deadlineLabel(p.applyEnd).text}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {!hasLead && (
          <button
            onClick={onSignup}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            🔔 맞는 지원이 열리면 알려드릴게요 — 알림 신청
          </button>
        )}
        <p className="text-xs leading-5 text-zinc-500">
          👉 위쪽 <b>‘📑 표준 양식 무료로 받기’</b>로 미리 사업계획서를 써두면, 새 공고가 열렸을 때 바로
          낼 수 있어요. 아래 <b>‘추천받기’</b>를 한 번 더 눌러보셔도 돼요!
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-zinc-700">지금은 이런 지원을 살펴보면 좋아요 👇</div>
      <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
        마음에 드는 지원의 <b>「내가 신청해도 되는지 무료 확인」</b> 버튼을 누르면, 조건과 더 준비할
        내용을 쉽게 볼 수 있어요. 공식 안내문도 함께 확인할 수 있습니다.
      </div>
      {recs.map((r) => (
        <div key={r.program.id} className="rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-zinc-900">{r.program.title}</h3>
            <span
              className={
                r.eligibility === "조건 충족"
                  ? "shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                  : r.eligibility === "가능성 높음"
                    ? "shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
                    : "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
              }
            >
              {plainEligibilityLabel(r.eligibility)}
            </span>
          </div>
          {r.eligibility === "확인 필요" && r.checkReason && (
            <p className="mt-1 text-xs leading-5 text-amber-700">확인할 것: {plainCheckReason(r.checkReason)}</p>
          )}
          <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-zinc-700">
            <span className="font-semibold text-blue-700">쉽게 말하면</span>{" "}
            {r.whatItIs || plainProgramExplanation(r.program)}
          </div>
          {/* 개별 근거가 없으면 문구를 생략 — 복붙 문구 금지 (2026-07-12 QA #3) */}
          {r.fitReason && (
            <p className="mt-2 text-sm leading-6 text-zinc-700">
              <span className="font-semibold text-blue-700">나에게 맞는 이유</span> {r.fitReason}
            </p>
          )}
          <div className="mt-3 space-y-1.5 rounded-lg border border-zinc-100 bg-zinc-50/70 px-3 py-2.5 text-xs leading-5 text-zinc-600">
            {(() => {
              const dl = deadlineLabel(r.program.applyEnd);
              return (
                <div className="flex gap-1.5">
                  <span className="shrink-0 font-semibold text-zinc-700">📅 신청기간</span>
                  <span className={dl.urgent ? "font-semibold text-red-600" : ""}>{dl.text}</span>
                </div>
              );
            })()}
            {(r.program.target && r.program.target !== "지원대상 정보 없음") || r.program.summary ? (
              <details>
                <summary className="cursor-pointer font-semibold text-zinc-600">공식 안내문에 적힌 조건 펼쳐보기</summary>
                {r.program.target && r.program.target !== "지원대상 정보 없음" && (
                  <p className="mt-1"><b>신청할 수 있는 사람:</b> {r.program.target}</p>
                )}
                {r.program.summary && <p className="mt-1"><b>도와주는 내용:</b> {r.program.summary}</p>}
              </details>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{plainSupportOption(r.program.supportField).label}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5">{r.program.region}</span>
          </div>
          {r.kind === "event" ? (
            // 교육·행사형(QA #2): 사업계획서 불필요 — 유료 초안 CTA를 붙이지 않는다
            <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-xs leading-5 text-zinc-600">
              🎓 교육이나 행사 참여 지원이에요. <b>긴 사업계획서 없이 간단한 신청서만</b> 내면 됩니다. 아래 공식 안내문에서
              바로 신청하세요.
            </div>
          ) : (
            <button
              onClick={() => onChoose(r.program)}
              className="mt-3 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              내가 신청해도 되는지 무료로 확인하기
            </button>
          )}
          <div className="mt-2 flex items-center justify-center gap-2">
            <a
              href={r.program.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onView(r.program)}
              className="text-xs font-medium text-zinc-600 hover:underline"
            >
              공식 안내문 보기 ↗
            </a>
            {collectedIds.has(r.program.id) && (
              <span className="text-[11px] font-medium text-blue-600">· 📅 캘린더에 담김</span>
            )}
          </div>
        </div>
      ))}
      <button
        onClick={onMore}
        disabled={loadingMore}
        className="w-full rounded-xl border border-blue-200 bg-white py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50"
      >
        {loadingMore ? "다른 지원을 더 찾는 중이에요…" : "🔄 마음에 안 들면, 다른 지원 더 보기"}
      </button>

      {/* 마감 알림(가입) 진입점 — 추천 결과 하단 상시 노출 (v4.1 패치 3) */}
      {!hasLead && (
        <button
          onClick={onSignup}
          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          🔔 이 지원들의 마감 알림 받기 (간단 가입 · 비밀번호 없음)
        </button>
      )}

      {usingSample && (
        <p className="text-[11px] leading-5 text-zinc-400">
          ※ 지금은 예시 데이터예요. 정부 데이터 연동이 끝나면 실제 공고로 바뀝니다.
        </p>
      )}
    </div>
  );
}

// ── 결제 확인 (2026-07-09 ③ 결정: 그로블 결제 → 셀프서비스 주문번호 인증) ──
function Paywall({
  program,
  paid,
  loggedIn,
  returningFromPayment,
  onRequireLogin,
  onUnlock,
  onCancel,
  verifyOrder,
}: {
  program: Program | null;
  paid: boolean;
  loggedIn: boolean;
  returningFromPayment: boolean;
  onRequireLogin: () => void;
  onUnlock: () => void;
  onCancel: () => void;
  verifyOrder: (orderNo: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [entered, setEntered] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  // 결제 진입 전 정책 확인과, 결제 확인 후 유료 맞춤 작성 시작 동의를 분리한다.
  const [refundConsent, setRefundConsent] = useState(false);
  const [startConsent, setStartConsent] = useState(false);

  // QA 우회 형식("QA"+16자리, QA_MODE 배포 한정)도 서버로 보낼 수 있게 영숫자를 남긴다
  const orderCleaned = entered.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const orderDigits = orderCleaned.replace(/\D/g, "");
  const formatOk = /^\d{18,19}$/.test(orderCleaned) || /^QA\d{16}$/.test(orderCleaned);

  async function submit() {
    if (!formatOk || checking) return;
    setChecking(true);
    setError("");
    const r = await verifyOrder(orderCleaned);
    setChecking(false);
    if (r.ok) {
      setDone(true);
    } else {
      setError(r.error ?? "확인에 실패했어요.");
    }
  }

  function clickGroble(e: MouseEvent<HTMLAnchorElement>) {
    // 환불정책(2026-07-14): 동의 체크 전에는 결제 진입 자체를 막는다(링크 이동 취소).
    if (!refundConsent) {
      e.preventDefault();
      return;
    }
    try {
      localStorage.setItem(CHECKOUT_STARTED_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    // GA4 퍼널: 그로블 결제 링크 클릭 (③ 결정 — 전환 트리거 측정)
    track("groble_click", { program: program?.title ?? "", price: PRICE_KRW });
  }

  if (paid || done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
        <h3 className="text-sm font-bold text-zinc-900">✅ 결제 확인 완료</h3>
        <p className="mt-1 text-sm leading-6 text-zinc-700">
          사업계획서 초안 작성 기능이 열렸어요. 이 계정으로 로그인하면 언제든 이용할 수 있어요.
        </p>
        {program && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-emerald-200 bg-white p-3 text-[11px] leading-4 text-zinc-700">
            <input
              type="checkbox"
              checked={startConsent}
              onChange={(e) => setStartConsent(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-600"
            />
            <span>
              유료 맞춤 작성 서비스를 시작합니다. 시작 후에는 개인화된 디지털콘텐츠 제공 특성상 관련 법령이
              허용하는 범위에서 청약철회가 제한될 수 있음을 확인했습니다.{" "}
              <a href="/refund" target="_blank" rel="noopener noreferrer" className="underline">
                환불정책 보기
              </a>
            </span>
          </label>
        )}
        <button
          onClick={onUnlock}
          disabled={Boolean(program) && !startConsent}
          className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {program ? `'${program.title}' 사업계획서 쓰러 가기 →` : "닫기"}
        </button>
      </div>
    );
  }

  // 결제를 계정과 묶지 않은 채 진행하면 결제 후 다시 로그인·인증해야 한다.
  // 따라서 신규 결제와 기존 결제 복구 모두 로그인부터 시작시킨다.
  if (!loggedIn) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h3 className="text-lg font-extrabold leading-7 text-zinc-900">
          {returningFromPayment ? "이미 결제하셨다면 다시 결제하지 마세요" : "먼저 로그인해 주세요"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-zinc-700">
          {returningFromPayment
            ? "결제 내역을 내 계정에 연결하는 단계만 남았어요. 로그인하면 같은 결제 이메일을 먼저 자동으로 찾아보고, 필요할 때만 주문번호를 받습니다."
            : "결제 내역을 안전하게 보관하고 재결제를 막기 위해 로그인한 뒤 결제를 진행합니다."}
        </p>
        <button
          onClick={onRequireLogin}
          className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700"
        >
          {returningFromPayment ? "로그인하고 결제 내역 연결하기 →" : "로그인 후 계속하기 →"}
        </button>
        <button onClick={onCancel} className="mt-3 text-xs text-zinc-500 hover:underline">
          닫기
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-5">
      <h3 className="text-lg font-extrabold leading-7 text-zinc-900">
        {returningFromPayment ? "결제 내역을 연결해 주세요" : "대표님이 들려주신 사업 이야기로"}
        {!returningFromPayment && (
          <>
            <br />
            심사 기준에 맞춘 사업계획서를 함께 만듭니다
          </>
        )}
      </h3>
      <p className="mt-1 text-[13px] text-zinc-500">
        {returningFromPayment
          ? "이미 결제하셨으므로 다시 결제할 필요가 없습니다."
          : "결제 전, 무엇을 받는지 마지막으로 확인하세요."}
      </p>

      {/* 결제 상품 요약 — 무엇을 사는지 한 박스에 (2026-07-11 디자인수정 §8) */}
      {!returningFromPayment && <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {program && (
          <div className="flex gap-3 border-b border-zinc-100 px-4 py-3 text-sm">
            <span className="shrink-0 font-semibold text-zinc-500">선택한 지원</span>
            <span className="font-semibold text-zinc-800">{program.title}</span>
          </div>
        )}
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-zinc-500">{PRICE}에 포함되는 내용</p>
          <ul className="mt-1.5 space-y-1 text-sm leading-6 text-zinc-700">
            <li>✓ 공고 평가항목·공식 작성 파일 순서에 맞춘 질문</li>
            <li>✓ 초안 전 독립 작성 준비도 심사 — 빈 답변이면 작성을 잠시 보류</li>
            <li>✓ 고객·매출·계약 근거를 심사위원이 찾기 쉬운 자리에 배치</li>
            <li>✓ 완성 초안의 사실 대조·모의심사·치명/중요 지적</li>
            <li>✓ 현재 자료로 고칠 수 있는 문장 재작성 + 증빙 체크리스트</li>
            <li>✓ 심사 리포트를 포함한 수정 가능한 Word 파일</li>
          </ul>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-3">
          <span className="text-sm font-bold text-zinc-700">가격</span>
          <span className="text-base font-extrabold text-zinc-900">1회 생성 {PRICE}</span>
        </div>
      </div>}

      {/* 1단계: 그로블에서 결제 */}
      {!returningFromPayment && <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
        <div className="text-xs font-semibold text-zinc-500">① 그로블에서 결제</div>

        {/* 결제 전 유료 제공 범위·환불정책 확인 — 미동의 시 결제 버튼 비활성 */}
        <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] leading-4 text-zinc-700">
          <input
            type="checkbox"
            checked={refundConsent}
            onChange={(e) => setRefundConsent(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-600"
          />
          <span>
            유료 제공 범위와 환불정책을 확인했습니다. 결제 후 <b>유료 맞춤 작성을 시작하기 전</b>에는
            고객문의 채널로 청약철회를 요청할 수 있습니다.{" "}
            <a href="/refund" target="_blank" rel="noopener noreferrer" className="underline">
              환불정책 자세히 보기
            </a>
          </span>
        </label>

        {GROBLE_CHECKOUT_URL ? (
          <a
            href={GROBLE_CHECKOUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!refundConsent}
            onClick={clickGroble}
            className={`mt-2 block rounded-xl py-3.5 text-center text-base font-bold text-white ${
              refundConsent ? "bg-blue-600 hover:bg-blue-700" : "cursor-not-allowed bg-zinc-300"
            }`}
          >
            {PRICE} 결제하고 심사형 작성 시작하기
          </a>
        ) : (
          <p className="mt-1.5 text-xs leading-5 text-zinc-500">
            결제 링크 준비 중이에요. 이미 결제하셨다면 아래에 주문번호를 입력해 주세요.
          </p>
        )}
        <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">
          카드 명세서에는 결제대행사 <b>‘주식회사 페이플’</b>로 표기돼요 (정상 결제입니다).
        </p>
        <p className="mt-2 rounded-lg bg-blue-50 px-2.5 py-2 text-[11px] font-medium leading-4 text-blue-800">
          결제는 새 탭에서 열려요. 결제 완료 화면의 주문번호를 복사한 뒤, 초록색 <b>‘도우미로 돌아가기’</b>를
          누르고 아래에 입력해 주세요.
        </p>
      </div>}

      {/* 2단계: 주문번호 입력 → 즉시 오픈 */}
      <div className={`${returningFromPayment ? "mt-4 border-emerald-300" : "mt-2 border-zinc-200"} rounded-xl border bg-white p-3`}>
        <div className="text-xs font-semibold text-zinc-500">
          {returningFromPayment ? "결제 이메일 자동 확인 후, 필요하면 " : "② 결제 후, "}
          그로블 주문내역의 <b>주문번호(숫자 18~19자리)</b>를 입력하면 즉시 열려요
        </div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-400">
          가입 이메일이 결제 이메일과 달라도 괜찮아요 — 주문번호가 열쇠예요.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={entered}
            onChange={(e) => setEntered(e.target.value)}
            placeholder="예: 2026080315052711964"
            inputMode="numeric"
            className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          <button
            onClick={submit}
            disabled={checking || !formatOk}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {checking ? "확인 중…" : "확인"}
          </button>
        </div>
        {entered && !formatOk && (
          <p className="mt-1 text-[11px] text-zinc-400">
            숫자 18~19자리를 입력해 주세요. (현재 {orderDigits.length}자리)
          </p>
        )}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      {/* 신뢰·리스크 완화 문구 (2026-07-11 디자인수정 §8) */}
      <ul className="mt-3 space-y-1 text-[11px] leading-4 text-zinc-500">
        <li>· 생성된 초안은 직접 복사·수정할 수 있습니다.</li>
        <li>· 입력한 사업정보는 초안 생성 목적으로만 사용됩니다.</li>
        <li>· 결과 보완 기준과 수정 가이드를 함께 제공합니다.</li>
        <li>· 최종 제출 전에는 사실관계와 증빙자료 확인이 필요합니다.</li>
      </ul>

      <button onClick={onCancel} className="mt-3 text-xs text-zinc-400 hover:underline">
        {program ? "← 이전 화면으로 돌아가기" : "닫기"}
      </button>
    </div>
  );
}


function DraftView({
  draft,
  drafting,
  reviewing,
  revising,
  review,
  charts,
  onDownload,
  onReview,
  onRevise,
  eligWarn,
  kitPrompt,
  onRepurchase,
}: {
  draft: Draft;
  drafting: boolean;
  reviewing: boolean;
  revising: boolean;
  review: PlanReviewReport | null;
  charts: Chart[] | null;
  onDownload: () => void;
  onReview: () => void;
  onRevise: () => void;
  eligWarn?: "미충족" | "불확실" | null;
  kitPrompt: string;
  onRepurchase: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copyKitPrompt() {
    try {
      await navigator.clipboard.writeText(kitPrompt);
      setCopied(true);
      track("prompt_copy_click");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("복사에 실패했어요. 프롬프트를 드래그해서 직접 복사해 주세요.");
    }
  }
  return (
    <div className="rounded-2xl border border-zinc-200 p-4">
      {/* 자격 미충족·불확실 강행 시 상단 경고 (2026-07-12) */}
      {eligWarn && (
        <div
          className={`mb-3 rounded-xl border px-3 py-2.5 text-xs leading-5 ${
            eligWarn === "미충족"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <b>⚠️ 신청 자격 확인 필요</b> — 이 초안은 신청 자격이{" "}
          {eligWarn === "미충족" ? "충족되지 않은" : "확인되지 않은"} 상태에서 작성됐어요. 제출 전에
          공식 안내문의 신청 조건을 반드시 직접 확인하세요.
        </div>
      )}
      <h3 className="text-sm font-bold text-zinc-900">{draft.title}</h3>
      <div className="mt-2 space-y-3">
        {draft.sections.map((s, i) => (
          <div key={i}>
            <div className="text-sm font-semibold text-zinc-800">{s.heading}</div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
              {s.content || "작성 중…"}
            </p>
          </div>
        ))}
      </div>

      {(drafting || revising) && (
        <p className="mt-3 text-xs text-zinc-500">
          {revising
            ? "심사 의견 중 현재 자료로 고칠 수 있는 문장과 구조를 다시 다듬는 중이에요…"
            : reviewing
              ? "초안의 주장과 숫자를 원답변에 대조하고, 심사 위험을 찾는 중이에요…"
              : "초안과 도식을 만드는 중이에요…"}
        </p>
      )}

      {charts && charts.length > 0 && (
        <div className="mt-4 border-t border-zinc-100 pt-3">
          <div className="text-sm font-semibold text-zinc-800">📊 포함된 도식</div>
          <div className="mt-2 space-y-3">
            {charts.map((c) => (
              <div key={c.key}>
                <div className="mb-1 text-xs font-medium text-zinc-500">{c.title}</div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${c.png}`}
                  alt={c.title}
                  className="w-full rounded-lg border border-zinc-100"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-zinc-100 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-zinc-900">심사위원 관점 모의심사</p>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
              합격확률이 아니라 공고·양식·원답변을 기준으로 한 제출 준비도입니다.
            </p>
          </div>
          {review && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                review.status === "ready"
                  ? "bg-emerald-100 text-emerald-800"
                  : review.status === "blocked"
                    ? "bg-red-100 text-red-800"
                    : "bg-amber-100 text-amber-800"
              }`}
            >
              {review.score}/100
            </span>
          )}
        </div>

        {reviewing ? (
          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-xs leading-5 text-blue-800">
            초안의 모든 숫자·실적·고객 주장을 대화 원문과 대조하고 있습니다.
          </div>
        ) : review ? (
          <div
            className={`mt-3 rounded-xl border p-3 ${
              review.status === "ready"
                ? "border-emerald-200 bg-emerald-50"
                : review.status === "blocked"
                  ? "border-red-200 bg-red-50"
                  : "border-amber-200 bg-amber-50"
            }`}
          >
            <p className="text-sm font-bold text-zinc-900">
              {review.status === "ready"
                ? "제출 전 최종 사실 확인 단계"
                : review.status === "blocked"
                  ? "지금은 제출을 보류하고 보완해야 합니다"
                  : "중요 지적을 고친 뒤 제출해야 합니다"}
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-700">{review.verdict}</p>

            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {review.scores.map((item) => (
                <div key={item.key} className="rounded-lg border border-black/5 bg-white/80 px-2 py-2">
                  <p className="text-[10px] leading-4 text-zinc-500">{item.label}</p>
                  <p className="text-sm font-bold text-zinc-800">
                    {item.score}/{item.max}
                  </p>
                </div>
              ))}
            </div>

            {review.issues.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-bold text-zinc-800">심사에서 먼저 지적될 내용</p>
                {review.issues.slice(0, 6).map((item, index) => (
                  <div key={`${item.section}-${index}`} className="rounded-lg border border-black/5 bg-white/85 p-2.5">
                    <p className="text-xs font-semibold text-zinc-900">
                      <span
                        className={
                          item.severity === "critical"
                            ? "text-red-700"
                            : item.severity === "major"
                              ? "text-amber-700"
                              : "text-zinc-500"
                        }
                      >
                        [{item.severity === "critical" ? "치명" : item.severity === "major" ? "중요" : "보완"}]
                      </span>{" "}
                      {item.section}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-zinc-700">{item.issue}</p>
                    <p className="mt-1 text-[11px] leading-4 text-zinc-600">
                      <b>고치는 방법:</b> {item.action}
                    </p>
                    {item.evidenceNeeded && (
                      <p className="mt-1 text-[11px] leading-4 text-blue-800">
                        <b>필요 자료:</b> {item.evidenceNeeded}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {review.evidenceChecklist.length > 0 && (
              <details className="mt-3 rounded-lg border border-black/5 bg-white/80 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-zinc-800">
                  제출 전 준비할 증빙 {review.evidenceChecklist.length}개
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-4 text-zinc-600">
                  {review.evidenceChecklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {review.issues.some((item) => item.canAutoFix) && (
                <button
                  onClick={onRevise}
                  disabled={revising}
                  className="rounded-xl bg-zinc-900 px-3 py-2.5 text-xs font-bold text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {revising ? "심사 의견 반영 중…" : "현재 자료로 고칠 수 있는 부분 다시 다듬기"}
                </button>
              )}
              <button
                onClick={onReview}
                disabled={reviewing || revising}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                다시 모의심사하기
              </button>
            </div>
          </div>
        ) : !drafting && !revising ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
            모의심사가 아직 완료되지 않았습니다. Word 저장 전에 초안을 다시 심사해 주세요.
            <button
              onClick={onReview}
              className="mt-2 w-full rounded-lg bg-red-700 py-2 text-xs font-bold text-white hover:bg-red-800"
            >
              초안 다시 심사하기
            </button>
          </div>
        ) : null}
      </div>

      <button
        onClick={onDownload}
        disabled={drafting || reviewing || revising || !review}
        className="mt-4 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {drafting || reviewing || revising
          ? "모의심사가 끝나면 저장할 수 있어요…"
          : !review
            ? "모의심사를 먼저 완료해 주세요"
            : review.submissionReady
              ? "⬇️ 심사 리포트 포함 Word(.docx)로 저장"
              : "⬇️ 보완용 Word(.docx)로 저장 — 제출 전 수정 필요"}
      </button>
      {/* 허위기재 고지(2026-07-12) — 다운로드 화면 고정 문구, 코드 정적 삽입 */}
      {!drafting && (
        <p className="mt-1.5 text-center text-[11px] leading-4 text-zinc-500">
          ⚠️ 제출 전 모든 수치·실적의 증빙 자료를 확인하세요.
        </p>
      )}

      {/* ── 완성 키트 (2026-07-12) — 자가 채점 섹션 뒤 위치 예정, 채점 기능 연결 전까지 초안 하단 ── */}
      {!drafting && (
        <div className="mt-5 space-y-3 border-t border-zinc-100 pt-4">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
            <p className="text-sm font-bold text-zinc-800">선택: 다른 AI로 한 번 더 교차검토</p>
            <p className="mt-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs leading-5 text-zinc-700">
              위 모의심사는 딱지원핏 안에서 이미 수행했습니다. 아래 프롬프트는 새 자료가 생겼거나
              ChatGPT·Gemini·Claude의 다른 시각으로 한 번 더 확인하고 싶을 때만 사용하세요.
            </p>
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              작성 과정에서 아직 확보 못 한 통계·성과 수치·계약서·매출 자료가 발견될 수 있습니다.
              저희는 확인 안 된 내용을 임의로 지어내지 않습니다. 대신 자료가 준비됐을 때 대표님이
              직접 다시 점검하도록 이 도구를 함께 드립니다.
            </p>
            <ul className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 text-xs leading-5 text-zinc-600 sm:grid-cols-2">
              <li>· 담당자가 이해하기 어려운 부분</li>
              <li>· 확인 자료가 부족한 내용</li>
              <li>· 추가로 준비할 자료</li>
              <li>· 자료를 넣을 목차</li>
              <li>· 제출 전 재확인할 자격·숫자</li>
            </ul>
            <pre className="mt-2.5 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-100 bg-white p-3 text-[11px] leading-5 text-zinc-600">
              {kitPrompt}
            </pre>
            <button
              onClick={() => void copyKitPrompt()}
              className="mt-2 w-full rounded-xl bg-zinc-800 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700"
            >
              {copied ? "✓ 복사됐어요" : "📋 프롬프트 복사"}
            </button>
            <ol className="mt-2 space-y-0.5 text-[11px] leading-4 text-zinc-500">
              <li>① 프롬프트 복사</li>
              <li>② ChatGPT·Gemini·Claude에 붙여넣기</li>
              <li>③ 내 초안 함께 넣고 전송</li>
            </ol>
          </div>
          <a
            href={KAKAO_CONSULT_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("consult_cta_click")}
            className="block w-full rounded-xl border border-yellow-300 bg-yellow-50 py-3 text-center text-sm font-semibold text-yellow-900 transition-colors hover:bg-yellow-100"
          >
            💬 사업계획서 컨설팅 문의 (카카오톡 채널)
          </a>

          {/* 추가 이용권 (2026-07-13 소진 정책) — 완료 후엔 추천이 아니라 재구매 CTA가 가격 정책과 정합 */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-center">
            <p className="text-sm font-bold text-zinc-800">다른 지원사업의 사업계획서도 필요하세요?</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              이용권 1건은 사업계획서 초안 1건에 사용돼요. 다른 지원사업의 초안은 추가 이용권으로 만들 수
              있어요. (지원 찾기와 신청 가능 여부 확인은 계속 무료입니다)
            </p>
            <button
              onClick={onRepurchase}
              className="mt-2.5 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
            >
              추가 이용권 결제 · {PRICE}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 후기 수집 팝업 — 초안 완성 직후. 별점·태그·한줄평·공개동의.
function ReviewModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (p: {
    rating: number;
    tags: string[];
    comment: string;
    publicConsent: boolean;
  }) => Promise<boolean>;
}) {
  const [rating, setRating] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function toggleTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    const ok = await onSubmit({ rating, tags, comment: comment.trim(), publicConsent: consent });
    setBusy(false);
    if (ok) {
      setDone(true);
      setTimeout(onClose, 1800);
    } else {
      alert("후기 저장에 실패했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="py-8 text-center">
            <div className="text-3xl">🙏</div>
            <p className="mt-3 text-sm font-semibold text-zinc-800">
              후기 감사해요! <b>수정 1회 무료</b>로 도와드릴게요.
            </p>
          </div>
        ) : (
          <>
            <h3 className="text-base font-bold text-zinc-900">🎉 초안이 완성됐어요!</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              30초만 후기 남겨주시면 <b>수정 1회 무료</b> 드려요.
            </p>

            {/* 별점 */}
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">1. 별점</div>
              <div className="mt-1 flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    className={`text-2xl transition-transform hover:scale-110 ${
                      n <= rating ? "" : "opacity-30 grayscale"
                    }`}
                    aria-label={`${n}점`}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </div>

            {/* 태그 (복수선택) */}
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">2. 어떤 점이 좋았나요? (복수선택)</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REVIEW_TAGS.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      tags.includes(t)
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                    }`}
                  >
                    {tags.includes(t) ? "✓ " : ""}
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* 한줄평 */}
            <div className="mt-4">
              <div className="text-xs font-semibold text-zinc-600">3. 한 줄 더 (선택)</div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                placeholder="자유롭게 적어주세요"
                className="mt-1 w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>

            {/* 공개 동의 */}
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5 text-zinc-600">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>이 후기를 홈페이지에 공개해도 좋아요 (이름은 “김○○”처럼 일부만 표시돼요)</span>
            </label>

            <div className="mt-4 flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50"
              >
                다음에
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "보내는 중…" : "후기 보내고 혜택 받기"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
