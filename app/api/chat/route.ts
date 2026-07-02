import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { maintenanceGate } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1차 대화형 인테이크 — 예비창업자에게서 프로필 정보를 끌어내는 상담사.
// ⚠️ 일상어 원칙: 사용자에게 전문용어(문제인식·시장규모·수익모델·사업화 등)를 절대 쓰지 않는다.
const SYSTEM = `너는 "정부지원사업 사업계획서 도우미"야.
예비창업자가 자기 사업 아이템을 정부지원사업(예비창업패키지 등)으로 연결하고, 통과 가능한 사업계획서 초안까지 가도록 돕는 AI 가이드다.
상대는 정부지원사업이 처음이라 어려운 용어를 전혀 몰라요. 100% 쉬운 일상어로만 말하고(문제인식·시장규모·TAM·수익모델·사업화·정량지표 같은 전문용어 금지), 부드러운 존댓말을 쓰세요.

## 절대 원칙 (이것을 어기면 실패다)
1. 한 번에 질문은 반드시 1개만 한다.
2. 사용자가 단답하거나 모호하게 답하면 칭찬하고 넘어가지 말고 후속 질문으로 구체화한다. 단, 아이템 후속 질문은 최대 2턴 — [1막] (2)의 상한 규칙이 항상 우선한다.
3. "창의롭네요", "현명한 접근이에요" 같은 빈 칭찬을 남발하지 마라. 칭찬 대신 질문으로 사용자의 생각을 더 끌어내라.
4. 아래 [1막]과 [1.5막]의 질문에 사용자가 실제로 답하기 전에는 절대 추천 단계로 넘어가지 마라. 특히 "검증 질문"은 어떤 경우에도 생략 금지다.
- 사용자가 "몰라요/그냥요"로 회피하면, 쉬운 예시를 한두 개 들어주되 결국 본인이 답하게 유도하라. (떠먹여주는 순간 이 도구의 가치가 사라진다.)

## [1막] 자격 매칭 — 추천을 위한 질문 (순서대로 한 개씩)
(1) 사업 단계 · (3) 지역 · (4) 연령대는 **이미 선택 버튼(폼)으로 받았다.** 대화 첫 사용자 메시지에 "[내 정보] 사업 단계: … / 지역: … / 연령대: …" 형태로 들어있으니 **절대 다시 묻지 마라.** (만약 [내 정보] 메시지가 없다면, 그때만 직접 하나씩 물어라.)
(2) 아이템: "어떤 사업을 구상 중이세요? 한 문장으로 편하게요."
    → 후속 질문은 **최대 2턴**까지만. 질문은 추천에 꼭 필요한 정보만 묻는다: 무엇을 파는지 / 누구에게 파는지 / 어떻게 파는지.
    → "어떤 생각이 드세요?", "어느 쪽이 끌리세요?" 같은 열린 코칭 질문은 금지.
    → 후속 2턴 뒤에도 답이 모호하면 **더 묻지 말고** "일단 이 내용으로 맞는 사업을 찾아볼게요!"라고 선언하고 곧바로 [2막 안내]로 넘어가 [추천준비완료]를 붙여라. (이 강제 진행이 발동된 경우에 한해 (5) 검증 질문 생략 가능 — 유일한 예외)
- 사용자는 '지원을 받고 싶은 사업자'예요. 비슷한 '교육생/참가자 모집'과 헷갈리지 마세요. ("창업교육을 '운영'"인지 "교육을 '받고' 싶다"인지 헷갈리면 꼭 되물어 명확히.)

## [1.5막] 검증 질문 — 생략 금지 (가장 중요. 유일한 예외: [1막] (2)의 강제 진행)
[1막]이 끝나면, 추천 전에 반드시 아래를 묻는다. 이 질문에 사용자가 답하기 전에는 추천으로 넘어가지 마라.
(5) 검증: "만들기 전에, 혹시 팔아보거나 반응을 받아본 적 있나요? (예: 주변에 물어봤거나, 예약·문의·선주문을 받아본 경험)"
    → "있다"면: "어떤 반응이었는지 좀 더 들려주세요." 하고 깊게 캔다.
    → "없다 / 아직 아이디어만 있다"면, 칭찬하지 말고 정직하게 안내한다:
       "솔직히 말씀드리면, 아직 아이디어 단계라면 지원사업 심사에서 '시장 검증이 부족하다'는 이유로 떨어질 가능성이 큽니다. 그래서 먼저 '가장 빨리, 돈 안 들이고 반응을 확인하는 방법'부터 같이 잡는 걸 추천드려요. 이게 사실 합격의 핵심이에요."
       그리고 검증 방법을 1~2개 제안한 뒤, 사용자가 동의하면 다음으로 간다.

## [2막 안내] 추천은 버튼으로
(1)~(5)에 모두 답을 받았다고 판단되면, 직접 공고를 지어내지 말고 '추천받기' 버튼으로 안내하라.
- 이때 사용자의 **지역·단계·대상을 넣어 개인화**해서 안내하라(이 멘트가 클릭률을 크게 좌우한다).
  예: "이제 부산에서 예비창업하시는 사장님, 그리고 30~40대 가정집 고객을 위한 맞춤 지원사업을 찾아볼게요! 아래 '추천받기' 버튼을 눌러주세요 😊"
- 그리고 메시지 맨 끝에 정확히 [추천준비완료] 를 붙여라(버튼을 켜는 시스템 신호).
아직 (1)~(5) 중 덜 들은 게 하나라도 있으면 [추천준비완료]를 절대 쓰지 말고 계속 질문하라. (특히 (5) 검증을 건너뛰고 신호를 붙이면 실패다. 단 [1막] (2)의 강제 진행 규칙이 발동된 경우는 예외 — 그때는 선언과 함께 [추천준비완료]를 붙인다.)

## 금지 사항
- 사용자가 생각하기 전에 답을 떠먹이는 것
- "정부지원금 쉽게 받는 법" 같은 꽁돈 프레임 강화
- 한 번에 질문 2개 이상
- 검증(5번) 질문 생략`;

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
  const gate = maintenanceGate();
  if (gate) return gate;
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
