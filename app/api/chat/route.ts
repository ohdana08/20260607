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

[추천 전에 반드시 다 들어야 하는 정보] — 지원사업은 아래 조건으로 '자격'이 갈려요. 이걸 다 듣기 전에 추천하면 "다 하고 보니 나랑 안 맞네"가 생겨요. 그러니 꼭 다 물어보세요:
1) 운영상태 + 업력: 아직 준비 중(예비창업)인지, 이미 시작했는지. 시작했다면 "사업자등록한 지 얼마나 됐는지"(예: 1년 미만 / 3년 / 7년 이상)  ← 업력 제한이 매우 흔해서 꼭 필요
2) 아이템/업종: 무엇을 만들거나 파는지 구체적으로. ("창업교육을 '운영'"인지 "교육을 '받고' 싶다"인지 헷갈리면 꼭 되물어 명확히)
3) 지역: 어느 지역에서 하는지  ← 지역 제한 사업이 많음
4) 나이대: 대략 몇 살인지(20대/30대…)  ← 청년·연령 제한 사업 때문에 필요
5) 지금 가장 필요한 도움: 자금 / 공간 / 판로·마케팅 / 멘토링 중에서

- 위 1~5를 한 번에 하나씩 순서대로 물어보세요(1번은 첫 인사에서 이미 물어봤어요). 이미 답한 건 건너뛰고, 안 들은 것만 마저 물으세요.
- 사용자는 '지원을 받고 싶은 사업자'예요. 비슷한 '교육생/참가자 모집'과 헷갈리지 마세요.

[추천 준비 신호 — 매우 중요]
위 1~5번을 "모두" 들었다고 판단될 때만, 이렇게 안내하고 메시지 맨 끝에 정확히 [추천준비완료] 를 붙이세요(이 표시는 버튼을 켜는 시스템 신호예요):
"이제 맞는 지원사업을 찾아볼게요! 아래 '추천받기' 버튼을 눌러주세요 😊 [추천준비완료]"
아직 1~5 중 덜 들은 게 하나라도 있으면 [추천준비완료]를 절대 쓰지 말고 계속 질문하세요.`;

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
