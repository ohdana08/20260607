import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkDraftAccess, markCreditUsed, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import { maintenanceGate } from "@/lib/config";
import { googleLoginGate } from "@/lib/auth/googleUser";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import {
  MISSING_INFO_PLACEHOLDER,
  PROOF_NEEDED_PLACEHOLDER,
  reviewChecklistForHeading,
  sanitizeFormToc,
} from "@/lib/plan/sections";
import { generateChunked, CONTINUE_PROMPT } from "@/lib/plan/draftChunking";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, code, program, programTitle, section, formToc, readiness, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: {
      id?: string;
      title?: string;
      summary?: string;
      target?: string;
      supportField?: string;
      applicationKind?: "business-plan" | "simple-application" | "reservation" | "unknown";
      requiresBusinessPlan?: boolean | null;
      applicationKindReason?: string;
    };
    programTitle?: string;
    section?: { heading?: string; guide?: string };
    formToc?: unknown;
    readiness?: { ready?: unknown; score?: unknown; missing?: unknown };
    provider?: unknown;
  };

  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await googleLoginGate(req);
  if (loginGate) return loginGate;
  // rate limit을 코드 검증보다 먼저 — 코드 추측 시도도 제한에 걸리게(점검표 문제 3)
  const rl = await checkRateLimit(req, "planDraft");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  // 유료 관문(2026-07-09): 주문번호 인증(is_paid) 또는 마스터 코드
  const access = await checkDraftAccess(req, code, program?.id);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  const application = decideDraftApplication(program);
  if (!application.ok) return draftApplicationError(application);
  if (!Array.isArray(messages) || !section?.heading) {
    return Response.json({ error: "필요한 정보가 부족해요." }, { status: 400 });
  }
  const ready =
    readiness?.ready === true &&
    Number(readiness.score) >= 80 &&
    Array.isArray(readiness.missing) &&
    readiness.missing.length === 0;
  if (!ready) {
    return Response.json(
      { error: "질문 답변이 아직 충분하지 않아요. 부족한 항목을 더 답한 뒤 초안을 만들어 주세요." },
      { status: 409 },
    );
  }
  if (access.ok && access.user && program?.id) {
    // 이용권 소진(2026-07-13): 첫 초안 생성 시점에 이 공고에 바인딩 (이미 바인딩됐으면 유지)
    await markCreditUsed(access.user.id, program.id);
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
  const llm = getLlm(provider, "quality");

  const conversation = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "사용자" : "상담사"}: ${m.content}`)
    .join("\n");

  const pTitle = program?.title || programTitle || "해당 지원사업";
  const safeFormToc = Array.isArray(formToc)
    ? sanitizeFormToc(formToc.filter((x): x is string => typeof x === "string"))
    : [];
  const formTocIndex = section?.heading ? safeFormToc.indexOf(section.heading) : -1;
  const formTocRules =
    safeFormToc.length > 0
      ? `
