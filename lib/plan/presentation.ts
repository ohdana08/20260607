import type { PlanDocxSection } from "./docx";
import type { EvidencePack, EvidenceSource, StrategyPack } from "./strategy";

export const PRESENTATION_STAGE_DEFS = [
  { id: "setup", label: "발표 조건" },
  { id: "cover", label: "표지·한 줄 정의" },
  { id: "founder", label: "창업 배경" },
  { id: "problem", label: "고객 문제" },
  { id: "market", label: "시장·수요" },
  { id: "solution", label: "해결책·작동 방식" },
  { id: "validation", label: "준비·검증 수준" },
  { id: "competition", label: "경쟁·차별성" },
  { id: "business_model", label: "수익모델" },
  { id: "go_to_market", label: "사업화·고객 확보" },
  { id: "roadmap_budget", label: "일정·사업비" },
  { id: "team_partners", label: "팀·파트너" },
  { id: "vision", label: "비전" },
  { id: "qna", label: "발표·질의응답" },
] as const;

export type PresentationStageId = (typeof PRESENTATION_STAGE_DEFS)[number]["id"];
export type PresentationClaimOrigin = "plan" | "user" | "upload" | "external";
export type PresentationClaimStatus = "verified" | "stated" | "hypothesis" | "plan" | "missing";

export interface PresentationClaim {
  id: string;
  text: string;
  stageId: PresentationStageId;
  origin: PresentationClaimOrigin;
  status: PresentationClaimStatus;
  evidenceIds: string[];
  requiresEvidence: boolean;
  assumption: string;
  verificationPlan: string;
}

export interface PresentationProgress {
  stageId: PresentationStageId;
  stageLabel: string;
  stageIndex: number;
  totalStages: number;
  completedStageIds: PresentationStageId[];
  ready: boolean;
  criticalMissing: string[];
  coveredSummary: string;
}

export interface PresentationInterviewReply {
  reply: string;
  progress: PresentationProgress;
  claims: PresentationClaim[];
}

export interface PresentationSlide {
  id: string;
  stageId: PresentationStageId;
  title: string;
  headline: string;
  bullets: string[];
  visualBrief: string;
  speakerNotes: string;
  claimIds: string[];
  sourceSectionHeadings: string[];
  sourceNotes: string[];
}

export interface PresentationSourceCoverage {
  sectionHeading: string;
  slideIds: string[];
  includedInAppendix: boolean;
}

export interface PresentationQa {
  id: string;
  question: string;
  answer: string;
  risk: string;
  claimIds: string[];
  sourceNotes: string[];
}

export interface PresentationPack {
  title: string;
  subtitle: string;
  audience: string;
  durationMinutes: number;
  narrative: string;
  slides: PresentationSlide[];
  qa: PresentationQa[];
  claimLedger: PresentationClaim[];
  sourceCoverage: PresentationSourceCoverage[];
  generatedAt: string;
}

export type PresentationIssueSeverity = "critical" | "major" | "minor";

export interface PresentationReviewIssue {
  severity: PresentationIssueSeverity;
  slideId: string;
  issue: string;
  action: string;
}

export interface PresentationReview {
  status: "ready" | "revise" | "blocked";
  exportReady: boolean;
  score: number;
  verdict: string;
  issues: PresentationReviewIssue[];
  coveredClaimCount: number;
  totalClaimCount: number;
  coveredSectionCount: number;
  totalSectionCount: number;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function clean(value: unknown, limit = 800): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function strings(value: unknown, limit: number, itemLimit = 500): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => clean(item, itemLimit)).filter(Boolean)),
  ).slice(0, limit);
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function stageId(value: unknown, fallback: PresentationStageId = "problem"): PresentationStageId {
  const candidate = clean(value, 40);
  return PRESENTATION_STAGE_DEFS.some((item) => item.id === candidate)
    ? (candidate as PresentationStageId)
    : fallback;
}

function stageLabel(id: PresentationStageId): string {
  return PRESENTATION_STAGE_DEFS.find((item) => item.id === id)?.label ?? "발표자료";
}

function claimId(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42);
  return `claim-${slug || index + 1}`;
}

