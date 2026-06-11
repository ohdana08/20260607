import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkCodeForProgram } from "@/lib/plan/access";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ProgInfo {
  id?: string;
  title?: string;
  summary?: string;
  target?: string;
  supportField?: string;
}

function codeErr(reason?: string): Response {
  return Response.json(
    {
      error:
        reason === "used_elsewhere"
          ? "이 코드는 다른 사업계획서에 이미 사용됐어요. 다른 지원사업은 새로 결제해 주세요."
          : "이용권 코드가 필요해요.",
    },
    { status: 402 },
  );
}

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

  return `당신은 "${title}"에 지원할 사업계획서를 사용자와 함께 완성하는 전문 컨설턴트예요.

[이 지원사업 정보]
${ctx}

당신의 임무: 위 지원사업의 성격에 맞는 좋은 사업계획서를 쓰는 데 꼭 필요한 내용을, 사용자에게서 "충분히" 끌어내는 거예요. 한두 마디로 대충 넘어가면 안 돼요.

규칙:
- 100% 쉬운 일상어. 전문용어(문제인식·시장규모·수익모델·사업화·정량지표 등)는 사용자에게 절대 쓰지 마세요.
- 한 번에 질문 하나씩. 사용자 답에 짧게 공감 → 다음 질문 하나.

[질문하는 방식 — 매우 중요]
- 사용자가 머릿속 생각을 쉽게 떠올리도록, 질문에 **쉬운 비유나 예시를 곁들여** 물어보세요.
  (예: "가게로 치면 어떤 손님이 문을 열고 들어올까요?", "친구한테 자랑한다면 뭐라고 말하실 거예요?", "하루를 떠올려보면 어떤 순간에 이게 필요할까요?")
- ⚠️ 비유·예시는 '생각의 마중물'일 뿐이에요. **절대 그 예시 내용을 사용자의 답인 것처럼 정리하거나 채워 넣지 마세요.** 항상 "이건 그냥 예시고, ○○님 사업의 진짜 이야기를 들려주세요"처럼 본인 것을 끌어내세요. (사용자가 예시를 그대로 베껴 답하면, 본인 경우로 다시 구체화해 달라고 하세요.)
- **최대한 구체적으로** 끌어내세요: 실제로 겪은 일, 진짜 숫자, 구체적인 상황·장면으로. 답이 두루뭉술하면 "예를 들어 실제로 어떤 일이 있었어요?", "숫자로 말하면 대략 얼마나요?", "그 장면을 좀 더 자세히 그려주실 수 있어요?" 하고 계속 파고드세요. 한 주제도 대충 넘어가지 말고 충분히 깊게.

[충분히 끌어낼 주제]
  1) 어떤 불편/문제를 해결하려는지, 왜 중요한지
  2) 그걸 어떻게 해결하는지 (제품·서비스 구체적으로)
  3) 비슷한 것과 뭐가 다른지 (차별점)
  4) 누가 고객이고, 얼마나 많을 것 같은지
  5) 어떻게 돈을 버는지
  6) 앞으로 1년 계획과 지원금을 어디에 쓸지
  7) 본인·팀의 강점

- 위 7가지를 충분히·구체적으로 들었다고 판단될 때만: "이제 충분히 들었어요! 아래 '사업계획서 초안 만들기' 버튼을 눌러주세요 😊" 라고 안내하세요. 그 전엔 계속 질문하세요.
- 사용자가 공고문이나 양식 사진을 첨부하면, 그 내용을 보고 그 사업계획서가 요구하는 항목 위주로 질문하세요.`;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, code, program, programTitle, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: ProgInfo;
    programTitle?: string;
    provider?: unknown;
  };

  const codeCheck = await checkCodeForProgram(code, program?.id);
  if (!codeCheck.ok) return codeErr(codeCheck.reason);
  const rl = await checkRateLimit(req, "planChat");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

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
  if (!Array.isArray(messages)) {
    return Response.json({ error: "대화 내용이 필요해요." }, { status: 400 });
  }

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
          system: systemFor(program ?? { title: programTitle }),
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
