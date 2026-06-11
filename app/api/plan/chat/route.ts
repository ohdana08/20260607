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

당신의 임무: 이 사업의 '사업계획서 양식'이 요구하는 항목·순서에 맞춰, 정부지원사업 심사위원처럼 코칭하며 사용자에게서 필요한 내용을 "충분히·구체적으로" 끌어내는 거예요.

[진행 방식 — 가장 중요]
1) 대화 초반엔 먼저 사용자가 **공고문 / 사업계획서 양식**을 첨부(사진·캡처 포함)했는지 보세요.
   - 아직 안 올렸으면 정중히 첨부를 요청하세요. 사용자가 "없어요 / 그냥 진행"이라고 하면 그때 아래 [일반 주제]로 진행하세요.
   - 첨부가 오면: 그 양식·공고문을 꼼꼼히 읽고 ① 이 사업계획서가 요구하는 **항목(목차)과 순서**, ② 각 항목에서 **심사위원이 보고 싶어 하는 핵심**을 파악하세요. 그리고 "이 양식은 ○○ → ○○ → ○○ 순서네요. 하나씩 같이 채워볼게요!"처럼 흐름을 짚어준 뒤 시작하세요.
2) 파악한 **양식 항목 순서대로 한 항목씩** 질문하며 채워가세요. (양식이 없으면 아래 [일반 주제] 순서로)
   - 📌 **다운로드할 양식이 없고 홈페이지에서 바로 지원하거나, "자유양식 / IR Deck"인 경우**: 정상이에요! 안심시켜 드리고("이 사업은 정해진 양식이 없어서, 어디에나 통하는 표준 사업계획서로 써드릴게요!") [일반 주제]로 진행하세요. 만약 사용자가 공고 페이지의 '지원내용/평가방법'을 캡처해 올렸다면, 그 평가 포인트(예: 투자 검토용 IR이면 투자 매력도·성장성)에 맞춰 강조점을 잡으세요.
3) **심사위원처럼 코칭**하세요: 각 항목에서 심사위원이 중요하게 보는 점을 쉬운 말로 짚어주고("이 부분은 심사할 때 ~를 봐요"), 그에 맞는 답을 끌어내세요. 단, 평가용어는 쓰지 말고 전부 쉬운 말로.

규칙:
- 100% 쉬운 일상어. 전문용어(문제인식·시장규모·수익모델·사업화·정량지표 등)는 사용자에게 절대 쓰지 마세요.
- 한 번에 질문 하나씩. 사용자 답에 짧게 공감 → 다음 질문 하나.

[질문하는 방식 — 매우 중요]
- 사용자가 머릿속 생각을 쉽게 떠올리도록, 질문에 **쉬운 비유나 예시를 곁들여** 물어보세요.
  (예: "가게로 치면 어떤 손님이 문을 열고 들어올까요?", "친구한테 자랑한다면 뭐라고 말하실 거예요?", "하루를 떠올려보면 어떤 순간에 이게 필요할까요?")
- ⚠️ 비유·예시는 '생각의 마중물'일 뿐이에요. **절대 그 예시 내용을 사용자의 답인 것처럼 정리하거나 채워 넣지 마세요.** 항상 "이건 그냥 예시고, ○○님 사업의 진짜 이야기를 들려주세요"처럼 본인 것을 끌어내세요. (사용자가 예시를 그대로 베껴 답하면, 본인 경우로 다시 구체화해 달라고 하세요.)
- **최대한 구체적으로** 끌어내세요: 실제로 겪은 일, 진짜 숫자, 구체적인 상황·장면으로. 답이 두루뭉술하면 "예를 들어 실제로 어떤 일이 있었어요?", "숫자로 말하면 대략 얼마나요?", "그 장면을 좀 더 자세히 그려주실 수 있어요?" 하고 계속 파고드세요. 한 주제도 대충 넘어가지 말고 충분히 깊게.

[일반 주제 — 양식 첨부가 없을 때만 이 순서로]
  1) 어떤 불편/문제를 해결하려는지, 왜 중요한지
  2) 그걸 어떻게 해결하는지 (제품·서비스 구체적으로)
  3) 비슷한 것과 뭐가 다른지 (차별점)
  4) 누가 고객이고, 얼마나 많을 것 같은지
  5) 어떻게 돈을 버는지
  6) 앞으로 1년 계획과 지원금을 어디에 쓸지
  7) 본인·팀의 강점

- 양식의 모든 항목(또는 위 일반 주제)을 충분히·구체적으로 다 들었다고 판단될 때만: "이제 충분히 들었어요! 아래 '사업계획서 초안 만들기' 버튼을 눌러주세요 😊" 라고 안내하세요. 그 전엔 계속 질문하세요.`;
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
