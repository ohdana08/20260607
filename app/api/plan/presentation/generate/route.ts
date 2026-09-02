import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { aiBudgetExceededResponse, reservePresentationAiCall } from "@/lib/plan/aiBudget";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import {
  getAuditArtifact,
  getEvidencePack,
  getPresentationArtifact,
  getStrategyPack,
  planArtifactDigest,
  planSectionsDigest,
  savePresentationArtifact,
} from "@/lib/plan/artifacts";
import type { PlanDocxSection } from "@/lib/plan/docx";
import {
  checkPresentationAccess,
  markPresentationCreditUsed,
  markPresentationServiceConsent,
  presentationPaymentRequiredResponse,
} from "@/lib/plan/presentationAccess";
import {
  getPresentationRevisionStatus,
  presentationRevisionUnavailableResponse,
  reservePresentationRevision,
} from "@/lib/plan/presentationRevisions";
import {
  mergePresentationClaims,
  normalizePresentationClaims,
  normalizePresentationPack,
  presentationContextPrompt,
  reviewPresentationPack,
  type PresentationClaim,
  type PresentationProgress,
  type PresentationStageId,
} from "@/lib/plan/presentation";
import type { EvidencePack, StrategyPack } from "@/lib/plan/strategy";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? undefined;
  const programId = url.searchParams.get("programId") ?? undefined;
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const access = await checkPresentationAccess(req, code, programId);
  if (!access.ok) return presentationPaymentRequiredResponse(access.reason);
  if (!access.user) return Response.json({ pack: null, review: null });
  const [artifact, revision] = await Promise.all([
    getPresentationArtifact(access.user.id),
    getPresentationRevisionStatus(access.user.id),
  ]);
  return Response.json(
    {
      pack: artifact?.pack ?? null,
      review: artifact?.review ?? null,
      revision,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const SYSTEM = `당신은 정부지원사업 발표평가용 슬라이드 원고를 만드는 편집자입니다.
검증을 통과한 사업계획서와 발표 인터뷰의 신청자 언어를 보존하면서, 심사위원이 짧은 시간에 문제→해결→검증→성장→팀을 이해하도록 구성하세요.

[핵심 원칙]
- 화면에 보이는 문장은 짧고 강하게, 세부 경험·수치·사례는 speakerNotes에 충분히 보존하세요.
- 신청자의 고유 아이디어·경험·표현·데이터를 임의로 일반화하거나 버리지 마세요.
- 모든 주장에는 제공된 claim id만 연결하세요. claim ledger에 없는 사실·숫자·기관·고객·계약·MVP·팀 경력을 새로 만들지 마세요.
- verified 외부 주장은 연결된 evidence id 범위에서만 쓰세요.
- stated 주장은 확인된 사실처럼 강화하지 말고, hypothesis는 가정·산식, plan은 시점·담당·산출물·지표가 드러나게 쓰세요.
- 가상의 고객 인터뷰·유료 고객·개발 완료·파트너십·대표·팀 프로필을 만들지 마세요.
- 사업계획서의 각 원본 section heading을 최소 한 슬라이드의 sourceSectionHeadings에 연결하세요. 본문에 직접 쓰지 못한 세부 내용은 대본과 데이터 부록에서 보존됩니다.
- 10~16장, 슬라이드당 bullet 최대 5개. 각 bullet은 한 문장 이하로 쓰세요.
- 내부 작업 용어(주장 장부, evidenceIds, 상태 분류)는 visible title/headline/bullets에 노출하지 마세요.
- 외부 출처는 visible slide가 아니라 시스템이 만드는 sourceNotes와 발표자 대본의 자연스러운 출처 언급으로 남깁니다.

[권장 흐름]
1. 표지·한 줄 정의
2. 대표가 이 문제를 붙잡은 이유
3. 고객이 겪는 구체적 문제 장면
4. 시장·수요 근거
5. 해결책과 사용 흐름
6. 현재 준비·검증 수준
7. 경쟁대안과 확인된 차이
8. 수익모델
9. 고객 확보·사업화
10. 일정·KPI·사업비
11. 대표·팀·파트너
12. 비전과 요청
필요하면 근거가 많은 항목을 나누되 16장을 넘지 마세요.

설명 없이 아래 JSON 하나만 출력하세요.
{
  "title":"발표자료 제목",
  "subtitle":"부제",
  "audience":"발표 대상",
  "durationMinutes":7,
  "narrative":"전체 발표의 한 줄 서사",
  "qa":[{
    "question":"심사위원 예상 질문",
    "answer":"대표자가 실제로 답할 근거 기반 답변",
    "claimIds":["제공된 claim id"],
    "risk":"이 질문에서 과장하거나 확인해야 할 점"
  }],
  "slides":[{
    "id":"slide-1",
    "stageId":"cover|founder|problem|market|solution|validation|competition|business_model|go_to_market|roadmap_budget|team_partners|vision|qna",
    "title":"슬라이드 제목",
    "headline":"심사위원이 기억할 핵심 문장",
    "bullets":["화면에 보일 짧은 문장"],
    "visualBrief":"필요한 표·사진·도식 또는 텍스트 중심",
    "speakerNotes":"신청자가 실제로 말할 구체 대본. 근거·가정·향후 계획을 혼동하지 않음",
    "claimIds":["제공된 claim id"],
    "sourceSectionHeadings":["사업계획서의 정확한 원본 목차명"]
  }]
}`;

function stageForClaim(text: string): PresentationStageId {
  if (/시장|TAM|SAM|SOM|수요|통계/.test(text)) return "market";
  if (/경쟁|차별|대체재/.test(text)) return "competition";
  if (/가격|매출|수익|마진|구독|결제/.test(text)) return "business_model";
  if (/고객 확보|마케팅|영업|채널|판매/.test(text)) return "go_to_market";
  if (/일정|예산|사업비|로드맵|KPI|목표/.test(text)) return "roadmap_budget";
  if (/대표|팀|경력|역량|파트너|협력/.test(text)) return "team_partners";
  if (/MVP|프로토타입|검증|고객 반응|계약/.test(text)) return "validation";
  if (/해결|기능|기술|서비스|제품/.test(text)) return "solution";
  if (/비전|ESG|중장기/.test(text)) return "vision";
  return "problem";
}

function strategyClaims(strategy: StrategyPack, evidence: EvidencePack): PresentationClaim[] {
  return normalizePresentationClaims(
    strategy.claims.map((claim, index) => ({
      id: `strategy-${index + 1}`,
      text: claim.claim,
      stageId: stageForClaim(claim.claim),
      origin: claim.evidenceIds.length > 0 ? "external" : "plan",
      status: claim.status === "plan" ? "plan" : claim.status,
      evidenceIds: claim.evidenceIds,
      requiresEvidence: claim.status === "missing" || claim.status === "stated",
      assumption: "",
      verificationPlan: claim.status === "plan" ? "사업계획서의 일정·담당·산출물·지표에 따라 실행 후 확인" : "",
    })),
    evidence,
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const {
    interviewMessages,
    sourceConversation,
    sections,
    claimLedger,
    progress,
    code,
    program,
    evidence: clientEvidence,
    strategy: clientStrategy,
    reviewStatus,
    revisionRequest,
    serviceConsent,
    provider: rawProvider,
  } = (body ?? {}) as {
    interviewMessages?: ChatMsg[];
    sourceConversation?: ChatMsg[];
    sections?: PlanDocxSection[];
    claimLedger?: PresentationClaim[];
    progress?: PresentationProgress | null;
    code?: string;
    program?: ProgramInput;
    evidence?: EvidencePack;
    strategy?: StrategyPack;
    reviewStatus?: string;
    revisionRequest?: string;
    serviceConsent?: boolean;
    provider?: unknown;
  };

  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const rl = await checkRateLimit(req, "planPresentationGenerate");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  const access = await checkPresentationAccess(req, code, program?.id);
  if (!access.ok) return presentationPaymentRequiredResponse(access.reason);
  if (access.user && !access.paid?.consentedAt) {
    if (serviceConsent !== true) {
      return Response.json(
        { error: "발표자료 유료 맞춤 작성 범위와 환불정책을 확인해 주세요." },
        { status: 409 },
      );
    }
    if (!(await markPresentationServiceConsent(access.user.id))) {
      return Response.json({ error: "발표자료 시작 동의를 저장하지 못했어요." }, { status: 503 });
    }
  }
  const application = decideDraftApplication(program);
  if (!application.ok) return draftApplicationError(application);
  if (!Array.isArray(sections) || sections.length === 0) {
    return Response.json({ error: "최종 사업계획서가 필요해요." }, { status: 409 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  const safeSections = sections.slice(0, 80).map((section) => ({
    heading: String(section.heading ?? "").slice(0, 180),
    content: String(section.content ?? "").slice(0, 18000),
  }));
  const [audit, evidence, strategy] = access.user
    ? await Promise.all([
        getAuditArtifact(access.user.id),
        getEvidencePack(access.user.id),
        getStrategyPack(access.user.id),
      ])
    : [null, clientEvidence ?? null, clientStrategy ?? null];
  if (!evidence || !strategy) {
    return Response.json({ error: "근거팩과 전략팩을 먼저 완성해 주세요." }, { status: 409 });
  }
  const previous = access.user ? await getPresentationArtifact(access.user.id) : null;
  const isRevision = Boolean(cleanRevisionRequest(revisionRequest) && previous?.review.exportReady);
  if (!progress?.ready && !isRevision) {
    return Response.json({ error: "발표 인터뷰의 필수 질문을 먼저 완료해 주세요." }, { status: 409 });
  }
  if (access.user) {
    const validAudit =
      audit?.report.submissionReady === true &&
      audit.sectionsDigest === planSectionsDigest(safeSections) &&
      audit.evidenceDigest === planArtifactDigest(evidence) &&
      audit.strategyDigest === planArtifactDigest(strategy);
    if (!validAudit) {
      return Response.json(
        { error: "최신 사업계획서의 근거 심사를 다시 통과해 주세요." },
        { status: 409 },
      );
    }
  } else if (reviewStatus !== "ready") {
    return Response.json({ error: "사업계획서 최종 심사를 먼저 완료해 주세요." }, { status: 409 });
  }

  const claims = mergePresentationClaims(
    normalizePresentationClaims(
      claimLedger?.length ? claimLedger : previous?.pack.claimLedger ?? [],
      evidence,
    ),
    strategyClaims(strategy, evidence),
  );
  if (claims.length === 0) {
    return Response.json({ error: "슬라이드에 연결할 실제 주장과 데이터가 아직 없어요." }, { status: 409 });
  }

  const revision = await reservePresentationRevision(access.user?.id);
  if (!revision.ok) return presentationRevisionUnavailableResponse(revision.status);
  const reservation = await reservePresentationAiCall({
    userId: access.user?.id,
    stage: "presentation_generate",
    provider,
    tier: "balanced",
    estimatedInputTokens: 70_000,
    maxOutputTokens: 7000,
  });
  if (!reservation.ok) {
    await revision.rollback();
    return aiBudgetExceededResponse(reservation);
  }
  const context = presentationContextPrompt({
    program: program ?? {},
    sections: safeSections,
    evidence,
    strategy,
    sourceConversation: (sourceConversation ?? []).slice(-80),
  });
  const interview = (interviewMessages ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "신청자" : "코치"}: ${message.content}`)
    .join("\n")
    .slice(-35_000);
  const revisionContext = cleanRevisionRequest(revisionRequest)
    ? `[묶음 수정 요청]\n${cleanRevisionRequest(revisionRequest)}\n\n[이전 발표자료]\n${JSON.stringify(previous?.pack ?? null).slice(0, 35_000)}`
    : "";

  let completed = false;
  try {
    const raw = await getLlm(provider, "balanced").json<unknown>({
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `${context}\n\n[발표 인터뷰]\n${interview}\n\n[확정 주장 장부]\n${JSON.stringify(claims, null, 2).slice(0, 45_000)}\n\n${revisionContext}`,
      }],
      schema: {},
      maxTokens: 7000,
      onUsage: async (usage) => {
        await reservation.complete(usage);
        completed = true;
      },
    });
    const pack = normalizePresentationPack(raw, {
      evidence,
      strategy,
      sections: safeSections,
      claims,
      fallbackTitle: `${program?.title ?? "정부지원사업"} 발표자료`,
    });
    const review = reviewPresentationPack(pack);
    if (access.user) {
      await savePresentationArtifact(access.user.id, pack, review, safeSections, evidence, strategy);
      if (program?.id) await markPresentationCreditUsed(access.user.id, program.id);
    }
    return Response.json(
      {
        pack,
        review,
        revision: access.user ? await getPresentationRevisionStatus(access.user.id) : revision.status,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (!completed) await reservation.release();
    await revision.rollback();
    console.error("[/api/plan/presentation/generate]", error);
    return Response.json({ error: "발표자료 원고를 만들지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}

function cleanRevisionRequest(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 3000) : "";
}
