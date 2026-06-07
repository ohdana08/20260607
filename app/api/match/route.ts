import { fetchOpenPrograms } from "@/lib/data/kstartup";
import { getLlm } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import type { Program, RankedPick, Recommendation } from "@/lib/match/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANK_SYSTEM = `당신은 예비창업자에게 맞는 정부지원사업을 골라주는 전문가예요.
아래 [대화]에서 그 사람의 상황(아이템/업종, 지역, 창업단계, 나이대, 강점)을 파악하고,
[지원사업 목록] 중에서 가장 잘 맞는 것을 최대 5개 고르세요.

반드시 아래 형식의 JSON 배열만 출력하세요(설명·문장 없이 JSON만):
[
  {
    "id": "<지원사업 id>",
    "fitReason": "<왜 이 사람에게 맞는지 쉬운 일상어 한두 문장. 전문용어 금지>",
    "eligibility": "가능성 높음" | "확인 필요"
  }
]

규칙:
- id는 반드시 목록에 있는 id를 그대로 쓰세요.
- fitReason은 어려운 말 없이, 따뜻하고 쉽게.
- 조건(나이·창업단계 등)이 애매하면 "확인 필요", 잘 맞으면 "가능성 높음".
- 맞는 게 없으면 빈 배열 [] 을 출력하세요.`;

function programForPrompt(p: Program) {
  return {
    id: p.id,
    제목: p.title,
    개요: p.summary,
    지원대상: p.target,
    지원분야: p.supportField,
    지역: p.region,
  };
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "AI 키가 아직 설정되지 않았어요." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const messages = (body as { messages?: ChatMsg[] })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "대화 내용이 필요해요." }, { status: 400 });
  }

  const { programs, usingSample } = await fetchOpenPrograms();
  const conversation = messages
    .map((m) => `${m.role === "user" ? "사용자" : "상담사"}: ${m.content}`)
    .join("\n");

  const llm = getLlm("claude");
  let picks: RankedPick[] = [];
  try {
    picks = await llm.json<RankedPick[]>({
      system: RANK_SYSTEM,
      messages: [
        {
          role: "user",
          content: `[대화]\n${conversation}\n\n[지원사업 목록]\n${JSON.stringify(
            programs.map(programForPrompt),
            null,
            2,
          )}`,
        },
      ],
      schema: {},
      maxTokens: 1500,
    });
  } catch (err) {
    console.error("[/api/match] ranking failed", err);
    return Response.json({ error: "추천을 만드는 중 문제가 생겼어요. 다시 시도해 주세요." }, { status: 500 });
  }

  const byId = new Map(programs.map((p) => [p.id, p]));
  const recommendations: Recommendation[] = picks
    .map((pick) => {
      const program = byId.get(pick.id);
      if (!program) return null;
      return {
        program,
        fitReason: pick.fitReason,
        eligibility: pick.eligibility === "가능성 높음" ? "가능성 높음" : "확인 필요",
      } satisfies Recommendation;
    })
    .filter((r): r is Recommendation => r !== null)
    .slice(0, 5);

  return Response.json({ recommendations, usingSample });
}
