import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import type { PlanReviewIssue } from "@/lib/plan/reviewer";
import { MISSING_INFO_PLACEHOLDER, PROOF_NEEDED_PLACEHOLDER } from "@/lib/plan/sections";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const { messages, code, program, section, currentContent, findings, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: ProgramInput;
    section?: { heading?: string };
    currentContent?: string;
    findings?: PlanReviewIssue[];
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
  if (!Array.isArray(messages) || !section?.heading || !currentContent || !Array.isArray(findings)) {
    return Response.json({ error: "수정할 초안과 심사 의견이 필요해요." }, { status: 400 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  const fullConversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "신청자" : "도우미"}: ${message.content}`)
    .join("\n");
  const conversation =
    fullConversation.length > 60000
      ? `${fullConversation.slice(0, 16000)}\n\n[중간 대화 생략]\n\n${fullConversation.slice(-44000)}`
      : fullConversation;
  const safeFindings = findings.slice(0, 8).map((item) => ({
    issue: String(item.issue ?? "").slice(0, 800),
    action: String(item.action ?? "").slice(0, 800),
    evidenceNeeded: String(item.evidenceNeeded ?? "").slice(0, 500),
  }));
  const system = `당신은 정부지원사업 사업계획서의 수석 편집자입니다.
심사위원 지적을 반영해 지정된 목차의 본문만 다시 쓰세요.

규칙:
- 신청자가 실제로 말한 사실과 첨부·공고 맥락만 사용합니다. 새 수치·고객·계약·성과·기관명을 만들지 않습니다.
- 현재 자료만으로 고칠 수 있는 논리 순서, 비교 기준, 구체성, 중복, 가독성 문제를 우선 고칩니다.
- 새 자료가 필요한 지적은 그럴듯하게 메우지 말고 다음 표시를 유지하거나 더 구체적으로 바꿉니다:
${MISSING_INFO_PLACEHOLDER}
${PROOF_NEEDED_PLACEHOLDER}
- 현재 성과와 계획, 사용자와 결제자, 사실과 추정을 명확히 구분합니다.
- 공식 목차명은 출력하지 말고 본문만 씁니다. 설명·머리말·마크다운 기호를 쓰지 않습니다.
- 기존에 확인된 강점과 사실은 삭제하지 않습니다.`;
  const prompt = `[지원사업]
${program?.title ?? "해당 지원사업"}

[신청자 원답변]
${conversation}

[수정할 목차]
${section.heading}

[현재 본문]
${String(currentContent).slice(0, 18000)}

[반영할 심사 의견]
${safeFindings.map((item, index) => `${index + 1}. 문제: ${item.issue}\n조치: ${item.action}\n필요 자료: ${item.evidenceNeeded || "없음"}`).join("\n")}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of getLlm(provider, "quality").streamText({
          system,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 2800,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        console.error("[/api/plan/revise]", error);
        controller.enqueue(encoder.encode(currentContent));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
