import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { aiBudgetExceededResponse, reservePaidAiCall } from "@/lib/plan/aiBudget";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import { getEvidencePack, getStrategyPack } from "@/lib/plan/artifacts";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import type { PlanDocxSection } from "@/lib/plan/docx";
import type { PlanReviewIssue } from "@/lib/plan/reviewer";
import { getRevisionStatus, reserveRevisionRound, revisionUnavailableResponse } from "@/lib/plan/revisions";
import { MISSING_INFO_PLACEHOLDER, PROOF_NEEDED_PLACEHOLDER } from "@/lib/plan/sections";
import { evidencePackPrompt } from "@/lib/plan/strategy";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { parseRevisionOutput } from "@/lib/plan/revisionText";

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

function compactSections(sections: PlanDocxSection[], maxChars: number): string {
  const perSection = Math.max(800, Math.floor(maxChars / Math.max(1, sections.length)));
  return sections
    .map((section) => `## ${section.heading}\n${section.content.slice(0, perSection)}`)
    .join("\n\n");
}

const SYSTEM = `당신은 정부지원사업 사업계획서의 수석 편집자입니다. 신청자가 한 번에 묶어 제출한 수정 요청과 심사 지적을 전체 문서에 일관되게 반영하세요.

[절대 규칙]
- 수정이 필요한 목차만 sections에 반환하고, 목차명은 현재 초안과 정확히 같아야 합니다. 수정하지 않은 목차는 출력하지 마세요.
- 사용자 원답변, 첨부자료, 저장된 근거팩·전략팩에 없는 수치·고객·계약·성과·기관명을 만들지 마세요.
- 새 자료가 필요한 문제는 그럴듯하게 메우지 말고 아래 표시를 구체적으로 남기세요.
${MISSING_INFO_PLACEHOLDER}
${PROOF_NEEDED_PLACEHOLDER}
- 근거팩의 conflicts와 gaps를 숨기지 마세요. 사용자가 새 자료로 해결한 경우에만 관련 표시를 제거하세요.
- 현재 성과와 향후 계획, 사용자와 결제자, 사실과 추정을 구분하세요.
- 요청이 없는 기존 강점과 확인된 사실은 보존하세요.
- 설명 없이 {"sections":[{"heading":"정확한 목차명","content":"수정 본문"}]} JSON 하나만 출력하세요.`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { messages, code, program, sections, findings, requestNote, provider: rawProvider } =
    (body ?? {}) as {
      messages?: ChatMsg[];
      code?: string;
      program?: ProgramInput;
      sections?: PlanDocxSection[];
      findings?: PlanReviewIssue[];
      requestNote?: string;
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
    return Response.json({ error: "수정할 전체 초안이 필요해요." }, { status: 400 });
  }
  const safeSections = sections.slice(0, 80).map((section) => ({
    heading: String(section.heading ?? "").trim().slice(0, 160),
    content: String(section.content ?? "").trim().slice(0, 18_000),
  }));
  const safeFindings = (Array.isArray(findings) ? findings : []).slice(0, 30).map((item) => ({
    severity: item.severity,
    section: String(item.section ?? "전체").slice(0, 160),
    issue: String(item.issue ?? "").slice(0, 800),
    action: String(item.action ?? "").slice(0, 800),
    evidenceNeeded: String(item.evidenceNeeded ?? "").slice(0, 500),
  }));
  const note = String(requestNote ?? "").trim().slice(0, 3_000);
  if (safeFindings.length === 0 && !note) {
    return Response.json({ error: "한 번에 반영할 수정 요청을 입력해 주세요." }, { status: 400 });
  }
  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "선택한 AI 키가 설정되지 않았어요." }, { status: 503 });
  }

  const revision = await reserveRevisionRound(access.user?.id, access.admin);
  if (!revision.ok) return revisionUnavailableResponse(revision.status);
  const budget = await reservePaidAiCall({
    userId: access.user?.id,
    bypassBudget: access.admin,
    stage: "revision_batch",
    provider,
    tier: "fast",
    estimatedInputTokens: 52_000,
    maxOutputTokens: 8_000,
  });
  if (!budget.ok) {
    await revision.rollback();
    return aiBudgetExceededResponse(budget);
  }
  const [evidence, strategy] = access.user
    ? await Promise.all([
        getEvidencePack(access.user.id, access.admin),
        getStrategyPack(access.user.id, access.admin),
      ])
    : [null, null];
  const conversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-48)
    .map((message) => `${message.role === "user" ? "신청자" : "도우미"}: ${message.content}`)
    .join("\n")
    .slice(-45_000);
  const prompt = `[지원사업]
- 사업명: ${program?.title || "확인되지 않음"}
- 공고 요약: ${program?.summary || "확인되지 않음"}

[신청자 원답변 및 새로 첨부한 정보]
${conversation}

[저장된 근거팩]
${evidence ? evidencePackPrompt(evidence).slice(0, 40_000) : "저장 근거 없음"}

[저장된 전략팩]
${strategy ? JSON.stringify(strategy, null, 2).slice(0, 30_000) : "저장 전략 없음"}

[현재 전체 초안]
${compactSections(safeSections, 80_000)}

[묶음 수정 요청]
${note || "별도 요청 없음"}

[심사 지적]
${safeFindings.length ? safeFindings.map((item, index) => `${index + 1}. [${item.severity}] ${item.section}\n문제: ${item.issue}\n조치: ${item.action}\n필요자료: ${item.evidenceNeeded || "없음"}`).join("\n") : "없음"}`;

  let completed = false;
  try {
    let rawText = "";
    let stopReason: string | null = null;
    for await (const chunk of getLlm(provider, "fast").streamText({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 8_000,
      onStop: (stop) => {
        stopReason = stop.reason ?? null;
      },
      onUsage: async (usage) => {
        await budget.complete(usage);
        completed = true;
      },
    })) {
      rawText += chunk;
    }
    const parsed = parseRevisionOutput(rawText, safeSections.map((section) => section.heading));
    const received = parsed.sections;
    if (received.length === 0) {
      throw new Error("AI 응답에서 수정된 목차를 복구하지 못했습니다.");
    }
    const output = safeSections.map((section) => {
      const exact = received.find((item) => String(item.heading ?? "").trim() === section.heading);
      const content = String(exact?.content ?? section.content).trim().slice(0, 18_000);
      return { heading: section.heading, content: content || section.content };
    });
    return Response.json(
      {
        sections: output,
        revision: access.user
          ? await getRevisionStatus(access.user.id, access.admin)
          : revision.status,
        degraded: parsed.recoveredFromText || stopReason === "max_tokens",
        warning:
          parsed.recoveredFromText || stopReason === "max_tokens"
            ? "AI가 JSON 형식을 지키지 않아 목차명 기준으로 안전하게 복구했습니다. 심사 결과에서 반영 내용을 한 번 더 확인해 주세요."
            : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (!completed) await budget.release();
    await revision.rollback();
    console.error("[/api/plan/revise]", error);
    return Response.json(
      { error: "묶음 수정을 완료하지 못했어요. 시스템 오류로 수정 횟수는 차감하지 않았어요." },
      { status: 500 },
    );
  }
}
