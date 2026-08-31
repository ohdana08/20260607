import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import {
  normalizePlanReview,
  REVIEW_SCORE_DIMENSIONS,
  type PlanReviewReport,
} from "@/lib/plan/reviewer";
import type { PlanDocxSection } from "@/lib/plan/docx";
import { sanitizeFormToc } from "@/lib/plan/sections";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

[위험 등급]
- critical: 자격 미확인/미충족, 필수항목 누락, 사용자 답에 없는 사실·수치, 핵심 사업논리 단절처럼 제출을 보류해야 하는 문제
- major: 배점이 큰 항목의 근거 부족, 고객·가격·판매·일정·예산의 구체성 부족
- minor: 표현, 중복, 가독성처럼 보완하면 좋은 문제

합격을 보장하거나 합격확률을 말하지 마세요. score는 현재 초안의 제출 준비도일 뿐입니다.
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

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { messages, sections, code, program, formToc, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    sections?: PlanDocxSection[];
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
  if (!Array.isArray(messages) || !Array.isArray(sections) || sections.length === 0) {
    return Response.json({ error: "심사할 대화와 초안이 필요해요." }, { status: 400 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  const safeSections = sections.slice(0, 80).map((section) => ({
    heading: String(section.heading ?? "").slice(0, 160),
    content: String(section.content ?? "").slice(0, 16000),
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
      ? `${fullConversation.slice(0, 20000)}\n\n[중간 대화 생략]\n\n${fullConversation.slice(-50000)}`
      : fullConversation;
  const draftText = safeSections.map((section) => `## ${section.heading}\n${section.content}`).join("\n\n");
  const prompt = `[지원사업]
- 사업명: ${program?.title ?? "확인되지 않음"}
- 공고 개요: ${program?.summary ?? "확인되지 않음"}
- 지원대상: ${program?.target ?? "확인되지 않음"}
- 지원분야: ${program?.supportField ?? "확인되지 않음"}

[공식 양식 목차]
${safeToc.length ? safeToc.join("\n") : "별도 목차 없음 — 표준 PSST 기준"}

[신청자 원답변과 작성 대화]
${conversation}

[검토할 사업계획서 초안]
${draftText}`;

  try {
    const raw = await getLlm(provider, "quality").json<PlanReviewReport>({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      schema: {},
      maxTokens: 4800,
    });
    return Response.json(normalizePlanReview(raw, safeSections), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[/api/plan/audit]", error);
    return Response.json({ error: "초안을 심사하지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
