export const MODU_2026_NOTICE_URL =
  "https://www.mss.go.kr/site/smba/ex/bbs/View.do?bcIdx=1070586&cbIdx=310&parentSeq=1070586";

export const MODU_2026_APPLICATION_URL = "https://www.modoo.or.kr";

export const MODU_2026_NOTICE_PDF_URL =
  "https://www.mss.go.kr/common/board/Download.do?bcIdx=1070586&cbIdx=310&streFileNm=7f086339-b568-44cf-a8b7-727ecb509e85.pdf";

export const MODU_2026_NOTICE_HWPX_URL =
  "https://www.mss.go.kr/common/board/Download.do?bcIdx=1070586&cbIdx=310&streFileNm=dffe5430-2816-4af0-b5e6-e2b308268370.hwpx";

export const MODU_2026_DEADLINE = "2026-09-17T16:00:00+09:00";
export const MODU_2026_DEADLINE_LABEL = "2026년 9월 17일(목) 16:00";

export const MODU_TRACKS = ["일반·기술 트랙", "로컬 트랙"] as const;
export const MODU_BUSINESS_STATUSES = [
  "사업자등록 전(예비창업)",
  "사업자등록 후(기창업)",
] as const;

export const MODU_DRAFT_SECTION_KEYS = [
  "oneLineDefinition",
  "customerProblem",
  "evidenceStatus",
  "solutionLogic",
  "revenueHypothesis",
  "validationPlan",
  "founderFit",
  "localFit",
  "mentorAgenda",
  "submissionEvidence",
] as const;

export type ModooDraftSectionKey = (typeof MODU_DRAFT_SECTION_KEYS)[number];

export const MODU_DRAFT_SECTIONS: ReadonlyArray<{
  key: ModooDraftSectionKey;
  label: string;
}> = [
  { key: "oneLineDefinition", label: "한 문장 사업 정의" },
  { key: "customerProblem", label: "고객 문제와 실제 발생 장면" },
  { key: "evidenceStatus", label: "확인된 문제 근거와 아직 비어 있는 근거" },
  { key: "solutionLogic", label: "해결 방식과 기존 대안에서 달라지는 점" },
  { key: "revenueHypothesis", label: "지불 고객과 수익 가설" },
  { key: "validationPlan", label: "마감 후 30일 검증 계획" },
  { key: "founderFit", label: "대표자가 이 문제를 풀 수 있는 실행 근거" },
  { key: "localFit", label: "지역 연결 근거(로컬 트랙용)" },
  { key: "mentorAgenda", label: "멘토와 먼저 결정할 한 가지" },
  { key: "submissionEvidence", label: "제출 전 모아둘 증빙" },
];

export const MODU_WORKSHEET_PROMPTS = [
  "최근 직접 보거나 겪은 고객의 불편 장면은 무엇인가요?",
  "그 고객은 지금 어떤 방법으로 문제를 버티거나 해결하고 있나요?",
  "문제가 실제라는 것을 보여줄 자료나 관찰은 무엇인가요?",
  "우리 방식은 어떤 순서로 고객의 불편을 줄이나요?",
  "누가 어떤 순간에 비용을 낼 것이라고 보나요?",
  "마감 후 30일 동안 가장 먼저 확인할 가설은 무엇인가요?",
  "대표자가 이미 해본 관련 일이나 확보한 자원은 무엇인가요?",
  "로컬 트랙이라면 특정 지역에서 시작해야 하는 이유는 무엇인가요?",
  "멘토와 가장 먼저 결정하고 싶은 쟁점 하나는 무엇인가요?",
] as const;

export interface ModooDraftRequest {
  track: string;
  industry: string;
  businessStatus: string;
  customerScene: string;
  currentAlternative: string;
  problemEvidence: string;
  solutionMechanism: string;
  paymentMoment: string;
  firstValidation: string;
  founderEvidence: string;
  localGrounding: string;
  mentorDecision: string;
}

export interface ModooDraftResult {
  answers: Record<ModooDraftSectionKey, string>;
  missingFacts: string[];
  finalChecks: string[];
}

type RequestValidation =
  | { ok: true; value: ModooDraftRequest }
  | { ok: false; error: string };

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeModooDraftRequest(raw: unknown): RequestValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "작성 내용을 읽지 못했어요." };
  }
  const source = raw as Record<string, unknown>;
  const value: ModooDraftRequest = {
    track: cleanText(source.track, 40),
    industry: cleanText(source.industry, 100),
    businessStatus: cleanText(source.businessStatus, 80),
    customerScene: cleanText(source.customerScene, 2_000),
    currentAlternative: cleanText(source.currentAlternative, 1_500),
    problemEvidence: cleanText(source.problemEvidence, 2_000),
    solutionMechanism: cleanText(source.solutionMechanism, 2_000),
    paymentMoment: cleanText(source.paymentMoment, 1_500),
    firstValidation: cleanText(source.firstValidation, 1_500),
    founderEvidence: cleanText(source.founderEvidence, 2_000),
    localGrounding: cleanText(source.localGrounding, 1_500),
    mentorDecision: cleanText(source.mentorDecision, 1_000),
  };

  if (!MODU_TRACKS.includes(value.track as (typeof MODU_TRACKS)[number])) {
    return { ok: false, error: "지원할 트랙을 선택해 주세요." };
  }
  if (value.industry.length < 2) {
    return { ok: false, error: "사업 분야를 대표님의 말로 적어주세요." };
  }
  if (!MODU_BUSINESS_STATUSES.includes(value.businessStatus as (typeof MODU_BUSINESS_STATUSES)[number])) {
    return { ok: false, error: "현재 사업자등록 상태를 선택해 주세요." };
  }
  if (value.customerScene.length < 10) {
    return { ok: false, error: "직접 보거나 겪은 고객의 불편 장면을 조금 더 적어주세요." };
  }
  if (value.solutionMechanism.length < 10) {
    return { ok: false, error: "대표님의 방식이 고객의 불편을 어떻게 줄이는지 적어주세요." };
  }
  return { ok: true, value };
}

function cleanStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, maxItems);
}

export function normalizeModooDraftResult(raw: unknown): ModooDraftResult | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const rawAnswers = source.answers;
  if (!rawAnswers || typeof rawAnswers !== "object") return null;
  const answerSource = rawAnswers as Record<string, unknown>;
  const answers = {} as Record<ModooDraftSectionKey, string>;
  for (const key of MODU_DRAFT_SECTION_KEYS) {
    const answer = cleanText(answerSource[key], 4_000);
    answers[key] = answer || "[보완 필요] 대표님이 확인해 입력할 내용입니다.";
  }
  return {
    answers,
    missingFacts: cleanStringList(source.missingFacts, 8),
    finalChecks: cleanStringList(source.finalChecks, 8),
  };
}