function normalizeClaim(
  raw: unknown,
  index: number,
  validEvidenceIds: Set<string>,
): PresentationClaim | null {
  const source = objectOf(raw);
  const text = clean(source.text ?? source.claim, 1000);
  if (!text) return null;
  const receivedOrigin = clean(source.origin, 30);
  const origin = (["plan", "user", "upload", "external"].includes(receivedOrigin)
    ? receivedOrigin
    : "user") as PresentationClaimOrigin;
  const receivedStatus = clean(source.status, 30);
  let status = (["verified", "stated", "hypothesis", "plan", "missing"].includes(receivedStatus)
    ? receivedStatus
    : "stated") as PresentationClaimStatus;
  const evidenceIds = strings(source.evidenceIds, 8, 80).filter((id) => validEvidenceIds.has(id));
  if (status === "verified" && evidenceIds.length === 0) status = "stated";
  if (origin === "external" && evidenceIds.length === 0) status = "missing";
  return {
    id: clean(source.id, 80) || claimId(text, index),
    text,
    stageId: stageId(source.stageId),
    origin,
    status,
    evidenceIds,
    requiresEvidence:
      source.requiresEvidence === true ||
      status === "missing" ||
      (status === "stated" && /\d|매출|고객|계약|협약|특허|인증|수상|팀원|경력|MVP|프로토타입/i.test(text)),
    assumption: clean(source.assumption, 500),
    verificationPlan: clean(source.verificationPlan, 500),
  };
}

export function normalizePresentationClaims(raw: unknown, evidence: EvidencePack): PresentationClaim[] {
  const validEvidenceIds = new Set(
    evidence.sources.filter((source) => source.verified).map((source) => source.id),
  );
  const received = Array.isArray(raw) ? raw : [];
  const claims = received
    .slice(0, 80)
    .map((item, index) => normalizeClaim(item, index, validEvidenceIds))
    .filter((item): item is PresentationClaim => Boolean(item));
  const merged = mergePresentationClaims([], claims);
  const seenIds = new Set<string>();
  return merged.map((claim) => {
    let id = claim.id;
    let suffix = 2;
    while (seenIds.has(id)) id = `${claim.id}-${suffix++}`;
    seenIds.add(id);
    return id === claim.id ? claim : { ...claim, id };
  });
}

export function mergePresentationClaims(
  previous: PresentationClaim[],
  incoming: PresentationClaim[],
): PresentationClaim[] {
  const merged = new Map<string, PresentationClaim>();
  for (const item of [...previous, ...incoming]) {
    const key = item.text.toLowerCase().replace(/\s+/g, " ").trim();
    const before = merged.get(key);
    merged.set(key, before ? {
      ...before,
      ...item,
      id: before.id,
      evidenceIds: Array.from(new Set([...before.evidenceIds, ...item.evidenceIds])),
      requiresEvidence: before.requiresEvidence || item.requiresEvidence,
      assumption: item.assumption || before.assumption,
      verificationPlan: item.verificationPlan || before.verificationPlan,
    } : item);
  }
  const seenIds = new Set<string>();
  return Array.from(merged.values()).slice(0, 100).map((claim) => {
    let id = claim.id;
    let suffix = 2;
    while (seenIds.has(id)) id = `${claim.id}-${suffix++}`;
    seenIds.add(id);
    return id === claim.id ? claim : { ...claim, id };
  });
}

export function normalizePresentationInterviewReply(
  raw: unknown,
  evidence: EvidencePack,
): PresentationInterviewReply {
  const source = objectOf(raw);
  const progressSource = objectOf(source.progress);
  const currentStage = stageId(progressSource.stageId, "setup");
  const completedStageIds = strings(progressSource.completedStageIds, PRESENTATION_STAGE_DEFS.length, 40)
    .filter((id): id is PresentationStageId => PRESENTATION_STAGE_DEFS.some((item) => item.id === id));
  const criticalMissing = strings(progressSource.criticalMissing, 12, 500);
  const stageIndex = PRESENTATION_STAGE_DEFS.findIndex((item) => item.id === currentStage);
  const ready =
    progressSource.ready === true &&
    criticalMissing.length === 0 &&
    PRESENTATION_STAGE_DEFS.filter((item) => item.id !== "qna").every((item) => completedStageIds.includes(item.id));
  return {
    reply: clean(source.reply, 3000) || "지금까지 내용을 확인했어요. 다음 내용을 하나씩 더 들려주세요.",
    progress: {
      stageId: currentStage,
      stageLabel: stageLabel(currentStage),
      stageIndex: Math.max(0, stageIndex),
      totalStages: PRESENTATION_STAGE_DEFS.length,
      completedStageIds,
      ready,
      criticalMissing,
      coveredSummary: clean(progressSource.coveredSummary, 1200),
    },
    claims: normalizePresentationClaims(source.claims, evidence),
  };
}

