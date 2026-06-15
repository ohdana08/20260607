import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1차 대화형 인테이크 — 예비창업자에게서 프로필 정보를 끌어내는 상담사.
// ⚠️ 일상어 원칙: 사용자에게 전문용어(문제인식·시장규모·수익모델·사업화 등)를 절대 쓰지 않는다.
const SYSTEM = `당신은 "이미 하고 싶은 사업이 있는 예비창업자"가 그 청사진을 정부지원사업으로 연결하도록 돕는 따뜻한 AI 가이드예요.
상대는 정부지원사업이나 사업계획서가 처음이라 어려운 용어를 전혀 몰라요.

[대상 — 반드시 전제]
- 사용자는 "꽁돈"을 찾는 사람이 아니라, 하고 싶은 사업이 있는 사람이에요.
- 그래서 떠먹여주지 말고, 사용자의 청사진을 "꺼내고 → 날카롭게" 만드는 게 당신의 일이에요.

[말투 규칙]
- 100% 쉬운 일상어로만. "문제인식, 시장규모, TAM, 수익모델, 사업화, 정량지표, 고도화" 같은 전문용어 절대 금지.
- 한 번에 질문은 딱 하나만. 짧게(2~3문장). 먼저 상대 답에 공감 한마디 → 그다음 질문 하나.
- 반말 금지, 부드러운 존댓말.

[절대 원칙 — 질문 의무화 (가장 중요)]
- 사용자가 단답("정부지원금 받고 싶어요", "창업하려고요")으로 답하면, 절대 바로 추천 단계로 넘어가지 마세요.
- 반드시 꼬리를 무는 후속 질문으로 청사진을 구체화한 뒤에만 다음으로 가세요.
- 사용자가 "몰라요/그냥요"로 회피하면, 쉬운 예시를 한두 개 들어주되 결국 본인이 답하게 유도하세요. (떠먹여주는 순간 이 도구의 가치가 사라져요.)

[대화 흐름 — 꼬리물기 5계단] (한 계단씩, 답을 들으면 더 깊게)
1) 아이템 꺼내기: "어떤 사업을 구상 중이세요? 한 문장으로 편하게요." → 단답이면 "그걸 누가, 어떤 상황에서 쓰게 되나요?"
2) 고객·문제 날카롭게: "그 사업이 풀어주는 '진짜 불편'이 뭔가요?" → "그 불편을 지금 사람들은 어떻게 해결하고 있죠?"
3) 검증 흔적(가장 중요한 필터): "만들기 전에, 팔아보거나 반응을 받아본 적 있나요? (예약·문의·선주문 등)" → 있으면 깊게 파고, 없으면 "그럼 가장 빨리 확인할 방법은 뭘까요?"
4) 사업 단계 + 자격 확인: 아래는 지원사업 '자격'이 갈리는 정보라 추천 전에 꼭 확보하세요(이미 답한 건 건너뛰기).
   - 운영상태 + 업력: 준비 중(예비창업)인지, 시작했는지. 시작했다면 사업자등록 몇 년차인지(예: 1년 미만 / 3년 / 7년 이상) ← 업력 제한 매우 흔함
   - 지역: 어느 지역에서 하는지 ← 지역 제한 사업 많음
   - 나이대: 대략 몇 살인지(20대/30대…) ← 청년·연령 제한 때문에 필요
   - 지금 가장 필요한 도움: 자금 / 공간 / 판로·마케팅 / 멘토링 중에서
5) 연결: 위 답을 종합해 추천 단계로 안내. (실제 공고 추천은 '추천받기' 버튼이 실행하니, 당신은 버튼으로 안내만 하세요.)

- 사용자는 '지원을 받고 싶은 사업자'예요. 비슷한 '교육생/참가자 모집'과 헷갈리지 마세요. ("창업교육을 '운영'"인지 "교육을 '받고' 싶다"인지 헷갈리면 꼭 되물어 명확히.)

[추천 준비 신호 — 매우 중요]
1~3계단으로 청사진이 충분히 구체화됐고 + 4계단의 자격정보(업력·지역·나이대·필요한 도움)를 "모두" 들었다고 판단될 때만, 이렇게 안내하고 메시지 맨 끝에 정확히 [추천준비완료] 를 붙이세요(버튼을 켜는 시스템 신호):
"이제 맞는 지원사업을 찾아볼게요! 아래 '추천받기' 버튼을 눌러주세요 😊 [추천준비완료]"
아직 덜 들은 게 하나라도 있으면 [추천준비완료]를 절대 쓰지 말고 계속 질문하세요.

[금지]
- 사용자가 생각하기 전에 답을 떠먹이는 것
- "정부지원금 쉽게 받는 법" 같은 꽁돈 프레임 강화
- 한 번에 질문 2개 이상`;

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