[공식 양식 목차 고정 규칙]
- 아래 목차는 사용자가 업로드한 공식 양식에서 코드로 추출한 항목명입니다.
- 항목명 원문과 순서를 절대 바꾸지 마세요.
- "1-1~1-4"처럼 항목을 압축하거나 병합하지 마세요.
- 항목을 삭제하거나 새 항목을 추가하지 마세요.
- 지금 작성할 것은 전체 ${safeFormToc.length}개 중 ${formTocIndex >= 0 ? formTocIndex + 1 : "해당"}번째 항목 하나입니다.
`
      : "";
  const reviewChecklist = reviewChecklistForHeading(section.heading)
    .map((item) => `- ${item}`)
    .join("\n");
  const progCtx = [
    program?.summary ? `- 공고 개요: ${program.summary}` : "",
    program?.target ? `- 지원대상: ${program.target}` : "",
    program?.supportField ? `- 지원분야: ${program.supportField}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `당신은 정부지원사업 사업계획서를 대신 써주는 전문 컨설턴트예요.
"${pTitle}"에 제출할 사업계획서의 한 항목을 작성합니다.
${progCtx ? `\n[이 지원사업 정보]\n${progCtx}\n` : ""}
${formTocRules}
작성 규칙:
- 이 지원사업의 취지·지원대상에 맞게 쓰세요.
- 아래 [대화]에서 사용자가 실제로 말한 내용을 근거로 구체적으로 쓰세요.
- 실제 사업계획서에 들어갈 격식 있고 설득력 있는 문체(존댓말이 아닌 평서체 '~함/~임/~다')로.
- 마크다운 기호(#, * 등)는 쓰지 말고, 자연스러운 문단으로만.
- 정보가 부족한 부분은 사실을 지어내거나 과장하지 말고, 아래 보완 표시를 그대로 남기세요:
${MISSING_INFO_PLACEHOLDER}
- 실제 매출, 인원, 일정, 투자금액, 고객 수, 인증, 특허, 수출, 계약 같은 사실은 사용자 발화나 첨부 자료에 있을 때만 쓰세요.

[환각 방지 — 반드시 준수]
- [대화]에 아예 없는 구체적인 숫자·기관명·인명·수상명·계약명을 절대 새로 만들어 내지 마세요.
  특히 아래 유형은 [대화]에 사용자가 실제로 말한 값이 아니면 임의로 채우지 마세요:
  · 수치: 매출액, 전환율, 이용자·구독자 수, 재구매율, 성장률, 투자금액 등
  · 고유명사: 투자사·파트너사·거래처 이름, 수상명·수상기관, 인증명
  · 실적: 계약·납품·MOU 체결 여부와 그 상대방
- 사용자가 "반응이 좋다/논의가 진행 중이다/여러 곳과 협업 중이다"처럼 있다는 암시만 주고 구체값을
  주지 않았다면, "약 000명", "다수의 기업" 같은 얼버무린 가짜 구체성도 만들지 말고, 사용자가 말한
  수준(암시) 그대로 서술하거나 아래 표시를 남기세요:
${PROOF_NEEDED_PLACEHOLDER}
- MISSING_INFO 표시(위)와 이 증빙 표시는 다릅니다 — 정보가 아예 없으면 위 보완 표시를,
  "있다는 말은 했지만 구체값·확정 여부가 없어" 검증이 필요하면 이 증빙 표시를 쓰세요.
- 진행 중·협의 중인 일을 이미 확정·완료된 것처럼 단정하지 마세요(예: "계약 논의 중"을
  "계약 체결"로 쓰지 말 것). 목표·계획으로 서술하는 것은 괜찮습니다.
- 사업 소재지는 사용자가 실제 입력한 지역만 쓰세요. 지역을 확인할 수 있으면 "사업 소재지: 사용자가 실제 입력한 지역" 형식으로, 확인할 수 없으면 "사업 소재지: 아직 입력하지 않음"이라고 쓰세요.
- 지역 자격은 업로드한 공고문이 요구하는 본사·사업장·공장 등의 소재지 기준에 맞춰 판단하세요.
- 지역 정보가 부족하면 임의로 추정하지 마세요. 단, 화면에 보이는 소재지 보완 문구는 시스템이 신청현황/일반현황 중 한 곳에만 조건부로 표시하므로 다른 항목에 반복하지 마세요.
- 이 항목에 해당하는 내용만 쓰세요(제목은 다시 쓰지 말 것). 공식 양식의 분량 제한이 있으면 우선 적용하고, 없으면 3~7개의 짧은 문단으로 쓰세요.
- 고객·비교대상·일정·KPI·예산처럼 병렬 비교가 필요한 내용은 장문 산문으로 뭉개지 말고 '항목명: 내용' 형식의 줄을 2개 이상 연속으로 작성하세요. DOCX에서 표로 변환됩니다.

[이 항목의 심사 체크포인트]
${reviewChecklist}

[심사위원 시선 필터 — 작성하며 반드시 점검]
- 13년·380개 공공기관 심사 노하우를 학습한 심사 관점으로, 심사위원이 읽는다는 전제로 논리적·구조적으로 쓰세요.
- 과장 표현("국내 최초/유일/독보적")은 근거가 대화에 없으면 쓰지 말고, 사실 기반의 차분한 표현으로 낮추세요.
- 근거 없는 수치(매출·시장 규모 등)는 단정하지 마세요. 출처가 대화·첨부·공고에 있거나 사용자가 근거 있는 추정치를 요청한 경우에만 출처·가정과 함께 적으세요.
- 대화에 7단계 자가진단 내용이 있으면 이 항목과 연결되는 강점/근거를 자연스럽게 반영하세요.
- 사용자가 첨부 양식을 냈다면 그 양식 항목의 취지에 맞게 쓰되, 항목 구조 자체는 바꾸지 마세요.
- 고객과 수익 항목에서는 사용자·결제자·예산 결정권자를 구분하고, 결제 시점·반복 주기·고객당 금액·제공원가·검증 근거를 대화에서 확인된 범위만 반영하세요.
- 경쟁사 이름 나열보다 고객이 지금 쓰는 대안과 그 대안의 시간·비용·불편을 먼저 대비하세요.
- 모든 핵심 주장에는 대화에서 확인된 근거를 연결하고, 근거가 없으면 보완 또는 증빙 필요 표시를 남기세요.`;

  // [대화]를 앞 턴으로, [작성할 항목]을 뒤 턴으로 분리 — 5회 연속 호출이 같은
  // "system+[대화]" 프리픽스를 공유하고, 그 경계(직전 사용자 턴)에 캐시 breakpoint가
  // 걸려 2~5번째 호출이 캐시 히트한다 (점검표 §3 #8, lib/llm/anthropic.ts 참조)
  const conversationMsg = `[대화]\n${conversation}`;
  const tocMsg = safeFormToc.length > 0 ? `\n\n[전체 공식 양식 목차]\n${safeFormToc.join("\n")}` : "";
  const positionMsg =
    safeFormToc.length > 0 && formTocIndex >= 0 ? `\n[현재 항목 위치] ${formTocIndex + 1}/${safeFormToc.length}` : "";
  const sectionMsg = `[작성할 항목]\n${section.heading}${positionMsg}\n(이 항목에 담을 내용: ${section.guide ?? ""})${tocMsg}`;

  const baseMessages: ChatMsg[] = [
    { role: "user", content: conversationMsg },
    { role: "assistant", content: "네, 대화 내용을 확인했어요. 작성할 항목을 알려주세요." },
    { role: "user", content: sectionMsg },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 섹션 자동 이어쓰기 (2026-07-14): 한 번에 못 끝내고 stop_reason=max_tokens로
        // 잘리면, "방금 쓰던 데서 이어서" 다시 호출해 붙인다 — maxTokens를 올리는 대신
        // 어떤 길이의 항목이든 자연스러운 끝(stop_reason≠max_tokens)까지 반복한다.
        const result = await generateChunked(async (continuationText, onChunk) => {
          const messages: ChatMsg[] =
            continuationText === null
              ? baseMessages
              : [
                  ...baseMessages,
                  { role: "assistant", content: continuationText },
                  { role: "user", content: CONTINUE_PROMPT },
                ];
          let stopReason: string | null | undefined = null;
          for await (const chunk of llm.streamText({
            system,
            messages,
            // 1200→2200 (2026-07-12 통합진단 ⓒ) 이후에도 항목에 따라 여전히 잘려
            // 자동 이어쓰기로 전환(2026-07-14) — 이 값 자체는 더 올리지 않는다.
            maxTokens: 2200,
            onStop: (s) => {
              stopReason = s.reason;
            },
          })) {
            controller.enqueue(encoder.encode(chunk));
            onChunk(chunk);
          }
          return { stopReason };
        });
        if (result.attempts > 1) {
          console.log(
            `[draft-continue] "${section.heading}" 이어쓰기 ${result.attempts}회 (잘림 재현 ${result.attempts - 1}회)`,
          );
        }
        if (result.truncated) {
          console.warn(
            `[draft-truncated] "${section.heading}" 이어쓰기 한도(${result.attempts}회) 도달 — 여전히 잘렸을 수 있음`,
          );
        }
      } catch (err) {
        console.error("[/api/plan/draft]", err);
        controller.enqueue(encoder.encode("(이 항목 작성 중 문제가 생겼어요.)"));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
