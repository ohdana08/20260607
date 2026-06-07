import { getLlm } from "@/lib/llm/provider";
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

대화의 목표(자연스럽게 순서대로 알아내기):
1) 이미 사업을 운영 중인지, 아직 준비 중(예비창업)인지  ← 첫 인사에서 이미 물어봤어요
2) 무엇을 만들거나 팔 생각인지 (아이템/아이디어)
3) 어디서(지역) 할 생각인지
4) 나이대
5) 본인의 강점이나 잘하는 것

이미 충분히 들었으면, 마지막에 "지금까지 말씀해주신 걸로 맞는 지원사업을 찾아볼게요!"라고 따뜻하게 마무리하세요.`;

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "AI 키가 아직 설정되지 않았어요. 잠시만요!" },
      { status: 503 },
    );
  }

  const rl = await checkRateLimit(req, "chat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
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

  const llm = getLlm("claude");
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
