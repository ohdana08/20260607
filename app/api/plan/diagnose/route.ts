import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { isEmail, sendReportEmail } from "@/lib/diagnosis";
import { buildReportDocxBase64 } from "@/lib/report-docx";

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
당신은 따뜻하고 다정한 상담사예요. 각 단계를 친근하게 묻고, 답을 받아 약점을 찾아냅니다.
목표: 단순히 답만 받는 게 아니라, **사업계획서에 쓸 '근거 자료'를 사장님이 이미 가지고 있다면 꺼내오도록 유도**하는 것.

[7단계 — 한 번에 한 단계씩. 각 단계는 "① 핵심 질문" + "② 가진 자료가 있으면 끌어내는 한마디"로 구성]
1. 시장 — ① "이 사업, 이미 비슷한 걸로 돈 버는 사람이 있나요?"
   ② "혹시 경쟁사 가격표·시장 기사·통계, 비슷한 업체 캡처 있으면 📎로 올려주세요. 계획서 '시장성'에 그대로 써요."
2. 문제 — ① "고객이 실제로 불편해하는 문제가 뭔가요? 한 문장으로요."
   ② "그 불편을 보여주는 고객 카톡·문의·리뷰·댓글 캡처 있으면 올려주세요. '문제 정의'의 강력한 근거예요."
3. 돈 쓰는 고객 — ① "이 문제에 '이미 돈을 쓰고 있는' 사람이 있나요?"
   ② "고객이 비슷한 데 돈 쓴 증거(영수증·결제·구독·인강 캡처) 있으면 올려주세요. '수요 검증'이 됩니다."
4. 판매 검증 — ① "만들기 전에 팔아본 적(예약·문의·선주문) 있나요?"  ← 가장 중요, 대부분 비어 있음
   ② "예약·문의·선주문·결제·체험단 모집 화면 있으면 꼭 올려주세요. 심사에서 제일 세게 보는 증거예요."
5. 반응 수정 — ① "고객 반응을 보고 바꿔본 경험이 있나요?"
   ② "피드백 받고 바꾼 기록(전/후, 고객 대화) 있으면 올려주세요. '실행력'을 보여줘요."
6. 반복 구조 — ① "한 번이 아니라 계속 팔릴 구조(재구매·반복)가 있나요?"
   ② "재구매·정기결제·재방문 데이터 있으면 올려주세요. '지속성'의 근거예요."
7. 확장 — ① "구조가 잡히기 전에 확장하려는 건 아닌가요?"
   ② "지금까지 운영 자료(매출 추이·고객 수 등) 있으면 올려주세요."

규칙:
- 한 번에 질문은 딱 하나. 사용자 답에 짧게 공감 → 그 단계의 "자료 유도 한마디"를 가볍게 덧붙임 → 다음 단계 하나.
- ⚠️ 자료 유도는 '부담 주지 않게' 한 문장만. 없다고 하면 "괜찮아요, 나중에 만들면 돼요"라고 넘어가고 그 단계를 '약점'으로 기록(혼내지 말 것).
- 사용자가 짧게 답해도 OK. "모르겠다/없다"는 그 단계를 약점으로 기록하되 부드럽게: "여기가 비어 있네요, 대부분이 놓치는 부분이에요."
- 100% 쉬운 일상어. 전문용어(시장규모·수익모델·사업화·정량지표 등) 금지.
- 📎 **사용자가 사진·캡처·PDF·문서를 첨부하면, 반드시 내용을 읽고** 무엇이 보이는지 한마디로 짚은 뒤("올려주신 화면 보니 ○○가 있네요!") 그 단계의 근거로 적극 반영하세요. 안 보이면 "이미지가 잘 안 보여요, 다시 올려주실래요?".
- 7단계를 다 물었으면(또는 사용자가 그만하고 싶어 하면): "7단계를 다 봤어요! 아래 '📋 내 사업 진단 결과 보기' 버튼을 눌러주세요 😊"라고 안내하세요.`;

// 화면 '맛보기'만 — 빠른 모델(Haiku)로 즉시 생성해 사용자 대기를 최소화.
function teaserSystem(p: ProgInfo): string {
  const title = p.title || "이 지원사업";
  return `7단계 자가진단 대화를 종합해, 화면에 보여줄 '맛보기'를 아래 JSON 한 개로만 출력하세요. (다른 말·코드블록 없이 JSON만)
