import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { maintenanceGate } from "@/lib/config";
import { googleLoginGate } from "@/lib/auth/googleUser";

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

당신의 임무: 사용자가 올린 공고문/양식(사진·PDF·텍스트)을 꼼꼼히 읽고, 사용자의 사업·아이템과 이 지원사업이 맞는지 솔직하게 알려주는 거예요. ⚠️ 여기서는 사업계획서를 아직 '작성'하지 마세요(작성은 다음 단계예요). 결제·가격 이야기는 꺼내지 마세요.

규칙:
- 100% 쉬운 일상어. 전문용어(문제인식·시장규모·수익모델·사업화 등) 금지.
- 공고문/양식이 아직 안 올라왔으면, 정중히 첨부를 요청하세요(사진·PDF·워드 OK). 사용자가 "없어요"라고 하면, 사용자의 사업 설명만 듣고 판단하세요.
- 문서가 오면 꼼꼼히 읽고, 이 사업이 ① 실제로 무엇을 지원하는지(돈/공간/판로/멘토링 등), ② 누구를 뽑는지(업력·지역·나이·업종 조건)를 파악하세요.
- 그리고 사용자 사업과 비교해 **솔직한 결론**을 내세요. 좋은 점만 부풀리지 말고, 안 맞을 수 있는 점도 꼭 짚으세요:
  · 잘 맞으면: "✅ 잘 맞아요! ~한 점에서 사장님 사업에 도움이 돼요. 사업계획서를 써볼 준비가 됐어요."
  · 애매/안 맞으면: "⚠️ 이건 좀 다를 수 있어요. 이 사업은 ~를 지원하는데, 사장님이 원하신 건 ~라서요."
- 자격 조건(업력·지역·나이·업종)이 사용자와 안 맞으면 분명히 알려주세요. (예: "이건 창업 3년 미만만 되는데, 사장님은 5년차라 어려울 수 있어요.")
- ⚠️ **안 맞는다고 판단되면, 같은 문서를 또 올려달라고 반복하지 마세요.** 대신 이렇게 안내하세요: "혹시 사장님께 더 잘 맞는 다른 지원사업을 찾아드릴까요? 그러면 아래 **'🔄 나에게 맞는 지원사업 찾아줘'** 버튼을 눌러주세요!" (당신이 직접 사업을 검색해 추천할 수는 없어요 — 그 버튼이 추천 기능을 실행해요.)
- 사용자가 "찾아줘 / 다른 거 추천해줘"라고 하면: "아래 '🔄 나에게 맞는 지원사업 찾아줘' 버튼을 눌러주세요! 그러면 제가 사장님께 맞는 사업들을 찾아드릴게요 😊"라고 그 버튼으로 안내하세요. (직접 사업 목록을 지어내지 마세요.)
- 결론을 먼저 말하고, 이유를 1~3가지 쉽게 덧붙이세요. ⚠️ 본문 답변은 10줄 이내로 짧게 —
  아래 기계 판독 블록 2개([작성요약]·[자격요건])가 잘리지 않고 반드시 완성되는 것이 더 중요해요.

[작성요약 — 응답 끝에 반드시 (기계 판독용, 본문에서 언급 금지)]
결제 후 사업계획서 작성 단계가 "원본 파일 없이도" 진행되도록, 공고문·양식의 핵심을 아래 블록으로 붙이세요:
[작성요약]
■ 사업계획서 양식 목차: (양식 파일이 있으면 **항목명을 원문 그대로, 순서 그대로, 하나도 빠짐없이** 나열. 번호·소항목 포함. 양식이 없으면 "양식 없음")
■ 항목별 작성 지침·분량: (양식에 명시된 것만)
■ 평가 기준·배점: (공고문 기준)
■ 지원 내용: (금액·기간·혜택)
■ 신청 자격·선정 후 의무: (핵심만)
■ 일정·마감: (있으면)
[/작성요약]
- ⚠️ 양식 목차는 이 요약이 원본을 대체하므로 항목 누락이 곧 초안 항목 누락입니다. 절대 요약하거나 합치지 말고 전부 옮기세요.
- 양식 목차를 제외한 나머지 ■ 항목은 각각 2~3줄 이내로 압축하세요 (블록이 잘리면 전체가 무효가 돼요).

