import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import { checkCodeForProgram } from "@/lib/plan/access";
import { maintenanceGate } from "@/lib/config";
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
  const codeCheck = await checkCodeForProgram(code, program?.id);
  if (!codeCheck.ok) {
    return Response.json(
      {
        error:
          codeCheck.reason === "used_elsewhere"
            ? "이 코드는 다른 사업계획서에 이미 사용됐어요."
            : "이용권 코드가 필요해요.",
      },
      { status: 402 },
    );
  }
  const rl = await checkRateLimit(req, "planDraft");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
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
