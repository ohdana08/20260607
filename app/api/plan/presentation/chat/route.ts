import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { aiBudgetExceededResponse, reservePresentationAiCall } from "@/lib/plan/aiBudget";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import {
  getAuditArtifact,
  getEvidencePack,
  getStrategyPack,
  planArtifactDigest,
  planSectionsDigest,
} from "@/lib/plan/artifacts";
import type { PlanDocxSection } from "@/lib/plan/docx";
import {
  checkPresentationAccess,
  markPresentationCreditUsed,
  markPresentationServiceConsent,
  presentationPaymentRequiredResponse,
} from "@/lib/plan/presentationAccess";
import {
  PRESENTATION_STAGE_DEFS,
  normalizePresentationInterviewReply,
  presentationContextPrompt,
  type PresentationClaim,
  type PresentationProgress,
} from "@/lib/plan/presentation";
import type { EvidencePack, StrategyPack } from "@/lib/plan/strategy";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

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

const SYSTEM_RULES = `당신은 정부지원사업 발표평가 자료를 신청자와 티키타카로 만드는 수석 코치입니다.

[대화 목표]
- 이미 완성된 사업계획서, 신청자 원답변, 근거팩, 전략팩을 먼저 읽고 이미 아는 것을 다시 묻지 마세요.
- 신청자의 고유한 경험·표현·아이디어·숫자·사례를 충분히 끌어내되 한 번에 질문은 정확히 하나만 하세요.
- 짧게 공감하고, 지금 답변에서 새로 확보한 내용을 한두 문장으로 짚고, 다음 질문 하나로 끝내세요.
- 답이 추상적이면 실제 장면·횟수·기간·금액·누가 말했는지 중 가장 필요한 하나만 다시 물으세요.
- 자료가 있다면 사진·PDF·Word·한글·텍스트 첨부를 자연스럽게 요청하세요.
- 신청자가 "알아서 해줘"라고 해도 실적·경력·고객·계약·MVP를 만들지 말고 본인만 아는 사실을 물으세요.
- 단계 번호를 기계적으로 고집하지 말고, 기존 자료로 충분한 단계는 완료 처리한 뒤 부족한 부분만 물으세요.

[주장 분류 — 반드시 지킬 것]
- verified: 근거팩의 verified 출처 id가 연결된 확인 사실만. evidenceIds가 없으면 verified 금지.
- stated: 신청자가 말했거나 계획서에 있지만 별도 확인 자료가 연결되지 않은 내용.
- hypothesis: 시장·고객·매출 등에 관한 가설·추정. assumption과 verificationPlan을 반드시 함께 기록.
- plan: 앞으로 할 일. 현재 완료 실적처럼 쓰지 말고 verificationPlan에 시점·담당·산출물·지표를 기록.
- missing: 외부 사실·현재 실적을 주장하지만 확인 자료가 없는 상태.
- 가상의 고객 50명 인터뷰, 개발 완료, 유료 이용, 계약, 팀 학력·경력을 절대 만들지 마세요.
- 외부 통계·경쟁사 사실은 근거팩에 있는 verified evidenceIds가 있을 때만 사용하세요.

[진행 단계]
${PRESENTATION_STAGE_DEFS.map((item, index) => `${index + 1}. ${item.id}: ${item.label}`).join("\n")}

[완료 원칙]
- 표지, 창업 배경, 고객 문제, 시장, 해결책, 준비·검증, 경쟁, 수익모델, 사업화, 일정·사업비, 팀·파트너, 비전이 모두 실제 답변으로 덮여야 ready=true입니다.
- 발표 시간·대상도 확인해야 합니다. 사용자가 모르면 7분 발표·정부지원사업 심사위원을 기본 가설로 제안하고 확인받으세요.
- qna 단계에서는 가장 약한 주장과 예상 질문에 답할 대표자 언어를 확보하세요.
- 중요한 현재 실적이 stated 또는 missing이면 criticalMissing에 넣고 ready=false로 두세요.
- 가설·향후 계획은 명확히 표시되고 가정·검증법 또는 실행법이 있으면 존재 자체로 막지 않습니다.

설명 없이 아래 JSON 하나만 출력하세요.
{
  "reply":"사용자에게 보여줄 짧은 답변. 마지막은 질문 하나",
  "progress":{
    "stageId":"setup|cover|founder|problem|market|solution|validation|competition|business_model|go_to_market|roadmap_budget|team_partners|vision|qna",
    "completedStageIds":["이미 충분히 확보된 단계 id"],
    "ready":false,
    "criticalMissing":["최종 발표자료를 막는 실제 부족 자료"],
    "coveredSummary":"지금까지 확보된 고유 아이디어와 데이터 요약"
  },
  "claims":[{
    "id":"짧고 안정적인 id",
    "text":"이번 응답까지 확보한 구체 주장",
    "stageId":"관련 단계 id",
    "origin":"plan|user|upload|external",
    "status":"verified|stated|hypothesis|plan|missing",
    "evidenceIds":["근거팩의 실제 verified id만"],
    "requiresEvidence":false,
    "assumption":"가설일 때 가정, 아니면 빈 문자열",
    "verificationPlan":"가설 검증법·향후 계획 실행법·필요 증빙, 해당 없으면 빈 문자열"
  }]
}`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const {
    messages,
    sourceConversation,
    sections,
    claimLedger,
    progress,
    code,
    program,
    evidence: clientEvidence,
    strategy: clientStrategy,
    reviewStatus,
    serviceConsent,
    provider: rawProvider,
  } = (body ?? {}) as {
    messages?: ChatMsg[];
    sourceConversation?: ChatMsg[];
    sections?: PlanDocxSection[];
    claimLedger?: PresentationClaim[];
    progress?: PresentationProgress | null;
    code?: string;
    program?: ProgramInput;
    evidence?: EvidencePack;
    strategy?: StrategyPack;
    reviewStatus?: string;
    serviceConsent?: boolean;
    provider?: unknown;
  };

  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const rl = await checkRateLimit(req, "planPresentationChat");
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
  if (!Array.isArray(messages) || !Array.isArray(sections) || sections.length === 0) {
    return Response.json({ error: "발표 인터뷰와 최종 사업계획서가 필요해요." }, { status: 400 });
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
  if (access.user) {
    const validAudit =
      audit?.report.submissionReady === true &&
      audit.sectionsDigest === planSectionsDigest(safeSections) &&
      audit.evidenceDigest === planArtifactDigest(evidence) &&
      audit.strategyDigest === planArtifactDigest(strategy);
    if (!validAudit) {
      return Response.json(
        { error: "최신 사업계획서의 근거 심사를 통과한 뒤 발표자료를 준비할 수 있어요." },
        { status: 409 },
      );
    }
  } else if (reviewStatus !== "ready") {
    return Response.json({ error: "사업계획서 최종 심사를 먼저 완료해 주세요." }, { status: 409 });
  }

  const reservation = await reservePresentationAiCall({
    userId: access.user?.id,
    stage: "presentation_chat",
    provider,
    tier: "fast",
    estimatedInputTokens: 55_000,
    maxOutputTokens: 2600,
  });
  if (!reservation.ok) return aiBudgetExceededResponse(reservation);

  const context = presentationContextPrompt({
    program: program ?? {},
    sections: safeSections,
    evidence,
    strategy,
    sourceConversation: (sourceConversation ?? []).slice(-80),
  });
  const currentState = `[현재 발표 인터뷰 상태]
${JSON.stringify({ progress: progress ?? null, claimLedger: (claimLedger ?? []).slice(0, 100) }, null, 2).slice(0, 30_000)}`;
  let completed = false;
  try {
    const raw = await getLlm(provider, "fast").json<unknown>({
      system: `${SYSTEM_RULES}\n\n${context}\n\n${currentState}`,
      messages: messages.slice(-36),
      schema: {},
      maxTokens: 2600,
      onUsage: async (usage) => {
        await reservation.complete(usage);
        completed = true;
      },
    });
    const reply = normalizePresentationInterviewReply(raw, evidence);
    if (access.user && program?.id) await markPresentationCreditUsed(access.user.id, program.id);
    return Response.json(reply, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (!completed) await reservation.release();
    console.error("[/api/plan/presentation/chat]", error);
    return Response.json({ error: "발표 질문을 만들지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
