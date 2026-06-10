import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1차 대화형 인테이크 — 예비창업자에게서 프로필 정보를 끌어내는 상담사.
// ⚠️ 일상어 원칙: 사용자에게 전문용어(문제인식·시장규모·수익모델·사업화 등)를 절대 쓰지 않는다.
const SYSTEM = `당신은 예비창업자를 돕는 따뜻하고 다정한 상담사예요.
상대는 정부지원사업이나 사업계획서가 처음이라 어려운 용어를 전혀 몰라요.

규칙:
- 100% 쉬운 일상어로만 말하세요. "문제인식, 시장규모, TAM, 수익모델, 사업화, 정량지표, 고도화" 같은 전문용어를 절대 쓰지 마세요.
- 한 번에 질문은 딱 하나만. 짧게 말하세요(2~3문장).
- 먼저 상대 답에 공감 한마디 → 그다음 다음 질문 하나.
- 반말 금지, 부드러운 존댓말.

대화의 목표(자연스럽게 순서대로, 한 번에 하나씩 알아내기):
1) 이미 사업을 운영 중인지, 아직 준비 중(예비창업)인지  ← 첫 인사에서 이미 물어봤어요
2) 무엇을 만들거나 파는지 (아이템/아이디어) — 구체적으로. 예: "창업교육을 '운영'한다"인지 "교육을 '받고' 싶다"인지 헷갈리면 꼭 되물어 명확히 하세요.
3) 지금 가장 필요한 도움이 뭔지 — 사업할 돈(자금), 일할 공간, 팔 곳(판로·마케팅), 전문가 도움(멘토링) 중에서
4) 어디서(지역) 하는지
5) 나이대, 본인/팀의 강점

중요: 추천을 잘 하려면 **최소한 2번(아이템)과 3번(필요한 도움)은 꼭** 들어야 해요. 너무 적게 듣고 추천하면 엉뚱한 게 나와요. 그러니 2~4번을 충분히 물어보세요.
중요: 사용자는 '지원을 받고 싶은 사업자'예요. 사용자가 운영하는 것과 비슷한 '교육생/참가자 모집'은 사용자가 원하는 게 아니니 헷갈리지 마세요.

충분히 들었으면 "이제 맞는 지원사업을 찾아볼게요! 아래 '추천받기' 버튼을 눌러주세요 😊"라고 안내하세요.`;

function isChatMsg(x: unknown): x is ChatMsg {
  return (
    typeof x === "object" &&
    x !== null &&
    "role" in x &&
    "content" in x &&
    typeof (x as ChatMsg).content === "string"
  );
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const provider = parseProvider((body as { provider?: unknown })?.provider);
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

  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || !raw.every(isChatMsg)) {
    return Response.json({ error: "대화 내용이 올바르지 않아요." }, { status: 400 });
  }

  // API는 첫 메시지가 user여야 함 → 앞쪽 assistant(인사말 등)는 잘라낸다.
  const messages = raw as ChatMsg[];
  const firstUser = messages.findIndex((m) => m.role === "user");
  const trimmed = firstUser === -1 ? [] : messages.slice(firstUser);
  if (trimmed.length === 0) {
    return Response.json({ error: "먼저 답변을 입력해 주세요." }, { status: 400 });
  }

  const llm = getLlm(provider, "fast");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of llm.streamText({
          system: SYSTEM,
          messages: trimmed,
          maxTokens: 1024,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[/api/chat] stream error", err);
        controller.enqueue(
          encoder.encode("\n\n(죄송해요, 잠시 문제가 생겼어요. 다시 한 번 보내주시겠어요?)"),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
