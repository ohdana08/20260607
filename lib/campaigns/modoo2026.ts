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
  "아직 사업자등록증이 없어요(예비창업)",
  "사업자등록증이 있어요(기창업)",
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
  { key: "oneLineDefinition", label: "내 아이디어를 한 문장으로 소개" },
  { key: "customerProblem", label: "누구의 어떤 불편을 해결하는지" },
  { key: "evidenceStatus", label: "이미 확인한 내용 / 더 확인할 내용" },
  { key: "solutionLogic", label: "내 아이디어를 쓰면 달라지는 점" },
  { key: "revenueHypothesis", label: "누가 언제 돈을 내는지" },
  { key: "validationPlan", label: "처음 30일 동안 해볼 일" },
  { key: "founderFit", label: "내가 이 아이디어를 실행할 수 있는 이유" },
  { key: "localFit", label: "이 지역에서 시작하는 이유(로컬 트랙)" },
  { key: "mentorAgenda", label: "멘토에게 가장 먼저 물어볼 것" },
  { key: "submissionEvidence", label: "제출 전에 챙길 자료" },
];

export const MODU_WORKSHEET_PROMPTS = [
  "누가, 언제, 어떤 불편을 겪었나요?",
  "그 사람은 지금 이 문제를 어떻게 해결하고 있나요?",
  "이 문제가 실제로 있다는 것을 보여줄 대화, 사진, 문의, 기록이 있나요?",
  "내 아이디어를 쓰면 사용하기 전과 후가 어떻게 달라지나요?",
  "누가, 언제, 무엇에 돈을 내나요?",
  "처음 30일 동안 작게 해볼 일은 무엇인가요?",
  "내가 이 아이디어를 실행할 수 있다고 보여줄 경험이나 도움을 줄 사람이 있나요?",
  "로컬 트랙이라면, 왜 바로 이 지역에서 시작하려고 하나요?",
  "멘토에게 가장 먼저 물어보고 싶은 것은 무엇인가요?",
] as const;

export interface ModooSupportingMaterial {
  name: string;
  text: string;
}

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
  supportingMaterials: ModooSupportingMaterial[];
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

function cleanSupportingMaterials(value: unknown): ModooSupportingMaterial[] {
  if (!Array.isArray(value)) return [];
  const materials: ModooSupportingMaterial[] = [];
  for (const item of value.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const name = cleanText(source.name, 120);
    const text = cleanText(source.text, 12_000);
    if (name && text.length >= 10) materials.push({ name, text });
  }
  return materials;
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
    supportingMaterials: cleanSupportingMaterials(source.supportingMaterials),
  };

  if (!MODU_TRACKS.includes(value.track as (typeof MODU_TRACKS)[number])) {
    return { ok: false, error: "지원할 트랙을 선택해 주세요." };
  }
  if (value.industry.length < 2) {
    return { ok: false, error: "어떤 일을 하는 아이디어인지 적어주세요." };
  }
  if (!MODU_BUSINESS_STATUSES.includes(value.businessStatus as (typeof MODU_BUSINESS_STATUSES)[number])) {
    return { ok: false, error: "지금 사업자등록증이 있는지 선택해 주세요." };
  }
  if (value.customerScene.length < 10) {
    return { ok: false, error: "누가, 언제, 어떤 불편을 겪었는지 조금 더 적어주세요." };
  }
  if (value.solutionMechanism.length < 10) {
    return { ok: false, error: "내 아이디어를 쓰면 무엇이 어떻게 달라지는지 적어주세요." };
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