function sourceNote(ids: string[], sources: EvidenceSource[]): string[] {
  return Array.from(new Set(ids))
    .map((id) => sources.find((source) => source.id === id && source.verified))
    .filter((source): source is EvidenceSource => Boolean(source))
    .map((source) => `${source.publisher || source.title} (${source.checkedAt.slice(0, 10)}) ${source.url}`.trim())
    .slice(0, 6);
}

export function normalizePresentationPack(
  raw: unknown,
  args: {
    evidence: EvidencePack;
    strategy: StrategyPack;
    sections: PlanDocxSection[];
    claims: PresentationClaim[];
    fallbackTitle: string;
  },
): PresentationPack {
  const source = objectOf(raw);
  const validClaimIds = new Set(args.claims.map((claim) => claim.id));
  const validSectionHeadings = new Set(args.sections.map((section) => section.heading));
  const receivedSlides = Array.isArray(source.slides) ? source.slides.map(objectOf) : [];
  const slides: PresentationSlide[] = receivedSlides.slice(0, 16).map((slide, index) => {
    const ids = strings(slide.claimIds, 18, 80).filter((id) => validClaimIds.has(id));
    const headings = strings(slide.sourceSectionHeadings, 12, 180).filter((heading) =>
      validSectionHeadings.has(heading),
    );
    const evidenceIds = ids.flatMap(
      (id) => args.claims.find((claim) => claim.id === id)?.evidenceIds ?? [],
    );
    const currentStage = stageId(slide.stageId, index === 0 ? "cover" : "problem");
    return {
      id: clean(slide.id, 80) || `slide-${index + 1}`,
      stageId: currentStage,
      title: clean(slide.title, 100) || `${index + 1}. ${stageLabel(currentStage)}`,
      headline: clean(slide.headline, 180),
      bullets: strings(slide.bullets, 5, 180),
      visualBrief: clean(slide.visualBrief, 500),
      speakerNotes: clean(slide.speakerNotes, 3000),
      claimIds: ids,
      sourceSectionHeadings: headings,
      sourceNotes: sourceNote(evidenceIds, args.evidence.sources),
    };
  });
  const sourceCoverage = args.sections.map((section) => {
    const slideIds = slides
      .filter((slide) => slide.sourceSectionHeadings.includes(section.heading))
      .map((slide) => slide.id);
    return {
      sectionHeading: section.heading,
      slideIds,
      includedInAppendix: slideIds.length === 0,
    };
  });
  const receivedQa = Array.isArray(source.qa) ? source.qa.map(objectOf) : [];
  const qa: PresentationQa[] = receivedQa.slice(0, 10).map((item, index) => {
    const ids = strings(item.claimIds, 12, 80).filter((id) => validClaimIds.has(id));
    const evidenceIds = ids.flatMap(
      (id) => args.claims.find((claim) => claim.id === id)?.evidenceIds ?? [],
    );
    return {
      id: clean(item.id, 80) || `qa-${index + 1}`,
      question: clean(item.question, 300),
      answer: clean(item.answer, 1800),
      risk: clean(item.risk, 600),
      claimIds: ids,
      sourceNotes: sourceNote(evidenceIds, args.evidence.sources),
    };
  }).filter((item) => item.question && item.answer);
  return {
    title: clean(source.title, 180) || args.fallbackTitle,
    subtitle: clean(source.subtitle, 220),
    audience: clean(source.audience, 160) || "정부지원사업 발표평가 심사위원",
    durationMinutes: integer(source.durationMinutes, 3, 20, 7),
    narrative: clean(source.narrative, 1400),
    slides,
    qa,
    claimLedger: args.claims,
    sourceCoverage,
    generatedAt: new Date().toISOString(),
  };
}

