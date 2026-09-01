import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { aiBudgetExceededResponse, reservePaidAiCall } from "@/lib/plan/aiBudget";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import { getEvidencePack, getStrategyPack } from "@/lib/plan/artifacts";
import { checkDraftAccess, markCreditUsed, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import type { PlanDocxSection } from "@/lib/plan/docx";
import {
  MISSING_INFO_PLACEHOLDER,
  PROOF_NEEDED_PLACEHOLDER,
  ensureFormTableNotice,
  reviewChecklistForHeading,
  sanitizeFormToc,
} from "@/lib/plan/sections";
import { evidencePackPrompt, type EvidencePack, type StrategyPack } from "@/lib/plan/strategy";
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

interface RequestedSection {
  heading?: string;
  guide?: string;
}

interface BatchResult {
  sections?: Array<{ heading?: unknown; content?: unknown }>;
}

const SYSTEM = `당신은 정부지원사업 평가기준에 맞춰 검증된 사실과 신청자의 계획을 공식 양식에 쓰는 수석 컨설턴트입니다.

[절대 규칙]
- 제공된 목차명과 순서를 그대로 유지하고, 각 목차의 본문만 작성하세요.
- 사용자 원답변, 저장된 근거팩, 전략팩에 없는 숫자·기관명·고객·계약·매출·성과를 만들지 마세요.
- verified/stated 사실과 앞으로의 plan을 문장에서 명확히 구분하세요.
- 자료가 없으면 다음 표시 중 맞는 것을 남기고, 가짜 구체성으로 채우지 마세요.
${MISSING_INFO_PLACEHOLDER}
${PROOF_NEEDED_PLACEHOLDER}
- 시장 수치와 경쟁사 사실에는 출처 발행기관·확인일·URL을 짧게 표기하세요.
- 고객·가격·수익·일정·예산·경쟁비교처럼 병렬 비교가 필요한 부분은 "항목명: 내용" 줄을 2개 이상 연속 작성하세요. Word에서 표로 바뀝니다.
- 정부지원금은 허용 비목, 수량×단가, 실행시기, 산출물과 연결하고 근거가 없으면 보완 표시를 남기세요.
- 마크다운 제목·별표·코드펜스를 쓰지 말고, 공적인 평서체(~함/~임/~다)를 사용하세요.
- 답변은 설명 없이 {"sections":[{"heading":"정확한 목차명","content":"본문"}]} JSON 하나만 출력하세요.`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const {
    messages,
    code,
    program,
    sections,
    formToc,
    evidence: clientEvidence,
    strategy: clientStrategy,
    provider: rawProvider,
  } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: ProgramInput;
    sections?: RequestedSection[];
    formToc?: unknown;
    evidence?: EvidencePack;
    strategy?: StrategyPack;
    provider?: unknown;
  };

  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const rl = await checkRateLimit(req, "planDraft");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  const access = await checkDraftAccess(req, code, program?.id);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  const application = decideDraftApplication(program);
  if (!application.ok) return draftApplicationError(application);
  if (!Array.isArray(messages) || !Array.isArray(sections) || sections.length === 0 || sections.length > 30) {
    return Response.json({ error: "작성할 목차 묶음이 올바르지 않아요." }, { status: 400 });
  }
  const safeSections = sections
    .map((section) => ({
      heading: String(section.heading ?? "").trim().slice(0, 160),
      guide: String(section.guide ?? "").trim().slice(0, 1200),
    }))
    .filter((section) => section.heading);
  if (safeSections.length === 0) {
    return Response.json({ error: "작성할 목차명이 필요해요." }, { status: 400 });
  }
  if (access.user && program?.id) await markCreditUsed(access.user.id, program.id);
  const [storedEvidence, storedStrategy] = access.user
    ? await Promise.all([getEvidencePack(access.user.id), getStrategyPack(access.user.id)])
    : [clientEvidence, clientStrategy];
  if (!storedEvidence || !storedStrategy) {
    return Response.json({ error: "근거 확인과 전략 설계를 먼저 완료해 주세요." }, { status: 409 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "선택한 AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  const reservation = await reservePaidAiCall({
    userId: access.user?.id,
    stage: "draft_batch",
    provider,
    tier: "balanced",
    estimatedInputTokens: 34_000,
    maxOutputTokens: 5_500,
  });
  if (!reservation.ok) return aiBudgetExceededResponse(reservation);

  const safeToc = Array.isArray(formToc)
    ? sanitizeFormToc(formToc.filter((item): item is string => typeof item === "string"))
    : [];
  const conversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-48)
    .map((message) => `${message.role === "user" ? "신청자" : "도우미"}: ${message.content}`)
    .join("\n")
    .slice(-45_000);
  const sectionPrompt = safeSections
    .map((section, index) => {
      const checks = reviewChecklistForHeading(section.heading).map((item) => `  - ${item}`).join("\n");
      return `${index + 1}. ${section.heading}\n안내: ${section.guide || "공식 항목 취지에 맞게 작성"}\n체크:\n${checks}`;
    })
    .join("\n\n");
  const prompt = `[지원사업]
- 사업명: ${program?.title || "확인되지 않음"}
- 공고 요약: ${program?.summary || "확인되지 않음"}
- 지원대상: ${program?.target || "확인되지 않음"}
- 지원분야: ${program?.supportField || "확인되지 않음"}

[전체 공식 목차]
${safeToc.length ? safeToc.join("\n") : "표준 PSST 목차"}

[이번 호출에서 작성할 목차]
${sectionPrompt}

[저장된 근거팩]
${evidencePackPrompt(storedEvidence).slice(0, 40_000)}

[저장된 전략팩]
${JSON.stringify(storedStrategy, null, 2).slice(0, 35_000)}

[신청자 원답변]
${conversation}`;

  let completed = false;
  try {
    const raw = await getLlm(provider, "balanced").json<BatchResult>({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      schema: {},
      maxTokens: 5_500,
      onUsage: async (usage) => {
        await reservation.complete(usage);
        completed = true;
      },
    });
    const received = Array.isArray(raw.sections) ? raw.sections : [];
    const output: PlanDocxSection[] = safeSections.map((requested, index) => {
      const exact = received.find((item) => String(item.heading ?? "").trim() === requested.heading);
      const fallback = received[index];
      const content = String(exact?.content ?? fallback?.content ?? "").trim().slice(0, 18_000);
      return {
        heading: requested.heading,
        content: ensureFormTableNotice(requested.heading, content || MISSING_INFO_PLACEHOLDER),
      };
    });
    return Response.json({ sections: output }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!completed) await reservation.release();
    console.error("[/api/plan/draft-batch]", error);
    return Response.json({ error: "사업계획서 목차 묶음을 작성하지 못했어요." }, { status: 500 });
  }
}
