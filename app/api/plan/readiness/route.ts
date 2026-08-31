import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import {
  normalizeReadinessAssessment,
  READINESS_DIMENSIONS,
  type PlanReadinessAssessment,
} from "@/lib/plan/reviewer";
import { sanitizeFormToc } from "@/lib/plan/sections";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `당신은 정부지원사업 서면평가 전에 신청자의 답변을 검토하는 수석 심사역입니다.
문장을 대신 예쁘게 쓰는 것이 아니라, 심사위원이 점수를 줄 수 있는 구체적인 사실과 근거가 모였는지 독립적으로 판정하세요.

[판정 원칙]
- 공고·공식 양식의 평가항목과 배점이 있으면 그것을 최우선으로 적용합니다. 없으면 일반적인 PSST 관점임을 밝힙니다.
- 출처가 적힌 통계·첨부자료·계약/매출/고객 원본처럼 확인 경로가 있는 내용은 evidenceLevel="verified"입니다.
- 사용자가 구체적으로 말했지만 자료가 제시되지 않은 내용은 evidenceLevel="stated"입니다.
- 추상적 표현, "알아서", 일반론, 근거 없는 예상은 evidenceLevel="missing"입니다.
- 사용자·실사용자·결제자, 현재 성과·향후 목표, 사실·추정·계획을 반드시 구분합니다.
- 사업의 핵심 문제, 해결 방식, 돈을 내는 고객, 판매 검증 또는 구체적 검증계획, 1년 실행계획, 팀 근거 중 하나라도 없으면 ready=false입니다.
- 문서가 길다는 이유로 높은 점수를 주지 마세요. 냉정하되, 다음에 답할 질문은 쉬운 한국어 한 문장으로 씁니다.
- 합격을 보장하거나 합격확률을 추정하지 마세요. score는 오직 초안 작성 준비도입니다.

[출력]
설명 없이 아래 구조의 JSON 하나만 출력하세요.
{
  "ready": false,
  "score": 0,
  "verdict": "현재 준비도에 대한 한 문장",
  "dimensions": [
    {"key":"problem","status":"strong|partial|missing","evidenceLevel":"verified|stated|missing","finding":"확인된 내용 또는 약점","nextQuestion":"부족할 때 다음 질문"}
  ],
  "criticalGaps": ["초안 전에 반드시 채울 빈칸"],
  "nextQuestions": ["사용자에게 이어서 물을 질문 — 중요한 순서"],
  "evaluationAlignment": ["공고 평가항목 또는 양식 항목 → 현재 확보한 답변"]
}

dimensions에는 다음 key를 각각 정확히 한 번씩 모두 넣으세요:
${READINESS_DIMENSIONS.map((item) => `- ${item.key}: ${item.label}`).join("\n")}`;

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

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, code, program, formToc, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: ProgramInput;
    formToc?: unknown;
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
  const application = decideDraftApplication(program);
  if (!application.ok) return draftApplicationError(application);
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "검토할 대화가 없어요." }, { status: 400 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  const safeToc = Array.isArray(formToc)
    ? sanitizeFormToc(formToc.filter((item): item is string => typeof item === "string"))
    : [];
  const fullConversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "신청자" : "도우미"}: ${message.content}`)
    .join("\n");
  const conversation =
    fullConversation.length > 70000
      ? `${fullConversation.slice(0, 20000)}\n\n[중간 대화 생략]\n\n${fullConversation.slice(-50000)}`
      : fullConversation;
  const prompt = `[지원사업]
- 사업명: ${program?.title ?? "확인되지 않음"}
- 공고 개요: ${program?.summary ?? "확인되지 않음"}
- 지원대상: ${program?.target ?? "확인되지 않음"}
- 지원분야: ${program?.supportField ?? "확인되지 않음"}

[공식 양식 목차]
${safeToc.length ? safeToc.join("\n") : "별도 목차 없음 — 표준 PSST 기준으로 평가"}

[결제 후 작성 대화]
${conversation}`;

  try {
    const raw = await getLlm(provider, "quality").json<PlanReadinessAssessment>({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      schema: {},
      maxTokens: 3200,
    });
    return Response.json(normalizeReadinessAssessment(raw), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[/api/plan/readiness]", error);
    return Response.json({ error: "작성 준비도를 점검하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
