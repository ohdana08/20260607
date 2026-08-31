import type { PlanDocxSection } from "./docx";

export type ReadinessStatus = "strong" | "partial" | "missing";
export type EvidenceLevel = "verified" | "stated" | "missing";

export interface ReadinessDimension {
  key: string;
  label: string;
  status: ReadinessStatus;
  evidenceLevel: EvidenceLevel;
  finding: string;
  nextQuestion: string;
}

export interface PlanReadinessAssessment {
  ready: boolean;
  score: number;
  verdict: string;
  dimensions: ReadinessDimension[];
  criticalGaps: string[];
  nextQuestions: string[];
  evaluationAlignment: string[];
}

export type ReviewSeverity = "critical" | "major" | "minor";

export interface PlanReviewIssue {
  severity: ReviewSeverity;
  section: string;
  issue: string;
  whyItMatters: string;
  action: string;
  evidenceNeeded: string;
  canAutoFix: boolean;
}

export interface PlanReviewScore {
  key: string;
  label: string;
  score: number;
  max: number;
  reason: string;
}

export interface PlanReviewReport {
  status: "ready" | "revise" | "blocked";
  submissionReady: boolean;
  score: number;
  verdict: string;
  strengths: string[];
  scores: PlanReviewScore[];
  issues: PlanReviewIssue[];
  evidenceChecklist: string[];
  formCompliance: string[];
  missingCount: number;
  proofCount: number;
}

export const READINESS_DIMENSIONS = [
  { key: "problem", label: "고객의 실제 문제" },
  { key: "solution", label: "해결 방식과 차이" },
  { key: "customer", label: "사용자·결제자·시장 근거" },
  { key: "business_model", label: "가격·수익·판매 검증" },
  { key: "go_to_market", label: "첫 고객과 확장 경로" },
  { key: "execution", label: "1년 일정·목표·지원금 사용" },
  { key: "team", label: "대표·팀의 실행 근거" },
  { key: "program_fit", label: "공고 평가항목·공식 양식 대응" },
] as const;

export const REVIEW_SCORE_DIMENSIONS = [
  { key: "eligibility_form", label: "신청 자격·양식 준수", max: 10 },
  { key: "problem_evidence", label: "문제와 고객 근거", max: 15 },
  { key: "solution_advantage", label: "해결책·차별성", max: 15 },
  { key: "market_business", label: "시장·수익 구조", max: 15 },
  { key: "sales_growth", label: "판매·성장 전략", max: 10 },
  { key: "execution_budget", label: "실행 일정·사업비", max: 15 },
  { key: "team", label: "대표·팀 역량", max: 10 },
  { key: "consistency_evidence", label: "사실 일치·증빙 가능성", max: 10 },
] as const;

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 500))
    .slice(0, limit);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1200) : fallback;
}

function integer(value: unknown, min: number, max: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : min;
}

export function normalizeReadinessAssessment(raw: unknown): PlanReadinessAssessment {
  const source = objectOf(raw);
  const received = Array.isArray(source.dimensions) ? source.dimensions.map(objectOf) : [];
  const dimensions = READINESS_DIMENSIONS.map(({ key, label }) => {
    const item = received.find((candidate) => candidate.key === key) ?? {};
    const status: ReadinessStatus = ["strong", "partial", "missing"].includes(String(item.status))
      ? (item.status as ReadinessStatus)
      : "missing";
    const evidenceLevel: EvidenceLevel = ["verified", "stated", "missing"].includes(String(item.evidenceLevel))
      ? (item.evidenceLevel as EvidenceLevel)
      : "missing";
    return {
      key,
      label,
      status,
      evidenceLevel,
      finding: text(item.finding, "확인된 내용이 없습니다."),
      nextQuestion: text(item.nextQuestion),
    };
  });
  const criticalGaps = strings(source.criticalGaps, 8);
  const verifiedCount = dimensions.filter(
    (item) => item.status !== "missing" && item.evidenceLevel === "verified",
  ).length;
  if (verifiedCount < 2) {
    criticalGaps.push("심사위원이 확인할 수 있는 고객·시장·매출·실행 근거를 최소 2개 연결해 주세요.");
  }
  const missingDimensions = dimensions.filter((item) => item.status === "missing");
  const score = integer(source.score, 0, 100);
  const ready =
    source.ready === true &&
    score >= 80 &&
    criticalGaps.length === 0 &&
    missingDimensions.length === 0;
  const nextQuestions = Array.from(
    new Set([
      ...strings(source.nextQuestions, 8),
      ...missingDimensions.map((item) => item.nextQuestion).filter(Boolean),
    ]),
  ).slice(0, 8);

  return {
    ready,
    score: ready ? score : Math.min(score, 79),
    verdict: text(
      source.verdict,
      ready ? "초안을 작성할 핵심 답변이 모였습니다." : "심사에서 확인할 핵심 답변이 더 필요합니다.",
    ),
    dimensions,
    criticalGaps,
    nextQuestions,
    evaluationAlignment: strings(source.evaluationAlignment, 12),
  };
}

