import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkCodeForProgram } from "@/lib/plan/access";
import { maintenanceGate } from "@/lib/config";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

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

  const { messages, code, program, programTitle, section, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: { id?: string; title?: string; summary?: string; target?: string; supportField?: string };
    programTitle?: string;
    section?: { heading?: string; guide?: string };
    provider?: unknown;
  };

  const gate = maintenanceGate();
  if (gate) return gate;
  // rate limit을 코드 검증보다 먼저 — 코드 추측 시도도 제한에 걸리게(점검표 문제 3)
  const rl = await checkRateLimit(req, "planDraft");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  const codeCheck = await checkCodeForProgram(code, program?.id);
  if (!codeCheck.ok) {
    return Response.json(
      {
        error:
          codeCheck.reason === "used_elsewhere"
            ? "이 코드는 다른 사업계획서에 이미 사용됐어요. 다른 지원사업은 새로 결제해 주세요."
            : "이용권 코드가 필요해요.",
      },
      { status: 402 },
    );
  }
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
작성 규칙:
- 이 지원사업의 취지·지원대상에 맞게 쓰세요.
- 아래 [대화]에서 사용자가 실제로 말한 내용을 근거로 구체적으로 쓰세요.
- 실제 사업계획서에 들어갈 격식 있고 설득력 있는 문체(존댓말이 아닌 평서체 '~함/~임/~다')로.
- 마크다운 기호(#, * 등)는 쓰지 말고, 자연스러운 문단으로만.
- 정보가 부족한 부분은 합리적으로 보완하되, 사실을 지어내거나 과장하지 마세요.
- 이 항목에 해당하는 내용만 쓰세요(제목은 다시 쓰지 말 것). 분량은 2~4문단.

[심사위원 시선 필터 — 작성하며 반드시 점검]
- 13년·380개 공공기관 심사 노하우를 학습한 심사 관점으로, 심사위원이 읽는다는 전제로 논리적·구조적으로 쓰세요.
- 과장 표현("국내 최초/유일/독보적")은 근거가 대화에 없으면 쓰지 말고, 사실 기반의 차분한 표현으로 낮추세요.
- 근거 없는 수치(매출·시장 규모 등)는 단정하지 말고, 출처가 대화에 있으면 함께 적고, 없으면 "추정"임과 가정을 명시하세요.
- 대화에 7단계 자가진단 내용이 있으면 이 항목과 연결되는 강점/근거를 자연스럽게 반영하세요.
- 사용자가 첨부 양식을 냈다면 그 양식 항목의 취지에 맞게 쓰되, 항목 구조 자체는 바꾸지 마세요.`;

  // [대화]를 앞 턴으로, [작성할 항목]을 뒤 턴으로 분리 — 5회 연속 호출이 같은
  // "system+[대화]" 프리픽스를 공유하고, 그 경계(직전 사용자 턴)에 캐시 breakpoint가
  // 걸려 2~5번째 호출이 캐시 히트한다 (점검표 §3 #8, lib/llm/anthropic.ts 참조)
  const conversationMsg = `[대화]\n${conversation}`;
  const sectionMsg = `[작성할 항목]\n${section.heading}\n(이 항목에 담을 내용: ${section.guide ?? ""})`;

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