function fallbackSectionForStage(
  stage: PresentationStageId,
  sections: PlanDocxSection[],
): PlanDocxSection | undefined {
  const headingPatterns: Partial<Record<PresentationStageId, RegExp>> = {
    founder: /대표|팀|역량|배경/,
    problem: /문제|필요|배경/,
    market: /문제|성장|시장|수요|고객/,
    solution: /해결|실현|기술|제품|서비스/,
    validation: /실현|검증|성과|실적|제품/,
    competition: /차별|경쟁|실현/,
    business_model: /수익|가격|매출|사업화|성장/,
    go_to_market: /시장진입|사업화|성장|고객/,
    roadmap_budget: /일정|사업비|자금|예산|성장/,
    team_partners: /팀|인력|대표|역량|파트너/,
    vision: /성장|비전|목표|사업화/,
  };
  const pattern = headingPatterns[stage];
  return sections.find((section) => pattern?.test(section.heading)) ??
    sections.find((section) => pattern?.test(section.content)) ??
    sections[0];
}

function fallbackBullets(content: string, stage: PresentationStageId): string[] {
  const stagePatterns: Partial<Record<PresentationStageId, RegExp>> = {
    founder: /대표|창업|경력|관찰|배경/,
    problem: /문제|위험|부담|누락|수작업/,
    market: /시장|기관|사업|예산|고객|수요/,
    solution: /제공|방식|입력|추출|검증|판단/,
    validation: /현재|검증|테스트|통과|처리시간|MVP/,
    competition: /경쟁|대안|차별|비교|미완료/,
    business_model: /가격|수익|매출|사용권|이용료/,
    go_to_market: /고객|기관|채널|영업|파일럿/,
    roadmap_budget: /개월|마일스톤|사업비|예산|산출물|KPI/,
    team_partners: /대표|인력|채용|파트너|역량/,
    vision: /목표|성과|계약|확장|재설계/,
  };
  const sentences = content
    .replace(/\[[^\]]+\]/g, "")
    .split(/\n+|(?<=[.!?다함임])\s+/)
    .map((item) => item.replace(/^[-•·]\s*/, "").trim())
    .filter(Boolean);
  const preferred = sentences.filter((item) => stagePatterns[stage]?.test(item));
  return Array.from(new Set([...preferred, ...sentences]))
    .slice(0, 4)
    .map((item) => item.slice(0, 120));
}

// 모델 응답이 잘리거나 형식이 깨져도 현재 사업계획서에서 검토용 발표자료를 만든다.
// 근거가 부족한 문구는 원문 표시를 그대로 보존하며 새로운 실적·수치를 만들지 않는다.
export function buildFallbackPresentationPack(args: {
  title: string;
  evidence: EvidencePack;
  strategy: StrategyPack;
  sections: PlanDocxSection[];
  claims: PresentationClaim[];
}): PresentationPack {
  const stages: PresentationStageId[] = [
    "cover",
    "founder",
    "problem",
    "market",
    "solution",
    "validation",
    "competition",
    "business_model",
    "go_to_market",
    "roadmap_budget",
    "team_partners",
    "vision",
  ];
  const slides = stages.map((stage, index) => {
    const section = fallbackSectionForStage(stage, args.sections);
    const stageClaims = args.claims.filter((claim) => claim.stageId === stage);
    const selectedClaims = stageClaims.length ? stageClaims : args.claims.slice(0, 2);
    const bullets = fallbackBullets(section?.content ?? "", stage);
    return {
      id: `slide-${index + 1}`,
      stageId: stage,
      title: stage === "cover" ? args.title : stageLabel(stage),
      headline:
        stage === "cover"
          ? args.strategy.solution || "신청자가 제공한 사업 설명을 바탕으로 만든 발표자료 초안"
          : bullets[0] || `${stageLabel(stage)}의 실제 사실과 계획을 확인하는 단계`,
      bullets:
        bullets.length > 0
          ? bullets
          : ["현재 사업계획서에 있는 설명을 기준으로 우선 구성", "제출 전 실제 자료와 수치 확인 필요"],
      visualBrief: "검토용 텍스트 중심 슬라이드. 확인 자료가 준비되면 표·도식으로 교체",
      speakerNotes:
        (section?.content || "현재 확보된 설명을 기준으로 발표하고, 확인되지 않은 내용은 향후 계획으로 구분함.")
          .slice(0, 2_400),
      claimIds: selectedClaims.map((claim) => claim.id),
      sourceSectionHeadings: section ? [section.heading] : [],
    };
  });
  const qaSeed = [
    ["이 문제가 실제 고객에게 얼마나 자주 발생합니까?", args.strategy.problem],
    ["기존 대안과 비교했을 때 확인된 차이는 무엇입니까?", args.strategy.competitiveAdvantage],
    ["현재까지 실제로 검증한 내용은 무엇입니까?", args.evidence.summary],
    ["어떤 방식으로 첫 고객을 확보할 계획입니까?", args.strategy.goToMarket],
    ["지원기간 동안 무엇을 완성하고 측정합니까?", args.strategy.roadmap],
  ];
  const qa = qaSeed.map(([question, answer]) => ({
    question,
    answer: answer || "현재 사업계획서의 해당 내용을 기준으로 답변하되, 확인되지 않은 수치와 실적은 제출 전에 보충해야 함.",
    risk: "확인되지 않은 현재 실적·수치를 확정 사실처럼 말하지 않음.",
    claimIds: args.claims.slice(0, 2).map((claim) => claim.id),
  }));
  return normalizePresentationPack(
    {
      title: args.title,
      subtitle: "현재 사업계획서 기준 검토용 발표자료",
      audience: "정부지원사업 발표평가 심사위원",
      durationMinutes: 7,
      narrative: args.strategy.problem || args.strategy.solution,
      slides,
      qa,
    },
    {
      evidence: args.evidence,
      strategy: args.strategy,
      sections: args.sections,
      claims: args.claims,
      fallbackTitle: args.title,
    },
  );
}

