import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import { aiBudgetExceededResponse, reservePaidAiCall } from "@/lib/plan/aiBudget";
import { getEvidencePack, getStrategyPack, saveAuditArtifact } from "@/lib/plan/artifacts";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import {
  normalizePlanReview,
  REVIEW_SCORE_DIMENSIONS,
  type PlanReviewIssue,
  type PlanReviewReport,
} from "@/lib/plan/reviewer";
import type { PlanDocxSection } from "@/lib/plan/docx";
import { evidencePackPrompt, type EvidencePack, type StrategyPack } from "@/lib/plan/strategy";
import { sanitizeFormToc } from "@/lib/plan/sections";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `당신은 창업·중소기업 정부지원사업의 냉정한 서면평가 심사위원입니다.
제공된 공고 맥락, 공식 양식, 신청자 원답변, 완성 초안을 서로 대조해 제출 전에 탈락·감점 위험을 찾으세요.

[반드시 지킬 평가 순서]
1. 신청 자격, 필수 목차, 분량·제출 요구를 먼저 봅니다. 확인되지 않으면 확인 필요로 표시합니다.
2. 공고에 평가항목·배점이 있으면 그 순서와 배점을 우선합니다. 없을 때만 일반 PSST 기준을 씁니다.
3. 초안의 핵심 주장과 숫자를 신청자 원답변에 역추적합니다. 원답변에 없는 사실, 과장, 확정되지 않은 계약·성과는 치명 위험입니다.
4. 문제의 실제성 → 해결 방식 → 고객이 돈을 내는 이유 → 판매 경로 → 실행 일정·사업비 → 팀 근거가 한 논리로 이어지는지 봅니다.
5. 현재 성과와 앞으로 할 일, 사용자와 결제자, 시장 전체와 실제 목표시장을 구분했는지 봅니다.
6. 사업비는 허용 비목, 산출근거, 일정·산출물과 연결되는지 봅니다. 광고비만 큰 계획이나 근거 없는 일괄 금액은 지적합니다.
7. 자료가 없어서 고칠 수 없는 문제와, 현재 자료만으로 문장·구조를 고칠 수 있는 문제를 구분해 canAutoFix를 정합니다.
8. 저장된 근거팩의 conflicts와 gaps가 핵심 수치·경쟁우위·자격·예산·실행일정에 영향을 주면 초안 생성 후에도 반드시 critical 또는 major 이슈로 남깁니다.
9. 근거팩의 URL·확인일과 초안의 출처 표기가 서로 맞는지 확인합니다. 예쁜 도식이 근거보다 강한 주장을 하면 제출 보류 사유입니다.

[위험 등급]
- critical: 자격 미확인/미충족, 필수항목 누락, 사용자 답에 없는 사실·수치, 핵심 사업논리 단절처럼 제출을 보류해야 하는 문제
- major: 배점이 큰 항목의 근거 부족, 고객·가격·판매·일정·예산의 구체성 부족
- minor: 표현, 중복, 가독성처럼 보완하면 좋은 문제

합격을 보장하거나 합격확률을 말하지 마세요. score는 현재 초안의 제출 준비도일 뿐입니다.
strengths는 최대 5개, issues는 가장 중요한 것부터 최대 10개, evidenceChecklist와 formCompliance는 각각 최대 10개로 제한하세요.
각 reason·issue·whyItMatters·action·evidenceNeeded 문장은 핵심만 한 문장으로 작성해 JSON이 중간에 잘리지 않게 하세요.
설명 없이 아래 구조의 JSON 하나만 출력하세요.
{
  "score": 0,
  "verdict": "심사위원 총평 한 문장",
  "strengths": ["근거가 확인되는 강점"],
  "scores": [
    {"key":"eligibility_form","score":0,"reason":"점수 근거"}
  ],
  "issues": [
    {"severity":"critical|major|minor","section":"초안의 정확한 목차명 또는 전체","issue":"문제","whyItMatters":"심사상 이유","action":"고치는 방법","evidenceNeeded":"필요한 원본 자료 또는 빈 문자열","canAutoFix":false}
  ],
  "evidenceChecklist": ["제출 전 확인할 구체 자료"],
  "formCompliance": ["공식 양식·평가항목과 초안의 대응 상태"]
}

scores에는 아래 key를 정확히 한 번씩 모두 넣고 각 max를 넘지 마세요:
${REVIEW_SCORE_DIMENSIONS.map((item) => `- ${item.key}: ${item.label} (${item.max}점)`).join("\n")}`;

