import type { VizData } from "@/lib/viz/svg";

export type EvidenceSourceType = "official" | "company" | "independent" | "user";

export interface EvidenceSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  checkedAt: string;
  pageAge?: string;
  accessNote?: string;
  sourceType: EvidenceSourceType;
  claim: string;
  excerpt: string;
  verified: boolean;
}

export interface CompetitorFact {
  criterion: string;
  value: string;
  evidenceIds: string[];
}

export interface CompetitorProfile {
  name: string;
  url: string;
  selectionReason: string;
  overlapScore: number;
  facts: CompetitorFact[];
}

export interface EvidenceGap {
  id: string;
  label: string;
  whyCritical: string;
  suggestedAction: string;
  affectedDiagrams: string[];
}

export interface EvidencePack {
  checkedAt: string;
  sources: EvidenceSource[];
  competitorCandidates: string[];
  competitors: CompetitorProfile[];
  conflicts: string[];
  gaps: EvidenceGap[];
  summary: string;
}

export function verifiedEvidenceIds(pack: EvidencePack): string[] {
  return pack.sources.filter((source) => source.verified).map((source) => source.id);
}

export interface StrategyClaim {
  claim: string;
  evidenceIds: string[];
  status: "verified" | "stated" | "plan" | "missing";
}

export interface StrategyPack {
  problem: string;
  customer: string;
  solution: string;
  competitiveAdvantage: string;
  advantageStatus: "verified" | "opportunity" | "none";
  businessModel: string;
  goToMarket: string;
  roadmap: string;
  kpis: string[];
  claims: StrategyClaim[];
  diagrams: VizData;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function clean(value: unknown, limit = 600): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function list(value: unknown, limit: number, itemLimit = 300): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => clean(item, itemLimit)).filter(Boolean)),
  ).slice(0, limit);
}