export function countDraftPlaceholders(sections: PlanDocxSection[]): { missing: number; proof: number } {
  const combined = sections.map((section) => section.content ?? "").join("\n");
  return {
    missing: (combined.match(/\[보완 필요/g) ?? []).length,
    proof: (combined.match(/\[증빙 필요/g) ?? []).length,
  };
}

export function normalizePlanReview(raw: unknown, sections: PlanDocxSection[]): PlanReviewReport {
  const source = objectOf(raw);
  const placeholderCounts = countDraftPlaceholders(sections);
  const rawIssues = Array.isArray(source.issues) ? source.issues.map(objectOf) : [];
  const issues: PlanReviewIssue[] = rawIssues.slice(0, 20).map((item) => ({
    severity: ["critical", "major", "minor"].includes(String(item.severity))
      ? (item.severity as ReviewSeverity)
      : "major",
    section: text(item.section, "전체"),
    issue: text(item.issue, "심사 관점에서 보완이 필요합니다."),
    whyItMatters: text(item.whyItMatters, "평가 근거가 약해질 수 있습니다."),
    action: text(item.action, "확인 가능한 사실과 자료로 보완하세요."),
    evidenceNeeded: text(item.evidenceNeeded),
    canAutoFix: item.canAutoFix === true,
  }));

  if (placeholderCounts.missing > 0 && !issues.some((item) => item.issue.includes("보완 필요"))) {
    issues.unshift({
      severity: "critical",
      section: "전체",
      issue: `[보완 필요] 표시가 ${placeholderCounts.missing}곳 남아 있습니다.`,
      whyItMatters: "필수 정보가 빈 상태로 제출되면 해당 평가항목을 판단하기 어렵습니다.",
      action: "표시된 질문에 실제 사실을 입력한 뒤 다시 심사하세요.",
      evidenceNeeded: "표시 위치별 실제 일정·금액·고객·담당 정보",
      canAutoFix: false,
    });
  }
  if (placeholderCounts.proof > 0 && !issues.some((item) => item.issue.includes("증빙 필요"))) {
    issues.push({
      severity: "major",
      section: "전체",
      issue: `[증빙 필요] 표시가 ${placeholderCounts.proof}곳 남아 있습니다.`,
      whyItMatters: "핵심 주장에 확인 자료가 없으면 심사위원이 사실로 받아들이기 어렵습니다.",
      action: "해당 주장마다 제출·보관 가능한 자료명과 수치를 연결하세요.",
      evidenceNeeded: "매출·고객·계약·성과를 확인할 원본 자료",
      canAutoFix: false,
    });
  }

  const receivedScores = Array.isArray(source.scores) ? source.scores.map(objectOf) : [];
  const scores = REVIEW_SCORE_DIMENSIONS.map(({ key, label, max }) => {
    const item = receivedScores.find((candidate) => candidate.key === key) ?? {};
    return {
      key,
      label,
      max,
      score: integer(item.score, 0, max),
      reason: text(item.reason, "평가 근거가 제공되지 않았습니다."),
    };
  });
  const calculatedScore = scores.reduce((sum, item) => sum + item.score, 0);
  const critical = issues.some((item) => item.severity === "critical") || placeholderCounts.missing > 0;
  const major = issues.some((item) => item.severity === "major") || placeholderCounts.proof > 0;
  const initialScore = calculatedScore > 0 ? calculatedScore : integer(source.score, 0, 100);
  const score = critical ? Math.min(initialScore, 69) : major ? Math.min(initialScore, 79) : initialScore;
  const status: PlanReviewReport["status"] = critical ? "blocked" : major || score < 80 ? "revise" : "ready";

  return {
    status,
    submissionReady: status === "ready",
    score,
    verdict: text(
      source.verdict,
      status === "ready"
        ? "현재 자료 기준으로 제출 전 최종 사실 확인 단계입니다."
        : "심사에서 지적될 가능성이 높은 부분을 먼저 보완해야 합니다.",
    ),
    strengths: strings(source.strengths, 6),
    scores,
    issues,
    evidenceChecklist: Array.from(
      new Set([
        ...strings(source.evidenceChecklist, 16),
        ...issues.map((item) => item.evidenceNeeded).filter(Boolean),
      ]),
    ).slice(0, 20),
    formCompliance: strings(source.formCompliance, 12),
    missingCount: placeholderCounts.missing,
    proofCount: placeholderCounts.proof,
  };
}

export function reviewReportSections(report: PlanReviewReport): PlanDocxSection[] {
  const status =
    report.status === "ready" ? "제출 전 사실 확인" : report.status === "blocked" ? "제출 보류" : "수정 필요";
  const issueLines = report.issues.length
    ? report.issues.map(
        (item, index) =>
          `${index + 1}. [${item.severity === "critical" ? "치명" : item.severity === "major" ? "중요" : "보완"}] ${item.section} — ${item.issue}\n조치: ${item.action}${item.evidenceNeeded ? `\n필요 자료: ${item.evidenceNeeded}` : ""}`,
      )
    : ["심사 관점의 중대한 지적이 발견되지 않았습니다. 최종 사실과 공고 원문은 신청자가 직접 확인해야 합니다."];
  return [
    {
      heading: "[별첨] 심사위원 관점 제출 준비도",
      content: `판정: ${status}\n제출 준비도: ${report.score}/100\n검토 의견: ${report.verdict}\n\n${issueLines.join("\n\n")}`,
    },
    {
      heading: "[별첨] 제출 전 증빙 체크리스트",
      content: report.evidenceChecklist.length
        ? report.evidenceChecklist.map((item) => `- ${item}`).join("\n")
        : "- 사업계획서의 모든 수치·실적·계약·고객 주장을 원본 자료와 대조\n- 공고문 최신본의 신청 자격·분량·제출서류를 최종 확인",
    },
  ];
}
