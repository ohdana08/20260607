import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { isEmail, sendReportEmail } from "@/lib/diagnosis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── [기능 1] 무료 7단계 "될 사업" 자가진단 ─────────────────────────────────
// kind:"chat"   → 7단계를 친근한 문답으로 점검 (스트리밍)
// kind:"report" → 7단계 답 종합 → ① 화면 맛보기(teaser) JSON 반환 ② 전체 보고서는 이메일로 발송
//                 (전체 보고서는 화면에 노출하지 않는다)

interface ProgInfo {
  title?: string;
  summary?: string;
  target?: string;
  supportField?: string;
}

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
지금까지의 7단계 자가진단 대화를 종합해, 아래 JSON 한 개만 출력하세요. (다른 말·코드블록 없이 JSON만)
대상 지원사업: "${title}"

출력 JSON 스키마:
{
  "strengthLine": "사장님 사업의 강점을 따뜻하게 한 줄로 (쉬운 일상어)",
  "weaknesses": ["치명적 약점 항목명1", "치명적 약점 항목명2"],
  "weaknessSummary": "약점을 한 문장으로 요약 (시트 저장용, 30자 내외)",
  "fullReportText": "이메일로 보낼 전체 보고서. 줄바꿈(\\n) 포함 평문. 구성: ① 📋 사장님 사업 진단 결과 ② ✅ 강점 ③ ⚠️ 보완 필요(약점 상세 + 왜 위험한지 + 어떻게 메우는지) ④ 💡 심사위원 관점 한 줄 (\"이 항목(○○), 정부지원 심사위원은 이렇게 봅니다 → ...\"). 격려로 마무리."
}

규칙:
- weaknesses 는 '항목명만' 정확히 2개. (예: "판매 검증", "반복 구조") 해결법·설명은 넣지 마세요. ← 화면 맛보기에 항목명만 노출됨
- fullReportText 에는 약점의 상세 설명과 해결 방향, 심사위원 관점을 충분히 담으세요. (이건 이메일로만 갑니다)
- 100% 쉬운 일상어, 솔직하되 부풀리지 않기. 결제 유도 문구·가격은 넣지 마세요.
- 반드시 위 4개 키를 가진 JSON 객체 하나만 출력하세요.`;
}

interface ReportJson {
  strengthLine: string;
  weaknesses: string[];
  weaknessSummary: string;
  fullReportText: string;
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

  const { messages, program, kind, email, provider: rawProvider } = (body ?? {}) as {
    messages?: unknown;
    program?: ProgInfo;
    kind?: "chat" | "report";
    email?: unknown;
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

  // ── 진단 결과: 화면 맛보기(JSON) + 전체 보고서 이메일 발송 ──
  if (kind === "report") {
    const llm = getLlm(provider, "quality");
    let parsed: ReportJson;
    try {
      parsed = await llm.json<ReportJson>({
        system: reportSystem(program ?? {}),
        messages: [
          ...trimmed,
          { role: "user", content: "지금까지의 7단계 답을 종합해 위 JSON으로 진단 결과를 출력해줘." },
        ],
        schema: {},
        maxTokens: 1800,
      });
    } catch (err) {
      console.error("[/api/plan/diagnose report]", err);
      return Response.json({ error: "진단 결과를 정리하지 못했어요." }, { status: 502 });
    }

    const strengthLine = String(parsed.strengthLine ?? "").trim();
    const weaknesses = Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses.map((w) => String(w).trim()).filter(Boolean).slice(0, 2)
      : [];
    const weaknessSummary = String(parsed.weaknessSummary ?? weaknesses.join(", ")).trim();
    const fullReportText = String(parsed.fullReportText ?? "").trim();

    // 전체 보고서는 화면에 내려보내지 않고 이메일로만 발송한다.
    let sent = false;
    if (isEmail(email) && fullReportText) {
      sent = await sendReportEmail({ email, fullReportText, weaknessSummary });
    }

    return Response.json({
      teaser: { strengthLine, weaknesses },
      weaknessSummary,
      sent,
    });
  }

  // ── 7단계 문답 (스트리밍) ──
  const llm = getLlm(provider, "fast");
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of llm.streamText({
          system: STEP_SYSTEM,
          messages: trimmed,
          maxTokens: 700,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("[/api/plan/diagnose chat]", err);
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