function safeUrl(value: unknown): string {
  const raw = clean(value, 1000);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeEvidencePack(raw: unknown, searchedSources: EvidenceSource[] = []): EvidencePack {
  const source = record(raw);
  const searchedUrls = new Set(searchedSources.map((item) => safeUrl(item.url)).filter(Boolean));
  const checkedAt = /^\d{4}-\d{2}-\d{2}/.test(clean(source.checkedAt, 40))
    ? clean(source.checkedAt, 40)
    : new Date().toISOString();
  const receivedSources = Array.isArray(source.sources) ? source.sources.map(record) : [];
  const sources: EvidenceSource[] = receivedSources.slice(0, 20).map((item, index) => {
    const type = clean(item.sourceType, 30);
    const normalizedType = (["official", "company", "independent", "user"].includes(type)
      ? type
      : "independent") as EvidenceSourceType;
    const url = safeUrl(item.url);
    const claim = clean(item.claim, 800);
    const excerpt = clean(item.excerpt, 800);
    return {
      id: clean(item.id, 60) || `source-${index + 1}`,
      title: clean(item.title, 240) || "제목 확인 필요",
      url,
      publisher: clean(item.publisher, 160),
      checkedAt,
      pageAge: clean(item.pageAge, 80) || undefined,
      accessNote: clean(item.accessNote, 160) || undefined,
      sourceType: normalizedType,
      claim,
      excerpt,
      verified:
        normalizedType === "user"
          ? item.verified === true && Boolean(claim || excerpt)
          : item.verified === true && searchedUrls.has(url),
    };
  });
  for (const searched of searchedSources) {
    if (!searched.url || sources.some((item) => item.url === searched.url)) continue;
    const usedIds = new Set(sources.map((item) => item.id));
    let id = searched.id || `web-${sources.length + 1}`;
    let suffix = 2;
    while (usedIds.has(id)) id = `${searched.id || "web"}-${suffix++}`;
    sources.push({ ...searched, id });
  }
  const validIds = new Set(sources.filter((item) => item.verified).map((item) => item.id));
  const competitors = (Array.isArray(source.competitors) ? source.competitors : [])
    .map(record)
    .map((item) => ({
      name: clean(item.name, 120),
      url: safeUrl(item.url),
      selectionReason: clean(item.selectionReason, 500),
      overlapScore: Math.max(0, Math.min(100, Math.round(Number(item.overlapScore) || 0))),
      facts: (Array.isArray(item.facts) ? item.facts : [])
        .map(record)
        .slice(0, 6)
        .map((fact) => ({
          criterion: clean(fact.criterion, 120),
          value: clean(fact.value, 400),
          evidenceIds: list(fact.evidenceIds, 4, 60).filter((id) => validIds.has(id)),
        }))
        .filter((fact) => fact.criterion && fact.value && fact.evidenceIds.length > 0),
    }))
    .filter((item) => item.name && item.url && item.facts.length > 0)
    .slice(0, 2);
  const gaps = (Array.isArray(source.gaps) ? source.gaps : [])
    .map(record)
    .slice(0, 12)
    .map((item, index) => ({
      id: clean(item.id, 60) || `gap-${index + 1}`,
      label: clean(item.label, 300),
      whyCritical: clean(item.whyCritical, 500),
      suggestedAction: clean(item.suggestedAction, 500),
      affectedDiagrams: list(item.affectedDiagrams, 6, 60),
    }))
    .filter((item) => item.label);

  return {
    checkedAt,
    sources: sources.slice(0, 24),
    competitorCandidates: list(source.competitorCandidates, 5, 120),
    competitors,
    conflicts: list(source.conflicts, 10, 600),
    gaps,
    summary: clean(source.summary, 1200),
  };
}

function normalizeStages(value: unknown, limit: number): string[] {
  return list(value, limit, 120);
}

function evidenceIds(value: unknown, validIds: Set<string>): string[] {
  return list(value, 8, 60).filter((id) => validIds.has(id));
}

export function normalizeStrategyPack(raw: unknown, evidence: EvidencePack): StrategyPack {
  const source = record(raw);
  const rawDiagrams = record(source.diagrams);
  const validIds = new Set(evidence.sources.filter((item) => item.verified).map((item) => item.id));
  const tss = record(rawDiagrams.tamSamSom);
  const process = record(rawDiagrams.process);
  const comparison = record(rawDiagrams.comparison);
  const journey = record(rawDiagrams.journey);
  const funnel = record(rawDiagrams.funnel);
  const revenue = record(rawDiagrams.revenue);
  const validation = record(rawDiagrams.validation);
  const roadmap = record(rawDiagrams.roadmap);
  const diagrams: VizData = {};

  const tssIds = evidenceIds(tss.evidenceIds, validIds);
  if (clean(tss.evidenceStatus, 30) === "verified" && clean(tss.tam) && clean(tss.sam) && clean(tss.som) && tssIds.length > 0) {
    diagrams.tamSamSom = {
      tam: clean(tss.tam, 120),
      sam: clean(tss.sam, 120),
      som: clean(tss.som, 120),
      note: clean(tss.note, 300),
      evidenceIds: tssIds,
      evidenceStatus: "verified",
      sourceNote: clean(tss.sourceNote, 500),
      targetSection: clean(tss.targetSection, 160),
    };
  }
  const processStages = normalizeStages(process.stages, 6);
  const processIds = evidenceIds(process.evidenceIds, validIds);
  if (clean(process.evidenceStatus, 30) === "verified" && processStages.length >= 3 && processIds.length > 0) {
    diagrams.process = {
      stages: processStages,
      evidenceIds: processIds,
      evidenceStatus: "verified",
      sourceNote: clean(process.sourceNote, 300),
      targetSection: clean(process.targetSection, 160),
    };
  }
  const compRows = (Array.isArray(comparison.rows) ? comparison.rows : [])
    .map(record)
    .slice(0, 5)
    .map((item) => ({
      criterion: clean(item.criterion, 100),
      ours: clean(item.ours, 180),
      competitor1: clean(item.competitor1, 180),
      competitor2: clean(item.competitor2, 180),
      evidenceIds: evidenceIds(item.evidenceIds, validIds),
    }))
    .filter((item) => item.criterion && item.ours && item.evidenceIds.length > 0);
  if (clean(comparison.evidenceStatus, 30) === "verified" && compRows.length >= 2 && evidence.competitors.length === 2) {
    diagrams.comparison = {
      competitorNames: evidence.competitors.map((item) => item.name) as [string, string],
      rows: compRows,
      evidenceStatus: "verified",
      sourceNote: clean(comparison.sourceNote, 500),
      targetSection: clean(comparison.targetSection, 160),
    };
  }
  const journeyStages = normalizeStages(journey.stages, 6);
  const journeyIds = evidenceIds(journey.evidenceIds, validIds);
  if (clean(journey.evidenceStatus, 30) === "verified" && journeyStages.length >= 3 && journeyIds.length > 0) {
    diagrams.journey = {
      stages: journeyStages,
      evidenceIds: journeyIds,
      evidenceStatus: "verified",
      sourceNote: clean(journey.sourceNote, 300),
      targetSection: clean(journey.targetSection, 160),
    };
  }
  const funnelStages = normalizeStages(funnel.stages, 5);
  const funnelIds = evidenceIds(funnel.evidenceIds, validIds);
  if (clean(funnel.evidenceStatus, 30) === "verified" && funnelStages.length >= 3 && funnelIds.length > 0) {
    diagrams.funnel = {
      stages: funnelStages,
      evidenceIds: funnelIds,
      evidenceStatus: "verified",
      sourceNote: clean(funnel.sourceNote, 300),
      targetSection: clean(funnel.targetSection, 160),
    };
  }
  const revenueItems = normalizeStages(revenue.items, 4);
  const revenueIds = evidenceIds(revenue.evidenceIds, validIds);
  if (clean(revenue.evidenceStatus, 30) === "verified" && revenueItems.length >= 2 && revenueIds.length > 0) {
    diagrams.revenue = {
      items: revenueItems,
      evidenceIds: revenueIds,
      evidenceStatus: "verified",
      sourceNote: clean(revenue.sourceNote, 300),
      targetSection: clean(revenue.targetSection, 160),
    };
  }
  const validationMetrics = (Array.isArray(validation.metrics) ? validation.metrics : [])
    .map(record)
    .slice(0, 6)
    .map((item) => ({
      label: clean(item.label, 100),
      value: clean(item.value, 80),
      note: clean(item.note, 120) || undefined,
    }))
    .filter((item) => item.label && item.value);
  const validationIds = evidenceIds(validation.evidenceIds, validIds);
  if (
    clean(validation.evidenceStatus, 30) === "verified" &&
    validationMetrics.length >= 2 &&
    validationIds.length > 0
  ) {
    diagrams.validation = {
      metrics: validationMetrics,
      evidenceIds: validationIds,
      evidenceStatus: "verified",
      sourceNote: clean(validation.sourceNote, 300),
      targetSection: clean(validation.targetSection, 160),
    };
  }
  const roadmapItems = (Array.isArray(roadmap.items) ? roadmap.items : [])
    .map(record)
    .slice(0, 6)
    .map((item) => ({
      period: clean(item.period, 80),
      action: clean(item.action, 180),
      output: clean(item.output, 180),
      owner: clean(item.owner, 100),
    }))
    .filter((item) => item.period && item.action && item.output && item.owner);
  const roadmapIds = evidenceIds(roadmap.evidenceIds, validIds);
  if (clean(roadmap.evidenceStatus, 30) === "verified" && roadmapItems.length >= 2 && roadmapIds.length > 0) {
    diagrams.roadmap = {
      items: roadmapItems,
      evidenceIds: roadmapIds,
      evidenceStatus: "verified",
      sourceNote: clean(roadmap.sourceNote, 300) || "사업자 입력 실행계획",
      targetSection: clean(roadmap.targetSection, 160),
    };
  }

  const claims = (Array.isArray(source.claims) ? source.claims : [])
    .map(record)
    .slice(0, 30)
    .map((item) => {
      const status = clean(item.status, 30);
      const ids = evidenceIds(item.evidenceIds, validIds);
      const normalizedStatus = (["verified", "stated", "plan", "missing"].includes(status)
        ? status
        : "missing") as StrategyClaim["status"];
      return {
        claim: clean(item.claim, 600),
        evidenceIds: ids,
        status: normalizedStatus === "verified" && ids.length === 0 ? "missing" as const : normalizedStatus,
      };
    })
    .filter((item) => item.claim);
  const advantageStatus = clean(source.advantageStatus, 30);
  const normalizedAdvantageStatus = (["verified", "opportunity", "none"].includes(advantageStatus)
    ? advantageStatus
    : "none") as StrategyPack["advantageStatus"];
  const safeAdvantageStatus: StrategyPack["advantageStatus"] =
    normalizedAdvantageStatus === "verified" && evidence.competitors.length !== 2
      ? evidence.competitors.length > 0
        ? "opportunity"
        : "none"
      : normalizedAdvantageStatus;
  return {
    problem: clean(source.problem, 1200),
    customer: clean(source.customer, 1200),
    solution: clean(source.solution, 1200),
    competitiveAdvantage: clean(source.competitiveAdvantage, 1200),
    advantageStatus: safeAdvantageStatus,
    businessModel: clean(source.businessModel, 1200),
    goToMarket: clean(source.goToMarket, 1200),
    roadmap: clean(source.roadmap, 1200),
    kpis: list(source.kpis, 8, 240),
    claims,
    diagrams,
  };
}

// 외부 검색이나 전략 JSON 생성이 일시적으로 실패해도 첫 초안 자체를 막지 않는다.
// 신청자가 직접 제공한 설명만 stated로 보존하고, 확인하지 못한 시장·경쟁 우위는 명시적으로 비운다.
export function buildFallbackStrategyPack(evidence: EvidencePack): StrategyPack {
  const userSource = evidence.sources.find(
    (source) => source.sourceType === "user" && source.verified,
  );
  const statement = (userSource?.excerpt || evidence.summary || "신청자가 제공한 사업 설명")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  const evidenceIds = userSource ? [userSource.id] : [];
  return normalizeStrategyPack(
    {
      problem: `신청자 설명에서 확인한 문제 상황을 기준으로 정리함. ${statement}`,
      customer: "신청자가 설명한 사용자·결제자 후보를 초안에 반영하고 제출 전 실제 고객 범위를 확인해야 함.",
      solution: "신청자가 설명한 제품·서비스 제공 방식과 앞으로의 실행계획을 구분해 초안에 반영함.",
      competitiveAdvantage:
        "공식 경쟁조사를 완료하지 못했으므로 경쟁우위는 확정하지 않고 동일 기준 비교자료를 보충해야 함.",
      advantageStatus: "none",
      businessModel: "가격·결제시점·원가·반복구매 구조는 신청자 원답변 범위에서 작성하고 확인되지 않은 수치는 표시함.",
      goToMarket: "첫 고객 확보 경로와 검증계획은 신청자 원답변을 기준으로 작성함.",
      roadmap: "향후 일정은 현재 완료 실적과 구분하고 시점·담당·산출물·지표를 보충하도록 작성함.",
      kpis: [],
      claims: statement
        ? [{ claim: statement, evidenceIds, status: "stated" }]
        : [],
      diagrams: {},
    },
    evidence,
  );
}

function diagramSourceNote(ids: string[], evidence: EvidencePack): string {
  const unique = Array.from(new Set(ids));
  return unique
    .map((id) => evidence.sources.find((source) => source.id === id && source.verified))
    .filter((source): source is EvidenceSource => Boolean(source))
    .slice(0, 3)
    .map((source) => {
      const checked = source.checkedAt.slice(0, 10);
      return `${source.publisher || source.title} (${checked}) ${source.url}`.trim();
    })
    .join(" · ");
}

// AI가 출처명을 요약해 왜곡하지 않도록 최종 출처 표기는 검증된 evidence id로 서버가 다시 만든다.
export function attachDiagramSourceNotes(strategy: StrategyPack, evidence: EvidencePack): StrategyPack {
  const diagrams = structuredClone(strategy.diagrams);
  if (diagrams.tamSamSom?.evidenceIds?.length) {
    diagrams.tamSamSom.sourceNote = diagramSourceNote(diagrams.tamSamSom.evidenceIds, evidence);
  }
  if (diagrams.process?.evidenceIds?.length) {
    diagrams.process.sourceNote = diagramSourceNote(diagrams.process.evidenceIds, evidence);
  }
  if (diagrams.comparison) {
    const ids = diagrams.comparison.rows.flatMap((row) => row.evidenceIds ?? []);
    diagrams.comparison.sourceNote = diagramSourceNote(ids, evidence);
  }
  if (diagrams.journey?.evidenceIds?.length) {
    diagrams.journey.sourceNote = diagramSourceNote(diagrams.journey.evidenceIds, evidence);
  }
  if (diagrams.funnel?.evidenceIds?.length) {
    diagrams.funnel.sourceNote = diagramSourceNote(diagrams.funnel.evidenceIds, evidence);
  }
  if (diagrams.revenue?.evidenceIds?.length) {
    diagrams.revenue.sourceNote = diagramSourceNote(diagrams.revenue.evidenceIds, evidence);
  }
  if (diagrams.validation?.evidenceIds?.length) {
    diagrams.validation.sourceNote = diagramSourceNote(diagrams.validation.evidenceIds, evidence);
  }
  if (diagrams.roadmap?.evidenceIds?.length) {
    diagrams.roadmap.sourceNote = diagramSourceNote(diagrams.roadmap.evidenceIds, evidence);
  }
  return { ...strategy, diagrams };
}

export function evidencePackPrompt(pack: EvidencePack): string {
  return JSON.stringify(pack, null, 2).slice(0, 60_000);
}
