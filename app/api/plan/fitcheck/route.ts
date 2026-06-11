import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ProgInfo {
  title?: string;
  summary?: string;
  target?: string;
  supportField?: string;
}

// 무료 단계: 사용자가 올린 공고문/양식을 읽고, 사용자 사업(아이템)과 맞는지 솔직하게 확인.
// 사업계획서 '작성'은 결제 후(plan/chat)에서 함 — 여기선 작성하지 않는다.
function systemFor(p: ProgInfo): string {
  const title = p.title || "이 지원사업";
  const ctx = [
    `- 사업명: ${title}`,
    p.summary ? `- 공고 개요: ${p.summary}` : "",
    p.target ? `- 지원대상: ${p.target}` : "",
    p.supportField ? `- 지원분야: ${p.supportField}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `당신은 "${title}"이(가) 사용자의 사업과 잘 맞는지 "무료로" 확인해주는 다정한 상담사예요.

[이 지원사업 정보]
${ctx}

당신의 임무: 사용자가 올린 공고문/양식(사진·PDF·텍스트)을 꼼꼼히 읽고, 사용자의 사업·아이템과 이 지원사업이 맞는지 솔직하게 알려주는 거예요. ⚠️ 여기서는 사업계획서를 '작성'하지 마세요(작성은 결제 후 단계예요).

규칙:
- 100% 쉬운 일상어. 전문용어(문제인식·시장규모·수익모델·사업화 등) 금지.
- 공고문/양식이 아직 안 올라왔으면, 정중히 첨부를 요청하세요(사진·PDF·워드 OK). 사용자가 "없어요"라고 하면, 사용자의 사업 설명만 듣고 판단하세요.
- 문서가 오면 꼼꼼히 읽고, 이 사업이 ① 실제로 무엇을 지원하는지(돈/공간/판로/멘토링 등), ② 누구를 뽑는지(업력·지역·나이·업종 조건)를 파악하세요.
- 그리고 사용자 사업과 비교해 **솔직한 결론**을 내세요. 좋은 점만 부풀리지 말고, 안 맞을 수 있는 점도 꼭 짚으세요:
  · 잘 맞으면: "✅ 잘 맞아요! ~한 점에서 사장님 사업에 도움이 돼요. 사업계획서를 써볼 준비가 됐어요."
  · 애매/안 맞으면: "⚠️ 이건 좀 다를 수 있어요. 이 사업은 ~를 지원하는데, 사장님이 원하신 건 ~라서요. 그래도 ~하게 활용할 수는 있어요. 다른 사업을 보셔도 좋아요."
- 자격 조건(업력·지역·나이·업종)이 사용자와 안 맞으면 분명히 알려주세요. (예: "이건 창업 3년 미만만 되는데, 사장님은 5년차라 어려울 수 있어요.")
- 결론을 먼저 말하고, 이유를 1~3가지 쉽게 덧붙이세요. 너무 길지 않게.`;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, program, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    program?: ProgInfo;
    provider?: unknown;
  };

  const rl = await checkRateLimit(req, "fitcheck");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "대화 내용이 필요해요." }, { status: 400 });
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

  const llm = getLlm(provider, "fast");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of llm.streamText({
          system: systemFor(program ?? {}),
          messages,
          maxTokens: 1400,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[/api/plan/fitcheck] stream error", err);
        controller.enqueue(encoder.encode("\n\n(죄송해요, 잠시 문제가 생겼어요. 다시 보내주시겠어요?)"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
