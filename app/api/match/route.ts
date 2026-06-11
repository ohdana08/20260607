import { fetchOpenPrograms } from "@/lib/data/programs";
import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import type { Program, RankedPick, Recommendation } from "@/lib/match/types";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RANK_SYSTEM = `당신은 창업자·사업자에게 "정부지원사업"을 골라주는 전문가예요.
사용자는 **자기 사업(아이템)을 위해 지원을 '받고 싶은' 사람**입니다.
(지원 = 사업화 자금, 사업 공간, 멘토링, 판로·마케팅, 투자유치, R&D, 수출 지원 등)

⚠️ 매우 중요 — 다음은 추천에서 **제외**하세요(사용자가 원하는 지원이 아님):
- 사용자가 '수강생/교육생/참가자'로 들어가는 단순 교육·강좌·세미나·행사·네트워킹·공모전 모집
  (사용자는 지원을 받는 사업자이지, 교육을 듣는 학생이 아닙니다)
- 키워드만 겹치는 것. 예: 사용자가 "창업교육 사업"을 운영한다고 해서 "창업교육 수강생 모집"을 추천하면 절대 안 됩니다 — 그건 사용자가 받는 지원이 아니라 경쟁/무관한 모집입니다.
- 사용자의 업종·단계와 동떨어진 공고

고르는 기준:
- 사용자의 업종/아이템, 창업단계, 지역, 필요한 도움(자금·공간·판로 등)에 실제로 맞는지
- '사업을 키워주는' 지원(사업화·자금·시설·판로·투자·R&D 등)을 우선
- 지원대상(예비/초기/업력·지역·연령)이 사용자와 맞는지

[대화]에서 사용자 상황을 파악하고, [지원사업 목록] 중 **진짜로 도움이 되는 것만** 고르세요.
억지로 5개 채우지 말고, 정말 맞는 것만 1~5개. 하나도 없으면 빈 배열 [].

반드시 아래 형식의 JSON 배열만 출력하세요(설명·문장 없이 JSON만):
[
  {
    "id": "<지원사업 id>",
    "whatItIs": "<이 사업이 '실제로' 무엇을 해주는지 + 어떤 대상을 뽑는지 쉬운 말로 1~2문장>",
    "fitReason": "<왜 이 사람에게 맞는지 쉬운 일상어 한두 문장. 전문용어 금지>",
    "eligibility": "가능성 높음" | "확인 필요"
  }
]

규칙:
- id는 반드시 목록에 있는 id를 그대로 쓰세요.
- whatItIs: 어려운 정부 용어를 풀어서 쉽게. 무슨 '혜택'인지 콕 집으세요(예: "사업화 자금을 대주는", "사무공간을 빌려주는", "전문가 멘토링·컨설팅을 해주는", "판로·마케팅을 도와주는", "투자 연결을 해주는", "해외 진출을 돕는").
  ⚠️ "참여기업 모집" "수요기업 모집" 같은 말은 '무엇을 지원하는 프로그램에 참여할 기업을 뽑는다'는 뜻이니, 실제 혜택이 뭔지(돈인지/공간인지/교육·멘토링인지/판로인지)로 풀어서 설명하세요. 돈을 안 주고 프로그램만 제공하면 "자금 지원은 아니고 ○○ 프로그램을 제공" 처럼 솔직히 적으세요.
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
  const rl = await checkRateLimit(req, "match");
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

  const messages = (body as { messages?: ChatMsg[] })?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "대화 내용이 필요해요." }, { status: 400 });
  }

  // 이미 추천한 사업은 후보에서 제외 ("더 추천받기"용)
  const excludeIds = Array.isArray((body as { excludeIds?: unknown })?.excludeIds)
    ? ((body as { excludeIds: unknown[] }).excludeIds.filter((x) => typeof x === "string") as string[])
    : [];
  const excludeSet = new Set(excludeIds);

  const fetched = await fetchOpenPrograms();
  const usingSample = fetched.usingSample;
  // 이미 추천한 것 제외 + '교육생/수강생 모집' 같은 분명한 교육·참가자 모집은 아예 후보에서 제거
  const TRAINEE = /(교육생|수강생|참가자|참여자|수강|교육과정)\s*모집/;
  const programs = fetched.programs.filter(
    (p) => !excludeSet.has(p.id) && !TRAINEE.test(p.title),
  );
  if (programs.length === 0) {
    return Response.json({ recommendations: [], usingSample, exhausted: true });
  }

  const conversation = messages
    .map((m) => `${m.role === "user" ? "사용자" : "상담사"}: ${m.content}`)
    .join("\n");

  // "더 추천받기"(excludeIds 있음)일 땐 폭넓게 — 완벽하지 않아도 관련 있는 것까지.
  const moreNote =
    excludeIds.length > 0
      ? "\n\n[중요] 사용자가 '다른 사업을 더' 보고 싶어해요. 사용자 사업과 관련 있는 지원사업을 최대 5개 더 골라주세요. 완벽히 딱 맞지 않아도 도움될 만하면 포함하세요. 단, 교육생·수강생·참가자 모집/강좌/행사/세미나, 그리고 사용자 사업과 무관한 공고는 절대 포함하지 마세요."
      : "";
  const llm = getLlm(provider, "fast");
  let picks: RankedPick[] = [];
  try {
    picks = await llm.json<RankedPick[]>({
      system: RANK_SYSTEM,
      messages: [
        {
          role: "user",
          content: `[대화]\n${conversation}${moreNote}\n\n[지원사업 목록]\n${JSON.stringify(
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
        whatItIs: pick.whatItIs ?? "",
        fitReason: pick.fitReason,
        eligibility: pick.eligibility === "가능성 높음" ? "가능성 높음" : "확인 필요",
      } satisfies Recommendation;
    })
    .filter((r): r is Recommendation => r !== null)
    .slice(0, 5);

  return Response.json({ recommendations, usingSample });
}
