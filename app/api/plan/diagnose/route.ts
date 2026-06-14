import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── [기능 1] 무료 7단계 "될 사업" 자가진단 ─────────────────────────────────
// 추천(또는 적합도 확인) 직후, 이 사업이 "될 사업"인지 7단계로 빠르게 진단한다.
// 결제 전 무료 구간. (업무지시서 v2 — 2장)

interface ProgInfo {
  title?: string;
  summary?: string;
  target?: string;
  supportField?: string;
}

// kind === "chat"  : 7단계를 친근한 문답으로 점검 (약점을 찾아냄)
// kind === "report": 7단계 답을 종합한 진단 리포트(강점/보완/심사위원 한 줄 맛보기) 출력
const STEP_SYSTEM = `추천된 사업으로 계획서를 쓰기 전에, 이 사업이 "될 사업"인지 7단계로 빠르게 진단해요.
당신은 따뜻하고 다정한 상담사예요. 각 단계를 사용자에게 친근하게 묻고, 답을 받아 약점을 찾아냅니다.

[7단계 — 한 번에 한 단계씩, 짧게 물어보세요]
1. 시장 — "이 사업, 돈이 도는 시장인가요? (이미 비슷한 걸로 돈 버는 사람이 있나요?)"
2. 문제 — "고객이 실제로 불편해하는 문제가 있나요? 한 문장으로요."
3. 돈 쓰는 고객 — "이 문제에 '이미 돈을 쓰고 있는' 사람이 있나요?"
4. 판매 검증 — "만들기 전에, 팔아본 적(예약·문의·선주문) 있나요?"  ← 가장 중요, 대부분 비어 있음
5. 반응 수정 — "고객 반응을 보고 바꿔본 경험이 있나요?"
6. 반복 구조 — "한 번이 아니라 계속 팔릴 구조(재구매·반복)가 있나요?"
7. 확장 — "구조가 잡히기 전에 확장하려는 건 아닌가요?"

규칙:
- 한 번에 질문은 딱 하나. 사용자 답에 짧게 공감 → 다음 단계 하나.
- 사용자가 짧게 답해도 OK. "모르겠다/없다"고 하면 그 단계를 '약점'으로 마음에 기록하되, 절대 판단하거나 혼내지 마세요. "여기가 비어 있네요, 이건 대부분이 놓치는 부분이에요"라고 부드럽게.
- 100% 쉬운 일상어. 전문용어(시장규모·수익모델·사업화·정량지표 등) 금지.
- 7단계를 다 물었으면(또는 사용자가 그만 진단하고 싶어 하면): "7단계를 다 봤어요! 아래 '📋 내 사업 진단 결과 보기' 버튼을 눌러주세요 😊"라고 안내하세요.`;

function reportSystem(p: ProgInfo): string {
  const title = p.title || "이 지원사업";
  return `당신은 13년간 380개 공공기관에서 쌓은 심사 노하우를 학습한 진단 상담사예요.
지금까지의 7단계 자가진단 대화를 종합해, 아래 형식 그대로 **진단 리포트**를 출력하세요.
대상 지원사업: "${title}"

[출력 형식 — 이 틀을 그대로 따르세요]
📋 사장님 사업 진단 결과

✅ 강점: (답이 충분히 채워진 단계를 쉬운 말로 1~3개)
⚠️ 보완 필요: (약점으로 보이는 단계 — 특히 4번 판매검증을 비중 있게. 1~3개)

💡 심사위원 관점 한 줄 맛보기:
"이 항목(○○), 정부지원 심사위원은 이렇게 봅니다 → (구체적이고 날카로운 한 줄)"
※ 심사위원 관점은 딱 1줄만 보여주세요. (유료에서 7단계×심사위원 관점을 전부 받습니다)

규칙:
- 100% 쉬운 일상어. 따뜻하지만 솔직하게. 부풀리지 마세요.
- 위 형식의 항목/이모지/순서를 바꾸지 마세요.
- 심사위원 관점은 정확히 한 줄만. 그 이상 풀어 쓰지 마세요.
- 결제 유도 문구나 가격은 적지 마세요. (그 안내는 화면이 따로 보여줍니다)`;
}

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
  const rl = await checkRateLimit(req, "diagnose");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, program, kind, provider: rawProvider } = (body ?? {}) as {
    messages?: unknown;
    program?: ProgInfo;
    kind?: "chat" | "report";
    provider?: unknown;
  };

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

  if (!Array.isArray(messages) || !messages.every(isChatMsg)) {
    return Response.json({ error: "대화 내용이 올바르지 않아요." }, { status: 400 });
  }

  const firstUser = messages.findIndex((m) => m.role === "user");
  const trimmed = firstUser === -1 ? [] : (messages as ChatMsg[]).slice(firstUser);
  if (trimmed.length === 0) {
    return Response.json({ error: "먼저 답변을 입력해 주세요." }, { status: 400 });
  }

  const isReport = kind === "report";
  // 리포트는 강점/약점 종합 판단이라 품질 모델로, 단계 문답은 가벼운 모델로.
  const llm = getLlm(provider, isReport ? "quality" : "fast");
  const system = isReport ? reportSystem(program ?? {}) : STEP_SYSTEM;
  // 리포트는 마지막에 "지금까지 답을 종합해 리포트를 작성해줘" 지시를 덧붙인다.
  const msgs: ChatMsg[] = isReport
    ? [...trimmed, { role: "user", content: "지금까지의 7단계 답을 종합해 진단 리포트를 출력해줘." }]
    : trimmed;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of llm.streamText({
          system,
          messages: msgs,
          maxTokens: isReport ? 1200 : 700,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[/api/plan/diagnose]", err);
        controller.enqueue(encoder.encode("\n\n(잠시 문제가 생겼어요. 다시 시도해 주세요.)"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