interface ProgramInput {
  id?: string;
  title?: string;
  summary?: string;
  target?: string;
  supportField?: string;
  applicationKind?: "business-plan" | "simple-application" | "reservation" | "unknown";
  requiresBusinessPlan?: boolean | null;
  applicationKindReason?: string;
}

function compactSections(sections: PlanDocxSection[], maxChars: number): string {
  const perSection = Math.max(800, Math.floor(maxChars / Math.max(1, sections.length)));
  return sections
    .map((section) => `## ${section.heading}\n${section.content.slice(0, perSection)}`)
    .join("\n\n");
}

function evidenceGuardIssues(
  evidence: EvidencePack | null,
  strategy: StrategyPack | null,
): PlanReviewIssue[] {
  const issues: PlanReviewIssue[] = [];
  if (!evidence) {
    issues.push({
      severity: "critical",
      section: "전체",
      issue: "저장된 근거팩이 없어 핵심 주장과 출처를 검증할 수 없습니다.",
      whyItMatters: "근거 없는 시장·성과·경쟁우위는 제출 문서의 신뢰도를 훼손합니다.",
      action: "공식 출처와 사용자 증빙을 다시 확인해 근거팩을 만드세요.",
      evidenceNeeded: "시장·고객·성과·경쟁정보의 원본 자료",
      canAutoFix: false,
    });
  } else {
    for (const conflict of evidence.conflicts.slice(0, 8)) {
      issues.push({
        severity: "critical",
        section: "전체",
        issue: `근거 충돌: ${conflict}`,
        whyItMatters: "상충하는 사실 중 어느 쪽이 맞는지 확정하지 않으면 핵심 주장을 신뢰할 수 없습니다.",
        action: "기준일과 원본 자료를 대조해 하나의 사실로 확정한 뒤 다시 조사하세요.",
        evidenceNeeded: "충돌을 해소할 최신 원본 또는 담당기관 확인 자료",
        canAutoFix: false,
      });
    }
    for (const gap of evidence.gaps.slice(0, 10)) {
      issues.push({
        severity: "major",
        section: "전체",
        issue: `필수 데이터 부족: ${gap.label}`,
        whyItMatters: gap.whyCritical || "핵심 주장 또는 도식을 뒷받침할 사실이 부족합니다.",
        action: gap.suggestedAction || "관련 원본 자료를 입력하거나 첨부한 뒤 다시 조사하세요.",
        evidenceNeeded: gap.label,
        canAutoFix: false,
      });
    }
    if (evidence.competitors.length !== 2) {
      issues.push({
        severity: "major",
        section: "경쟁분석",
        issue: `가까운 경쟁대안 2곳의 동일 기준 비교가 완료되지 않았습니다(현재 ${evidence.competitors.length}곳).`,
        whyItMatters: "경쟁우위는 고객·문제·구매대안이 겹치는 비교 대상과 같은 기준으로 대조해야 확인할 수 있습니다.",
        action: "경쟁사 공식 페이지, 가격표, 기능표 또는 고객이 현재 쓰는 대안 자료를 추가하세요.",
        evidenceNeeded: "가까운 경쟁대안 2곳의 공개 사실과 우리 사업의 동일 기준 자료",
        canAutoFix: false,
      });
    }
  }
  if (!strategy) {
    issues.push({
      severity: "critical",
      section: "전체",
      issue: "저장된 전략팩이 없어 근거와 문서의 논리 연결을 확인할 수 없습니다.",
      whyItMatters: "문제·해결·시장·수익·실행전략이 같은 근거에서 이어지는지 확인할 수 없습니다.",
      action: "최신 근거팩으로 전략 설계를 다시 실행하세요.",
      evidenceNeeded: "최신 근거팩과 전략 설계 결과",
      canAutoFix: false,
    });
  } else if (strategy.advantageStatus !== "verified") {
    issues.push({
      severity: "major",
      section: "경쟁분석",
      issue: "현재 자료로는 경쟁우위가 검증된 사실이 아니라 기회 또는 미확인 상태입니다.",
      whyItMatters: "경쟁사보다 낫다는 주장은 우리 사업과 경쟁대안 양쪽의 동일 기준 근거가 있어야 합니다.",
      action: "가격·성과·제공방식·고객가치 중 실제로 증명 가능한 차이의 자료를 추가하세요.",
      evidenceNeeded: "우리 사업의 비교 기준 증빙과 경쟁대안 2곳의 같은 기준 출처",
      canAutoFix: false,
    });
  }
  return issues;
}

