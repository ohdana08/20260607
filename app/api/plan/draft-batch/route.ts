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
import { parseRevisionOutput } from "@/lib/plan/revisionText";
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

const SYSTEM = `당신은 정부지원사업 평가기준에 맞춰 검증된 사실과 신청자의 계획을 공식 양식에 쓰는 수석 컨설턴트입니다.

[절대 규칙]
- 제공된 목차명과 순서를 그대로 유지하고, 각 목차의 본문만 작성하세요.
- 사용자 원답변, 저장된 근거팩, 전략팩에 없는 숫자·기관명·고객·계약·매출·성과를 만들지 마세요.
- verified/stated 사실과 앞으로의 plan을 문장에서 명확히 구분하세요.
- 자료가 없어도 확인된 사용자 설명으로 읽을 수 있는 초안을 먼저 작성하세요. 가짜 구체성은 만들지 말고 부족한 곳에 다음 보충 안내를 구체적으로 붙이세요.
${MISSING_INFO_PLACEHOLDER}
${PROOF_NEEDED_PLACEHOLDER}
- 증거가 없다는 이유로 문단 전체를 비우지 마세요. 사용자 설명과 향후 계획을 명확히 구분해 본문을 쓴 뒤, 고객 대화·매출 화면·계약서·시험자료·공식 통계 등 해당 주장에 맞는 보충 방법을 한 번만 안내하세요.
- 시장 수치와 경쟁사 사실에는 출처 발행기관·확인일·URL을 짧게 표기하세요.
- 고객·가격·수익·일정·예산·경쟁비교처럼 병렬 비교가 필요한 부분은 "항목명: 내용" 줄을 2개 이상 연속 작성하세요. Word에서 표로 바뀝니다.
- 정부지원금은 허용 비목, 수량×단가, 실행시기, 산출물과 연결하고 근거가 없으면 보완 표시를 남기세요.
- 각 목차 본문은 900~1,500자 내외로 작성하고, 1,800자를 넘기지 마세요.
- 마크다운 제목·별표·코드펜스를 쓰지 말고, 공적인 평서체(~함/~임/~다)를 사용하세요.
- 답변은 설명 없이 {"sections":[{"heading":"정확한 목차명","content":"본문"}]} JSON 하나만 출력하세요.`;

function fallbackSectionContent(
  heading: string,
  conversation: string,
  evidence: EvidencePack,
): string {
  const userContext = conversation
    .split("\n")
    .filter((line) => line.startsWith("신청자:"))
    .slice(-8)
    .join("\n")
    .replace(/^신청자:\s*/gm, "")
    .trim()
    .slice(0, 1_200);
  const gaps = evidence.gaps
    .slice(0, 3)
    .map((gap) => `- ${gap.label}: ${gap.suggestedAction}`)
    .join("\n");
  return ensureFormTableNotice(
    heading,
    [
      `${heading}은 현재까지 신청자가 제공한 설명을 바탕으로 우선 정리한 검토용 초안임.`,
      userContext || "신청자가 제공한 사업 설명을 해당 평가항목에 맞춰 추가 정리할 필요가 있음.",
      PROOF_NEEDED_PLACEHOLDER,
      gaps ? `보충하면 좋은 자료\n${gaps}` : "보충하면 좋은 자료: 고객 대화, 실행 화면, 매출·계약 자료, 공식 시장자료 중 해당 자료",
    ].join("\n\n"),
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
    messages,
    code,
    program,
    sections,
    formToc,
    evidence: clientEvidence,
    strategy: clientStrategy,
    documentConfirmed,
    provider: rawProvider,
  } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: ProgramInput;
    sections?: RequestedSection[];
    formToc?: unknown;
    evidence?: EvidencePack;
    strategy?: StrategyPack;
    documentConfirmed?: boolean;
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
  const application = decideDraftApplication(
    program,
    documentConfirmed === true || (Array.isArray(formToc) && formToc.length > 0),
  );
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
    ? await Promise.all([
        getEvidencePack(access.user.id, access.admin),
        getStrategyPack(access.user.id, access.admin),
      ])
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
    bypassBudget: access.admin,
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
    let rawText = "";
    let stopReason: string | null = null;
    for await (const chunk of getLlm(provider, "balanced").streamText({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 5_500,
      onStop: (stop) => {
        stopReason = stop.reason ?? null;
      },
      onUsage: async (usage) => {
        await reservation.complete(usage);
        completed = true;
      },
    })) {
      rawText += chunk;
    }
    const parsed = parseRevisionOutput(rawText, safeSections.map((section) => section.heading));
    const received = parsed.sections;
    const output: PlanDocxSection[] = safeSections.map((requested, index) => {
      const exact = received.find((item) => String(item.heading ?? "").trim() === requested.heading);
      const fallback = received[index];
      const content = String(exact?.content ?? fallback?.content ?? "").trim().slice(0, 18_000);
      return {
        heading: requested.heading,
        content: content
          ? ensureFormTableNotice(requested.heading, content)
          : fallbackSectionContent(requested.heading, conversation, storedEvidence),
      };
    });
    return Response.json(
      {
        sections: output,
        degraded: parsed.recoveredFromText || received.length < safeSections.length || stopReason === "max_tokens",
        warning:
          parsed.recoveredFromText || received.length < safeSections.length || stopReason === "max_tokens"
            ? "AI 응답에서 확인 가능한 목차만 복구하고, 빠진 목차는 신청자 설명과 증거 보충 안내로 우선 작성했습니다."
            : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (!completed) await reservation.release();
    console.error("[/api/plan/draft-batch]", error);
    return Response.json(
      {
        sections: safeSections.map((section) => ({
          heading: section.heading,
          content: fallbackSectionContent(section.heading, conversation, storedEvidence),
        })),
        degraded: true,
        warning:
          "초안 자동 작성 연결이 끊겨 신청자가 제공한 설명으로 검토용 초안을 우선 만들었습니다. 새 자료를 올린 뒤 해당 목차만 다시 작성할 수 있습니다.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