const REQUIRED_SLIDE_STAGES: PresentationStageId[] = [
  "cover",
  "problem",
  "market",
  "solution",
  "validation",
  "competition",
  "business_model",
  "go_to_market",
  "roadmap_budget",
  "team_partners",
  "vision",
];

export function reviewPresentationPack(pack: PresentationPack): PresentationReview {
  const issues: PresentationReviewIssue[] = [];
  if (pack.slides.length < 10 || pack.slides.length > 16) {
    issues.push({
      severity: "major",
      slideId: "전체",
      issue: `발표 슬라이드는 10~16장이 적절하지만 현재 ${pack.slides.length}장입니다.`,
      action: "핵심 논리를 유지하며 슬라이드 수를 조정하세요.",
    });
  }
  for (const required of REQUIRED_SLIDE_STAGES) {
    if (!pack.slides.some((slide) => slide.stageId === required)) {
      issues.push({
        severity: "critical",
        slideId: "전체",
        issue: `${stageLabel(required)} 슬라이드가 없습니다.`,
        action: "해당 PSST 내용을 실제 답변과 근거로 보완하세요.",
      });
    }
  }
  for (const claim of pack.claimLedger) {
    if (claim.status === "missing") {
      issues.push({
        severity: "critical",
        slideId: claim.stageId,
        issue: `확인되지 않은 주장: ${claim.text}`,
        action: claim.verificationPlan || "원본 자료를 추가하거나 발표자료에서 제거하세요.",
      });
      continue;
    }
    if (claim.requiresEvidence && claim.status === "stated" && claim.evidenceIds.length === 0) {
      issues.push({
        severity: "critical",
        slideId: claim.stageId,
        issue: `현재 실적·수치에 확인 자료가 없습니다: ${claim.text}`,
        action: claim.verificationPlan || "결제·계약·고객·경력 등 해당 사실을 확인할 자료를 연결하세요.",
      });
    }
    if (claim.status === "hypothesis" && (!claim.assumption || !claim.verificationPlan)) {
      issues.push({
        severity: "major",
        slideId: claim.stageId,
        issue: `가설의 가정 또는 검증 방법이 부족합니다: ${claim.text}`,
        action: "가정·산식과 실제로 검증할 방법을 함께 적으세요.",
      });
    }
    if (claim.status === "plan" && !claim.verificationPlan) {
      issues.push({
        severity: "major",
        slideId: claim.stageId,
        issue: `향후 계획의 실행·확인 방법이 부족합니다: ${claim.text}`,
        action: "시점·담당·산출물·확인 지표를 연결하세요.",
      });
    }
  }
  for (const slide of pack.slides) {
    if (!slide.headline || slide.bullets.length === 0 || !slide.speakerNotes) {
      issues.push({
        severity: "major",
        slideId: slide.id,
        issue: "제목·핵심 문장·말하기 대본 중 비어 있는 항목이 있습니다.",
        action: "화면에는 핵심만, 대본에는 근거와 설명을 보완하세요.",
      });
    }
    if (slide.bullets.some((bullet) => bullet.length > 140)) {
      issues.push({
        severity: "minor",
        slideId: slide.id,
        issue: "한 화면에 긴 문장이 들어가 발표 가독성이 낮습니다.",
        action: "보이는 문장은 줄이고 세부 내용은 말하기 대본으로 옮기세요.",
      });
    }
  }
  if (pack.qa.length < 5) {
    issues.push({
      severity: "major",
      slideId: "질의응답",
      issue: `예상 질문·답변은 최소 5개가 필요하지만 현재 ${pack.qa.length}개입니다.`,
      action: "가장 약한 주장과 심사기준을 중심으로 예상 질문·대표자 답변을 보완하세요.",
    });
  }
  for (const item of pack.qa) {
    if (!item.question || !item.answer || item.claimIds.length === 0) {
      issues.push({
        severity: "major",
        slideId: item.id,
        issue: "예상 질문 답변에 연결된 실제 주장 또는 답변이 부족합니다.",
        action: "사업계획서·근거 장부의 주장과 연결해 대표자 언어로 답변하세요.",
      });
    }
  }
  const critical = issues.some((issue) => issue.severity === "critical");
  const major = issues.some((issue) => issue.severity === "major");
  const status: PresentationReview["status"] = critical ? "blocked" : major ? "revise" : "ready";
  const penalty = issues.reduce(
    (sum, issue) => sum + (issue.severity === "critical" ? 12 : issue.severity === "major" ? 6 : 2),
    0,
  );
  const coveredClaims = new Set(pack.slides.flatMap((slide) => slide.claimIds));
  const coveredSections = pack.sourceCoverage.filter(
    (item) => item.slideIds.length > 0 || item.includedInAppendix,
  ).length;
  return {
    status,
    exportReady: status === "ready",
    score: Math.max(0, Math.min(status === "ready" ? 100 : status === "revise" ? 79 : 69, 100 - penalty)),
    verdict:
      status === "ready"
        ? "현재 주장 장부와 출처 기준으로 발표자료 원고를 확정할 수 있습니다."
        : status === "blocked"
          ? "가짜 실적 또는 확인되지 않은 핵심 주장이 섞일 위험이 있어 발표자료 확정을 보류합니다."
          : "가설·계획의 산식과 실행 방법을 보완한 뒤 발표자료를 확정해야 합니다.",
    issues,
    coveredClaimCount: coveredClaims.size,
    totalClaimCount: pack.claimLedger.length,
    coveredSectionCount: coveredSections,
    totalSectionCount: pack.sourceCoverage.length,
  };
}