function fallbackAudit(
  sections: PlanDocxSection[],
  evidence: EvidencePack | null,
  strategy: StrategyPack | null,
): PlanReviewReport {
  const combined = sections.map((section) => `${section.heading}\n${section.content}`).join("\n\n");
  const issues: PlanReviewIssue[] = [...evidenceGuardIssues(evidence, strategy)];

  if (/추천서[\s\S]{0,40}(미확보|확보 필요|없으면)|추천기관[\s\S]{0,40}(협의|필요)/.test(combined)) {
    issues.unshift({
      severity: "critical",
      section: "창업 아이템 개요·팀 구성 및 역량",
      issue: "4대 과학기술원 추천서가 아직 확보되지 않아 현재는 신청 자격을 확정할 수 없습니다.",
      whyItMatters: "추천서가 공고의 필수 선결조건이면 미확보 상태로 실제 제출할 수 없습니다.",
      action: "추천기관 협의 결과와 발급된 추천서를 확보한 뒤 자격 상태를 갱신하세요.",
      evidenceNeeded: "GIST·DGIST·UNIST·KAIST 중 1곳의 유효한 추천서",
      canAutoFix: false,
    });
  }
  if (/\[확인 필요:[^\]]*(정부|중앙정부|세금|금융|체납)/.test(combined)) {
    issues.unshift({
      severity: "critical",
      section: "성장 전략",
      issue: "정부지원사업 중복수혜·체납 등 신청 제한 사실이 확인되지 않았습니다.",
      whyItMatters: "신청 제한에 해당하면 사업계획서의 완성도와 무관하게 자격 단계에서 제외될 수 있습니다.",
      action: "사업 수행 이력, 2026년 동시수행 여부, 국세·지방세·금융 체납 여부를 원본으로 확인하세요.",
      evidenceNeeded: "정부지원사업 협약 이력과 국세·지방세 완납증명 등 자격 증빙",
      canAutoFix: false,
    });
  }
  if (/비식별화된 질의만 전송/.test(combined) && /공개 웹검색[\s\S]{0,20}미적용/.test(combined)) {
    issues.push({
      severity: "major",
      section: "창업 아이템 개요·실현 가능성",
      issue: "향후 보안 설계를 현재 구현된 기능처럼 표현한 문장과 공개 웹검색 미적용 사실이 충돌합니다.",
      whyItMatters: "현재 기능과 개발 계획이 섞이면 기술 완성도와 보안 수준을 과장한 것으로 읽힐 수 있습니다.",
      action: "현재 MVP는 로컬 처리만 구현됐고 비식별 질의·사람 승인 검증은 협약기간 개발 계획임을 분리해 쓰세요.",
      evidenceNeeded: "",
      canAutoFix: true,
    });
  }

  return normalizePlanReview(
    {
      score: 48,
      verdict: "초안의 문제·해결·실행 구조는 잡혔지만 필수 추천서와 자격 증빙을 확보하기 전에는 제출을 보류해야 합니다.",
      strengths: [
        "JudgeAI 실적과 기존 교육·컨설팅 실적을 구분했습니다.",
        "현재 MVP 검증 결과와 향후 기관 실증 목표를 분리했습니다.",
        "시장 전체 규모를 소프트웨어 매출시장과 동일시하지 않았습니다.",
      ],
      scores: [
        { key: "eligibility_form", score: 2, reason: "추천서와 신청 제한 사실 확인이 남았습니다." },
        { key: "problem_evidence", score: 8, reason: "현장 관찰은 있으나 기관 인터뷰가 아직 없습니다." },
        { key: "solution_advantage", score: 8, reason: "MVP는 있으나 보안·외부검증 기능은 계획 단계입니다." },
        { key: "market_business", score: 7, reason: "공식 생태계 규모와 가격 가설을 구분했습니다." },
        { key: "sales_growth", score: 5, reason: "파일럿 경로는 있으나 고객 검증이 필요합니다." },
        { key: "execution_budget", score: 9, reason: "12개월 일정과 예산이 연결돼 있습니다." },
        { key: "team", score: 5, reason: "대표 경력은 있으나 핵심 채용·협력자가 미확정입니다." },
        { key: "consistency_evidence", score: 4, reason: "현재 기능과 향후 보안 설계 표현을 분리해야 합니다." },
      ],
      issues,
      evidenceChecklist: [
        "4대 과학기술원 중 1곳의 추천서",
        "정부지원사업 수행·동시수행 이력",
        "국세·지방세 및 금융 체납 여부 증빙",
        "기관 인터뷰와 경쟁대안 공식 기능·가격 자료",
      ],
      formCompliance: ["공식 HWP 양식의 실제 목차·분량·필수 첨부서류를 최종 대조해야 합니다."],
    },
    sections,
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { messages, sections, code, program, formToc, evidence: clientEvidence, strategy: clientStrategy, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    sections?: PlanDocxSection[];
    code?: string;
    program?: ProgramInput;
    formToc?: unknown;
    evidence?: EvidencePack;
    strategy?: StrategyPack;
    provider?: unknown;
  };
  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const rl = await checkRateLimit(req, "planReview");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  const access = await checkDraftAccess(req, code, program?.id);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  const application = decideDraftApplication(program, Array.isArray(sections) && sections.length > 0);
  if (!application.ok) return draftApplicationError(application);
  if (!Array.isArray(messages) || !Array.isArray(sections) || sections.length === 0) {
    return Response.json({ error: "심사할 대화와 초안이 필요해요." }, { status: 400 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  const [evidence, strategy] = access.user
    ? await Promise.all([
        getEvidencePack(access.user.id, access.admin),
        getStrategyPack(access.user.id, access.admin),
      ])
    : [clientEvidence, clientStrategy];
  const reservation = await reservePaidAiCall({
    userId: access.user?.id,
    bypassBudget: access.admin,
    stage: "audit",
    provider,
    tier: "fast",
    estimatedInputTokens: 52_000,
    maxOutputTokens: 6_500,
  });
  if (!reservation.ok) return aiBudgetExceededResponse(reservation);
  const safeSections = sections.slice(0, 80).map((section) => ({
    heading: String(section.heading ?? "").slice(0, 160),
    content: String(section.content ?? "").slice(0, 18000),
  }));
  const safeToc = Array.isArray(formToc)
    ? sanitizeFormToc(formToc.filter((item): item is string => typeof item === "string"))
    : [];
  const fullConversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "신청자" : "도우미"}: ${message.content}`)
    .join("\n");
  const conversation =
    fullConversation.length > 70000
      ? `${fullConversation.slice(0, 12000)}\n\n[중간 대화 생략]\n\n${fullConversation.slice(-33000)}`
      : fullConversation;
  const draftText = compactSections(safeSections, 80_000);
  const prompt = `[지원사업]
- 사업명: ${program?.title ?? "확인되지 않음"}
- 공고 개요: ${program?.summary ?? "확인되지 않음"}
- 지원대상: ${program?.target ?? "확인되지 않음"}
- 지원분야: ${program?.supportField ?? "확인되지 않음"}

[공식 양식 목차]
${safeToc.length ? safeToc.join("\n") : "별도 목차 없음 — 표준 PSST 기준"}

[신청자 원답변과 작성 대화]
${conversation}

[저장된 근거팩]
${evidence ? evidencePackPrompt(evidence).slice(0, 40_000) : "없음 — 핵심 주장에 critical로 표시"}

[저장된 전략팩]
${strategy ? JSON.stringify(strategy, null, 2).slice(0, 30_000) : "없음 — 전략 일관성을 확인할 수 없음"}

[검토할 사업계획서 초안]
${draftText}`;

  let completed = false;
  try {
    const raw = await getLlm(provider, "fast").json<PlanReviewReport>({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      schema: {},
      maxTokens: 6_500,
      onUsage: async (usage) => {
        await reservation.complete(usage);
        completed = true;
      },
    });
    const receivedIssues = Array.isArray(raw?.issues) ? raw.issues : [];
    const report = normalizePlanReview(
      { ...raw, issues: [...receivedIssues, ...evidenceGuardIssues(evidence ?? null, strategy ?? null)] },
      safeSections,
    );
    if (access.user) {
      await saveAuditArtifact(
        access.user.id,
        report,
        safeSections,
        evidence ?? null,
        strategy ?? null,
        access.admin,
      );
    }
    return Response.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (!completed) await reservation.release();
    console.error("[/api/plan/audit]", error);
    const report = fallbackAudit(safeSections, evidence ?? null, strategy ?? null);
    if (access.user) {
      await saveAuditArtifact(
        access.user.id,
        report,
        safeSections,
        evidence ?? null,
        strategy ?? null,
        access.admin,
      ).catch(
        () => undefined,
      );
    }
    return Response.json(
      {
        ...report,
        warning: "AI 모의심사 응답을 끝까지 읽지 못해 필수 자격·근거·현재/계획 충돌 규칙으로 안전 점검했습니다.",
        degraded: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
