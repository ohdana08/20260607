import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import { maintenanceGate } from "@/lib/config";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { MISSING_INFO_PLACEHOLDER, sanitizeFormToc } from "@/lib/plan/sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, code, program, programTitle, section, formToc, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: { id?: string; title?: string; summary?: string; target?: string; supportField?: string };
    programTitle?: string;
    section?: { heading?: string; guide?: string };
    formToc?: unknown;
    provider?: unknown;
  };

  const gate = maintenanceGate();
  if (gate) return gate;
  // rate limit을 코드 검증보다 먼저 — 코드 추측 시도도 제한에 걸리게(점검표 문제 3)
  const rl = await checkRateLimit(req, "planDraft");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  // 유료 관문(2026-07-09): 주문번호 인증(is_paid) 또는 마스터 코드
  const access = await checkDraftAccess(req, code);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  if (!Array.isArray(messages) || !section?.heading) {
    return Response.json({ error: "필요한 정보가 부족해요." }, { status: 400 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json(
      {
        error:
          provider === "openai"
            ? "ChatGPT(OpenAI) 키가 아직 설정되지 않았어요."
            : "AI 키가 아직 설정되지 않았어요.",
      },
      { status: 503 },
    );
  }
  const llm = getLlm(provider, "quality");

  const conversation = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "사용자" : "상담사"}: ${m.content}`)
    .join("\n");

  const pTitle = program?.title || programTitle || "해당 지원사업";
  const safeFormToc = Array.isArray(formToc)
    ? sanitizeFormToc(formToc.filter((x): x is string => typeof x === "string"))
    : [];
  const formTocIndex = section?.heading ? safeFormToc.indexOf(section.heading) : -1;
  const formTocRules =
    safeFormToc.length > 0
      ? `
[공식 양식 목차 고정 규칙]
- 아래 목차는 사용자가 업로드한 공식 양식에서 코드로 추출한 항목명입니다.
- 항목명 원문과 순서를 절대 바꾸지 마세요.
- "1-1~1-4"처럼 항목을 압축하거나 병합하지 마세요.
- 항목을 삭제하거나 새 항목을 추가하지 마세요.
- 지금 작성할 것은 전체 ${safeFormToc.length}개 중 ${formTocIndex >= 0 ? formTocIndex + 1 : "해당"}번째 항목 하나입니다.
`
      : "";
  const progCtx = [
    program?.summary ? `- 공고 개요: ${program.summary}` : "",
    program?.target ? `- 지원대상: ${program.target}` : "",
    program?.supportField ? `- 지원분야: ${program.supportField}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `당신은 정부지원사업 사업계획서를 대신 써주는 전문 컨설턴트예요.
"${pTitle}"에 제출할 사업계획서의 한 항목을 작성합니다.
${progCtx ? `\n[이 지원사업 정보]\n${progCtx}\n` : ""}
${formTocRules}
작성 규칙:
- 이 지원사업의 취지·지원대상에 맞게 쓰세요.
- 아래 [대화]에서 사용자가 실제로 말한 내용을 근거로 구체적으로 쓰세요.
- 실제 사업계획서에 들어갈 격식 있고 설득력 있는 문체(존댓말이 아닌 평서체 '~함/~임/~다')로.
- 마크다운 기호(#, * 등)는 쓰지 말고, 자연스러운 문단으로만.
- 정보가 부족한 부분은 사실을 지어내거나 과장하지 말고, 아래 보완 표시를 그대로 남기세요:
${MISSING_INFO_PLACEHOLDER}
- 실제 매출, 인원, 일정, 투자금액, 고객 수, 인증, 특허, 수출, 계약 같은 사실은 사용자 발화나 첨부 자료에 있을 때만 쓰세요.
- 사업 소재지는 사용자가 실제 입력한 지역만 쓰세요. 지역을 확인할 수 있으면 "사업 소재지: 사용자가 실제 입력한 지역" 형식으로, 확인할 수 없으면 "사업 소재지: 아직 입력하지 않음"이라고 쓰세요.
- 지역 자격은 업로드한 공고문이 요구하는 본사·사업장·공장 등의 소재지 기준에 맞춰 판단하세요.
- 지역 정보가 부족하면 임의로 추정하지 마세요. 단, 화면에 보이는 소재지 보완 문구는 시스템이 신청현황/일반현황 중 한 곳에만 조건부로 표시하므로 다른 항목에 반복하지 마세요.
- 이 항목에 해당하는 내용만 쓰세요(제목은 다시 쓰지 말 것). 분량은 2~4문단.

[심사위원 시선 필터 — 작성하며 반드시 점검]
- 13년·380개 공공기관 심사 노하우를 학습한 심사 관점으로, 심사위원이 읽는다는 전제로 논리적·구조적으로 쓰세요.
- 과장 표현("국내 최초/유일/독보적")은 근거가 대화에 없으면 쓰지 말고, 사실 기반의 차분한 표현으로 낮추세요.
- 근거 없는 수치(매출·시장 규모 등)는 단정하지 마세요. 출처가 대화·첨부·공고에 있거나 사용자가 근거 있는 추정치를 요청한 경우에만 출처·가정과 함께 적으세요.
- 대화에 7단계 자가진단 내용이 있으면 이 항목과 연결되는 강점/근거를 자연스럽게 반영하세요.
- 사용자가 첨부 양식을 냈다면 그 양식 항목의 취지에 맞게 쓰되, 항목 구조 자체는 바꾸지 마세요.`;

  // [대화]를 앞 턴으로, [작성할 항목]을 뒤 턴으로 분리 — 5회 연속 호출이 같은
  // "system+[대화]" 프리픽스를 공유하고, 그 경계(직전 사용자 턴)에 캐시 breakpoint가
  // 걸려 2~5번째 호출이 캐시 히트한다 (점검표 §3 #8, lib/llm/anthropic.ts 참조)
  const conversationMsg = `[대화]\n${conversation}`;
  const tocMsg = safeFormToc.length > 0 ? `\n\n[전체 공식 양식 목차]\n${safeFormToc.join("\n")}` : "";
  const positionMsg =
    safeFormToc.length > 0 && formTocIndex >= 0 ? `\n[현재 항목 위치] ${formTocIndex + 1}/${safeFormToc.length}` : "";
  const sectionMsg = `[작성할 항목]\n${section.heading}${positionMsg}\n(이 항목에 담을 내용: ${section.guide ?? ""})${tocMsg}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of llm.streamText({
          system,
          messages: [
            { role: "user", content: conversationMsg },
            { role: "assistant", content: "네, 대화 내용을 확인했어요. 작성할 항목을 알려주세요." },
            { role: "user", content: sectionMsg },
          ],
          maxTokens: 1200,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[/api/plan/draft]", err);
        controller.enqueue(encoder.encode("(이 항목 작성 중 문제가 생겼어요.)"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