export function presentationContextPrompt(args: {
  program: { title?: string; summary?: string; target?: string; supportField?: string };
  sections: PlanDocxSection[];
  evidence: EvidencePack;
  strategy: StrategyPack;
  sourceConversation?: { role: string; content: string }[];
}): string {
  const conversation = (args.sourceConversation ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "신청자" : "도우미"}: ${message.content}`)
    .join("\n")
    .slice(-45_000);
  const sections = args.sections
    .slice(0, 80)
    .map((section) => `## ${section.heading}\n${section.content.slice(0, 9000)}`)
    .join("\n\n")
    .slice(0, 70_000);
  return `[지원사업]
- 사업명: ${args.program.title ?? "확인되지 않음"}
- 공고 개요: ${args.program.summary ?? "확인되지 않음"}
- 지원대상: ${args.program.target ?? "확인되지 않음"}
- 지원분야: ${args.program.supportField ?? "확인되지 않음"}

[검증을 통과한 사업계획서]
${sections}

[근거팩]
${JSON.stringify(args.evidence, null, 2).slice(0, 45_000)}

[전략팩]
${JSON.stringify(args.strategy, null, 2).slice(0, 30_000)}

[기존 티키타카 원답변]
${conversation || "별도 원답변 없음 — 사업계획서와 근거팩만 사용"}`;
}