[자격요건 구조화 — 응답 맨 끝에 반드시 (기계 판독용, 본문에서 언급 금지)]
공고문에서 '신청 자격'을 찾아, 응답 맨 마지막 줄에 아래 형식을 정확히 붙이세요:
[자격요건]{"found":true,"required":["필수 자격 (여러 대안 중 택1이면 '최근 1년 투자 1억 이상 또는 매출 3억 이상 또는 사업화지원금 1억 이상 중 1개 필수'처럼 한 항목으로)"],"disqualifiers":["신청 불가 사유 (예: 서울시 창업시설 기존 입주이력)"],"obligations":["선정 후 의무 (예: 선정 후 30일 내 주소 이전)"]}[/자격요건]
- 각 배열은 공고문에 실제로 있는 내용만. 없으면 빈 배열 [].
- ⚠️ 분량 제한: 각 배열 최대 5개 항목, 항목당 60자 이내로 핵심만. (자격 판정에 쓰이는 데이터라
  '신청 가능/불가를 가르는 조건'만 담고, 일반적인 협약 의무 나열은 대표 3개 이내로 줄이세요.)
- 공고문이 없거나 자격 요건을 파악하지 못했으면: [자격요건]{"found":false}[/자격요건]
- 이 블록은 화면에서 숨겨지므로, 사용자용 설명은 본문에 따로 쓰세요.`;
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

  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await googleLoginGate(req);
  if (loginGate) return loginGate;
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
  const system = systemFor(program ?? {});
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let acc = "";
      try {
        for await (const chunk of llm.streamText({
          system,
          messages,
          // 분석 본문 + [작성요약](양식 목차 원문 전체) + [자격요건] 까지 잘리지 않게 (2026-07-12)
          maxTokens: 5000,
        })) {
          acc += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        // ── 마커 미수신 1회 재요청 (2026-07-12 QA E2E에서 발견된 변동성 보강) ──
        // 모델이 기계 판독 블록을 생략하면 자격 게이트가 '자동 확인 불가' 폴백으로 약화된다.
        // 같은 대화 맥락으로(프롬프트 캐시 재사용) 누락 블록만 뽑아 스트림 끝에 이어 붙인다.
        const hasSummary = /\[작성요약\][\s\S]*?\[\/작성요약\]/.test(acc);
        const hasElig = /\[자격요건\][\s\S]*?\[\/자격요건\]/.test(acc);
        if (!hasSummary || !hasElig) {
          console.log(`[/api/plan/fitcheck] 마커 누락 재요청 (작성요약=${hasSummary}, 자격요건=${hasElig})`);
          const missing = [
            ...(!hasSummary ? ["[작성요약]…[/작성요약]"] : []),
            ...(!hasElig ? ["[자격요건]{…}[/자격요건]"] : []),
          ].join(" 그리고 ");
          let fix = "";
          for await (const chunk of llm.streamText({
            system,
            messages: [
              ...messages,
              { role: "assistant", content: acc.slice(-3000) || "(분석 완료)" },
              {
                role: "user",
                content: `방금 응답에서 기계 판독 블록이 누락되었습니다. 다른 설명 없이, 누락된 ${missing} 블록만 시스템 지시의 형식 그대로 출력하세요. 이미 출력한 블록은 다시 쓰지 마세요.`,
              },
            ],
            maxTokens: 2500,
          })) {
            fix += chunk;
          }
          if (fix.trim()) controller.enqueue(encoder.encode(`\n\n${fix.trim()}`));
        }
      } catch (err) {
        console.error("[/api/plan/fitcheck] stream error", err);
        if (!acc) {
          controller.enqueue(encoder.encode("\n\n(죄송해요, 잠시 문제가 생겼어요. 다시 보내주시겠어요?)"));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
