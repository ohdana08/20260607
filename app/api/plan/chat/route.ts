import { getLlm } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { isValidCode } from "@/lib/plan/access";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function systemFor(programTitle: string): string {
  return `당신은 "${programTitle}"에 지원할 사업계획서를 사용자와 함께 써주는 다정한 상담사예요.
상대는 어려운 용어를 몰라요. 100% 쉬운 일상어로만, 한 번에 하나씩 짧게 질문하세요.
"문제인식·시장규모·수익모델·사업화·정량지표" 같은 전문용어를 사용자에게 절대 쓰지 마세요.

아래 내용을 자연스럽게 하나씩 끌어내세요(이미 들은 건 건너뛰기):
- 어떤 불편/문제를 해결하려는지, 왜 그게 중요한지
- 누가 이걸 필요로 하는지, 얼마나 많을 것 같은지(느낌으로라도)
- 어떻게 해결하는지, 비슷한 것과 뭐가 다른지
- 어떻게 돈을 벌 생각인지
- 앞으로 1년 계획과 받은 지원금을 어디에 쓸지
- 본인이나 팀의 강점

먼저 사용자 답에 공감 한마디 → 다음 질문 하나.
충분히 모였다고 판단되면: "이제 초안을 만들 준비가 됐어요! 아래 '사업계획서 초안 만들기' 버튼을 눌러주세요 😊" 라고 안내하세요.`;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "AI 키가 설정되지 않았어요." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, code, programTitle } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    programTitle?: string;
  };

  if (!isValidCode(code)) {
    return Response.json({ error: "이용권 코드가 필요해요." }, { status: 402 });
  }
  const rl = await checkRateLimit(req, "planChat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  if (!Array.isArray(messages)) {
    return Response.json({ error: "대화 내용이 필요해요." }, { status: 400 });
  }

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
          system: systemFor(programTitle || "이 지원사업"),
          messages: trimmed,
          maxTokens: 1024,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[/api/plan/chat]", err);
        controller.enqueue(encoder.encode("\n\n(잠시 문제가 생겼어요. 다시 보내주시겠어요?)"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
