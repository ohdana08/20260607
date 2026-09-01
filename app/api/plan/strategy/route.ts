import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { getLlm, isProviderConfigured, parseProvider, type ChatMsg } from "@/lib/llm/provider";
import { aiBudgetExceededResponse, reservePaidAiCall } from "@/lib/plan/aiBudget";
import { getEvidencePack, saveStrategyPack } from "@/lib/plan/artifacts";
import { checkDraftAccess, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import { sanitizeFormToc } from "@/lib/plan/sections";
import {
  attachDiagramSourceNotes,
  evidencePackPrompt,
  normalizeStrategyPack,
  type EvidencePack,
  type StrategyPack,
} from "@/lib/plan/strategy";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { buildCharts } from "@/lib/viz/svg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `당신은 정부지원사업 심사 논리에 맞춰 근거팩을 전략과 A4 Word 도식 설계로 변환하는 편집자입니다.

[전략 원칙]
- 근거팩과 사용자 발화에 없는 수치·성과·계약·기능·경쟁우위를 만들지 마세요.
- 경쟁우위는 선택된 가까운 경쟁사 2곳의 동일 기준 사실과 우리 사업의 확인된 사실을 비교할 때만 verified로 두세요.
- 차이는 보이지만 우리 쪽 검증이 부족하면 opportunity, 비교 불가하면 none입니다.
- 현재 사실(stated/verified)과 향후 실행계획(plan)을 구분하세요.

[도식 원칙]
- 후보는 tamSamSom, process, comparison, journey, revenue, roadmap의 최대 6종입니다.
- 여섯 개를 채우는 것이 목표가 아닙니다. 심사 설득력이 있고 evidenceIds가 충분한 것만 출력하세요.
- TAM·SAM·SOM은 기준연도와 산식까지 확인된 근거가 없으면 생략하세요.
- comparison은 근거팩의 선택 경쟁사 2곳이 모두 있고, 각 행의 세 칸을 같은 기준으로 비교할 수 있을 때만 출력하세요.
- process, journey, revenue, roadmap도 사용자가 제공한 자료 또는 검증 출처 id를 연결해야 합니다.
- 각 targetSection은 공식 양식 목차 중 가장 맞는 항목명을 원문 그대로 사용하세요.
- 도식 문구는 발표 슬라이드가 아니라 A4 본문에서 읽히도록 짧고 밀도 있게 쓰세요.

설명 없이 아래 JSON 하나만 출력하세요.
{
  "problem":"근거 있는 문제 정의",
  "customer":"사용자·결제자·의사결정자",
  "solution":"해결 방식",
  "competitiveAdvantage":"근거 범위 안의 차이 또는 검증 과제",
  "advantageStatus":"verified|opportunity|none",
  "businessModel":"가격·결제시점·반복주기·원가",
  "goToMarket":"판매경로와 검증계획",
  "roadmap":"실행 요약",
  "kpis":["측정 가능한 KPI"],
  "claims":[{"claim":"핵심 주장", "evidenceIds":["source-1"], "status":"verified|stated|plan|missing"}],
  "diagrams":{
    "tamSamSom":{"tam":"", "sam":"", "som":"", "note":"기준연도·산식", "evidenceIds":["source-1"], "targetSection":"공식 목차명"},
    "process":{"stages":["3~6단계"], "evidenceIds":["source-1"], "targetSection":"공식 목차명"},
    "comparison":{"rows":[{"criterion":"", "ours":"", "competitor1":"", "competitor2":"", "evidenceIds":["source-1"]}], "evidenceIds":["source-1"], "targetSection":"공식 목차명"},
    "journey":{"stages":["3~6단계"], "evidenceIds":["source-1"], "targetSection":"공식 목차명"},
    "revenue":{"items":["2~4개"], "evidenceIds":["source-1"], "targetSection":"공식 목차명"},
    "roadmap":{"items":[{"period":"", "action":"", "output":"", "owner":""}], "evidenceIds":["source-1"], "targetSection":"공식 목차명"}
  }
}`;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { messages, code, program, formToc, evidence: clientEvidence, provider: rawProvider } =
    (body ?? {}) as {
      messages?: ChatMsg[];
      code?: string;
      program?: { id?: string; title?: string; summary?: string; target?: string; supportField?: string };
      formToc?: unknown;
      evidence?: EvidencePack;
      provider?: unknown;
    };

  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const rl = await checkRateLimit(req, "planReview");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  const access = await checkDraftAccess(req, code, program?.id);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  if (!Array.isArray(messages)) {
    return Response.json({ error: "전략을 설계할 사업 정보가 필요해요." }, { status: 400 });
  }
  const evidence = access.user ? await getEvidencePack(access.user.id) : clientEvidence;
  if (!evidence) {
    return Response.json(
      { error: "저장된 근거팩이 없어요. 시장·경쟁 근거 확인부터 다시 실행해 주세요." },
      { status: 409 },
    );
  }
  const provider = parseProvider(rawProvider);
  if (!isProviderConfigured(provider)) {
    return Response.json({ error: "선택한 AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  const safeToc = Array.isArray(formToc)
    ? sanitizeFormToc(formToc.filter((item): item is string => typeof item === "string"))
    : [];
  const reservation = await reservePaidAiCall({
    userId: access.user?.id,
    stage: "strategy",
    provider,
    tier: "balanced",
    estimatedInputTokens: 35_000,
    maxOutputTokens: 5_500,
  });
  if (!reservation.ok) return aiBudgetExceededResponse(reservation);

  const conversation = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-40)
    .map((message) => `${message.role === "user" ? "신청자" : "도우미"}: ${message.content}`)
    .join("\n")
    .slice(-45_000);
  const prompt = `[지원사업]
- 사업명: ${program?.title || "확인되지 않음"}
- 공고 요약: ${program?.summary || "확인되지 않음"}
- 지원대상: ${program?.target || "확인되지 않음"}
- 지원분야: ${program?.supportField || "확인되지 않음"}

[공식 양식 목차]
${safeToc.length ? safeToc.join("\n") : "표준 PSST 목차"}

[저장된 근거팩]
${evidencePackPrompt(evidence).slice(0, 45_000)}

[사용자 원답변]
${conversation}`;

  let completed = false;
  try {
    const raw = await getLlm(provider, "balanced").json<StrategyPack>({
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      schema: {},
      maxTokens: 5_500,
      onUsage: async (usage) => {
        await reservation.complete(usage);
        completed = true;
      },
    });
    const strategy = attachDiagramSourceNotes(normalizeStrategyPack(raw, evidence), evidence);
    const charts = await buildCharts(strategy.diagrams);
    if (access.user) await saveStrategyPack(access.user.id, strategy);
    return Response.json({ strategy, charts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!completed) await reservation.release();
    console.error("[/api/plan/strategy]", error);
    return Response.json({ error: "전략과 도식 배치를 설계하지 못했어요." }, { status: 500 });
  }
}
