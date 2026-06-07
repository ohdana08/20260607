import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { isValidCode } from "@/lib/plan/access";
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

  const { messages, code, programTitle, section, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    programTitle?: string;
    section?: { heading?: string; guide?: string };
    provider?: unknown;
  };

  if (!isValidCode(code)) {
    return Response.json({ error: "이용권 코드가 필요해요." }, { status: 402 });
  }
  const rl = await checkRateLimit(req, "planDraft");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
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

  const system = `당신은 정부지원사업 사업계획서를 대신 써주는 전문 컨설턴트예요.
"${programTitle || "해당 지원사업"}"에 제출할 사업계획서의 한 항목을 작성합니다.

작성 규칙:
- 아래 [대화]에서 사용자가 실제로 말한 내용을 근거로 구체적으로 쓰세요.
- 실제 사업계획서에 들어갈 격식 있고 설득력 있는 문체(존댓말이 아닌 평서체 '~함/~임/~다')로.
- 마크다운 기호(#, * 등)는 쓰지 말고, 자연스러운 문단으로만.
- 정보가 부족한 부분은 합리적으로 보완하되, 사실을 지어내거나 과장하지 마세요.
- 이 항목에 해당하는 내용만 쓰세요(제목은 다시 쓰지 말 것). 분량은 2~4문단.`;

  const userPrompt = `[작성할 항목]\n${section.heading}\n(이 항목에 담을 내용: ${section.guide ?? ""})\n\n[대화]\n${conversation}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of llm.streamText({
          system,
          messages: [{ role: "user", content: userPrompt }],
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