대상 지원사업: "${title}"

{
  "strengthLine": "사장님 사업의 강점을 따뜻하게 한 줄로 (쉬운 일상어)",
  "weaknesses": ["치명적 약점 항목명1", "치명적 약점 항목명2"]
}

규칙:
- weaknesses 는 '항목명만' 정확히 2개 (예: "판매 검증", "반복 구조"). 해결법·설명은 넣지 마세요.
- 첨부한 사진·문서가 있으면 근거로 반영. 100% 쉬운 일상어.`;
}

// 이메일로 보낼 전체 보고서 — '평문'으로 생성(긴 출력에 견고). JSON 미사용.
function fullReportSystem(p: ProgInfo): string {
  const title = p.title || "이 지원사업";
  return `당신은 13년간 380개 공공기관 정부지원사업을 심사해 온 수석 심사위원이자 컨설턴트예요.
7단계 자가진단 대화(+첨부 자료)를 바탕으로, 사용자가 '실제로 합격용 사업계획서를 쓸 수 있도록' 구체적·실행가능한 진단 보고서를 작성하세요.
대상 지원사업: "${title}"

⚠️ 가장 중요한 금지사항: 사용자가 한 말을 그대로 다시 풀어쓰기(요약·재진술)만 하지 마세요. 그건 가치가 없습니다.
반드시 "심사위원 관점의 새로운 통찰 + 구체적 실행 방법 + 자료/근거 찾는 법"을 더해야 합니다.

출력은 아래 [보고서 형식] 그대로 '평문'으로만 작성하세요. JSON·코드블록·마크다운 기호(#, *)는 쓰지 마세요. 보고서 본문만 출력하세요.

[보고서 형식] — 이 순서·제목을 지키세요:

📋 사장님 사업 진단 보고서

[ 한눈에 보기 ]
지금 상태를 2~3문장으로 솔직하게. 합격까지 무엇이 가장 급한지 콕 집어서.

✅ 강점
강점 1~2개. 각각 "무엇이 강점인지 → 심사위원은 이걸 왜(어느 평가항목·배점에서) 좋게 보는지".

⚠️ 보완이 필요한 치명적 약점
약점 2~3개. 각 약점마다 아래 4가지를 반드시 모두 쓰세요(빠뜨리지 말 것):
  • 무엇이(What): 어느 부분이 비어있거나 약한지 구체적으로
  • 왜 약한가(Why·심사위원 기준): 정부지원 심사위원이 이 항목을 어떤 관점·배점으로 보는지, 비면 왜 감점/탈락 사유인지 (구체적으로)
  • 어떻게 바꾸나(How): 합격 수준으로 끌어올리는 구체적 개선 방향 + 당장 할 수 있는 실행 액션(숫자·예시 포함. 예: "타깃 고객 10명 인터뷰", "사전예약 폼으로 2주간 선주문 받기", "체험단 5명 모집")
  • 근거 찾는 법(Find): 필요한 데이터·증거를 어디서 어떻게 구하는지 구체적 출처·검색어. 예) 통계청 KOSIS(kosis.kr)에 "○○ 시장규모" 검색 / 네이버 데이터랩으로 검색량 / DART로 경쟁사 매출 / 구글폼 설문 / 사전예약·선주문 캡처

💡 심사위원 한마디
심사위원이 실제로 할 법한 직설적인 코멘트 1~2문장.

📎 다음 단계 — 사업계획서로 가기
위 'Find'에서 모을 자료(시장 데이터·고객 인터뷰·사전수요/선주문·매출 캡처 등)를 모아두라고 안내하고,
"사업계획서를 쓸 때 이 자료들을 함께 첨부해 주시면, 13년·380개 심사 노하우 엔진이 합격 구조의 사업계획서로 정리해드립니다."로 자연스럽게 연결하세요.

