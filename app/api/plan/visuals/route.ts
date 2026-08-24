import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import { maintenanceGate } from "@/lib/config";
import { googleLoginGate } from "@/lib/auth/googleUser";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { buildCharts, type VizData } from "@/lib/viz/svg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `당신은 사업계획서에 들어갈 도식 데이터를 정리하는 전문가예요.
아래 [대화]를 바탕으로 4가지 도식 데이터를 JSON으로만 출력하세요(설명 없이 JSON만).

형식:
{
  "tamSamSom": { "tam": "전체 시장 규모 추정(짧게, 예: 국내 약 1조원)", "sam": "유효 시장(짧게)", "som": "목표 시장(짧게)", "note": "추정 근거 한 줄" },
  "journey": { "stages": ["인지", "방문", "구매", "재구매"] },
  "funnel": { "stages": ["노출", "관심", "방문", "구매"] },
  "revenue": { "items": ["수익원 1", "수익원 2"] }
}

규칙:
- 모든 라벨은 쉬운 일상어, 짧게.
- 시장 규모 숫자는 합리적 추정으로 채우되 과장 금지(추정치임).
- 대화에 근거가 약하면 해당 업종에서 흔한 일반적인 값/단계로 채우세요.
- journey/funnel은 4~5단계, revenue는 2~4개.`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { messages, code, program, provider: rawProvider } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: { id?: string };
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
  if (!Array.isArray(messages)) {
    return Response.json({ error: "대화 내용이 필요해요." }, { status: 400 });
  }

  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "AI 키가 설정되지 않았어요." }, { status: 503 });
  }

  const conversation = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "사용자" : "상담사"}: ${m.content}`)
    .join("\n");

  try {
    const data = await getLlm(provider, "fast").json<VizData>({
      system: SYSTEM,
      messages: [{ role: "user", content: `[대화]\n${conversation}` }],
      schema: {},
      maxTokens: 1200,
    });
    const charts = await buildCharts(data);
    return Response.json({ charts });
  } catch (err) {
    console.error("[/api/plan/visuals]", err);
    return Response.json({ error: "도식 생성 중 문제가 생겼어요." }, { status: 500 });
  }
}