규칙:
- 100% 쉬운 일상어. 단, 막연하면 안 됨 — 늘 구체적 숫자·예시·출처를 들 것.
- 대화/첨부에서 사용자가 실제로 말한 내용을 근거로 하되, 일반적 심사 기준과 실행법은 적극적으로 더하세요.
- 사실을 지어내지 말고, 가격·결제 문구는 넣지 마세요.
- 보고서 본문(평문)만 출력하세요. 머리말·꼬리말·JSON 금지.`;
}

interface TeaserJson {
  strengthLine: string;
  weaknesses: string[];
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

  const { messages, program, kind, email, weaknessSummary: rawWeakness, provider: rawProvider } =
    (body ?? {}) as {
      messages?: unknown;
      program?: ProgInfo;
      kind?: "chat" | "report" | "report_email";
      email?: unknown;
      weaknessSummary?: unknown;
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

  // ── 진단 결과 ① 화면 맛보기: 빠른 모델(Haiku)로 즉시 생성 → 바로 반환 ──
  if (kind === "report") {
    const teaserLlm = getLlm(provider, "fast");
    let teaser: TeaserJson;
    try {
      teaser = await teaserLlm.json<TeaserJson>({
        system: teaserSystem(program ?? {}),
        messages: [...trimmed, { role: "user", content: "위 JSON으로 맛보기만 출력해줘." }],
        schema: {},
        maxTokens: 400,
      });
    } catch (err) {
      console.error("[/api/plan/diagnose teaser]", err);
      return Response.json({ error: "진단 결과를 정리하지 못했어요." }, { status: 502 });
    }

    const strengthLine = String(teaser.strengthLine ?? "").trim();
    const weaknesses = Array.isArray(teaser.weaknesses)
      ? teaser.weaknesses.map((w) => String(w).trim()).filter(Boolean).slice(0, 2)
      : [];

    return Response.json({ teaser: { strengthLine, weaknesses } });
  }

  // ── 진단 결과 ② 전체 보고서 생성 + Word 첨부 이메일 '동기' 발송 ──
  // 별도 요청으로 분리해 맛보기는 빠르게 유지하면서, 발송은 응답 전에 await로 확실히 실행.
  // (Vercel Hobby는 응답 후 after()/백그라운드가 끝까지 안 돌 수 있어 동기로 처리한다.)
  if (kind === "report_email") {
    if (!isEmail(email)) {
      return Response.json({ ok: false, sent: false, error: "email_required" }, { status: 400 });
    }
    const progTitle = program?.title || "이 지원사업";
    try {
      const reportLlm = getLlm(provider, "fast"); // Haiku — 무료 진단 비용 최소화
      // 긴 보고서는 JSON 한 필드에 넣으면 잘림/이스케이프로 깨지므로 '평문 스트림'으로 받는다.
      let fullReportText = "";
      for await (const chunk of reportLlm.streamText({
        system: fullReportSystem(program ?? {}),
        messages: [
          ...trimmed,
          { role: "user", content: "위 [보고서 형식] 그대로, 각 약점의 What/Why/How/Find를 빠짐없이 채워 평문으로 작성해줘." },
        ],
        maxTokens: 3000,
      })) {
        fullReportText += chunk;
      }
      fullReportText = fullReportText.trim();
      if (!fullReportText) {
        console.error("[/api/plan/diagnose report_email] empty fullReportText");
        return Response.json({ ok: false, sent: false, error: "empty_report" }, { status: 502 });
      }
      // 약점요약은 맛보기 단계에서 만든 값을 클라가 넘겨줌(시트 저장용). 없으면 빈 값.
      const weaknessSummary = (typeof rawWeakness === "string" ? rawWeakness : "").slice(0, 120);
      const docxBase64 = await buildReportDocxBase64(`${progTitle} · 사업 진단 보고서`, fullReportText);
      const sent = await sendReportEmail({ email, fullReportText, weaknessSummary, docxBase64 });
      return Response.json({ ok: true, sent });
    } catch (err) {
      console.error("[/api/plan/diagnose report_email]", err);
      return Response.json({ ok: false, sent: false, error: "failed" }, { status: 502 });
    }
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
