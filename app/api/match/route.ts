import { fetchOpenPrograms } from "@/lib/data/programs";
import { getLlm, isProviderConfigured, parseProvider } from "@/lib/llm/provider";
import type { ChatMsg } from "@/lib/llm/provider";
import type { Program, RankedPick, Recommendation } from "@/lib/match/types";
import { prefilterPrograms, type MatchProfile } from "@/lib/match/prefilter";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";
import { maintenanceGate } from "@/lib/config";

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
억지로 개수를 채우지 말고, 정말 맞는 것만 고르세요(몇 개를 고를지는 아래 [개수] 지시를 따르세요). 하나도 없으면 빈 배열 [].

반드시 아래 형식의 JSON 배열만 출력하세요(설명·문장 없이 JSON만):
[
  {
    "id": "<지원사업 id>",
    "whatItIs": "<이 지원사업을 왜(why) 하는지, 무엇을(what) 해주는지, 어떻게(how) 도와주는지를 초등학생도 알아듣게 풀어쓴 서술형 2~4문장. 전문용어 금지>",
    "fitReason": "<왜 이 사람에게 맞는지 쉬운 일상어 한두 문장. 전문용어 금지>",
    "eligibility": "가능성 높음" | "확인 필요"
  }
]

규칙:
- id는 반드시 목록에 있는 id를 그대로 쓰세요.
- whatItIs: **초등학생도 이해할 만큼 아주 쉬운 말로, 친구에게 설명하듯 서술형 2~4문장.** 순서는 자연스럽게 ① 왜(why) 이런 지원을 하는지(무엇을 위한 건지) → ② 무엇을(what) 해주는지 → ③ 어떻게(how) 도와주는지.
  ⚠️ 전문용어를 그대로 쓰지 말고 **반드시 쉬운 말로 풀어** 쓰세요. 예) "엑셀러레이팅/액셀러레이터" → "전문가들이 옆에서 도와줘서 사업이 빨리 자리 잡게 해주는 것", "인큐베이팅" → "사업 초기에 자리 잡을 수 있게 돌봐주는 것", "스케일업" → "사업을 더 크게 키우는 것", "R&D" → "새로운 기술·제품을 연구하고 만드는 것", "바우처" → "정해진 곳에 쓸 수 있는 지원금 쿠폰", "멘토링" → "전문가가 1:1로 조언해 주는 것", "판로" → "물건·서비스를 팔 곳".
  ⚠️ "참여기업 모집/수요기업 모집"은 '무엇을 해주는 프로그램에 들어갈 회사를 뽑는다'는 뜻이니, 실제로 뭘 해주는지(돈/공간/도움)로 풀어서. 돈을 안 주면 솔직하게 "돈을 직접 주는 건 아니고 ○○를 도와줘요"라고 적으세요.
- fitReason은 어려운 말 없이, 따뜻하고 쉽게.
- ⚠️ **솔직함이 가장 중요**: 사용자가 가장 원한 도움(예: "사업할 돈/개발 자금")과 이 사업이 주는 도움(예: "판로·판매" 또는 "공간" 또는 "멘토링")이 다르면, fitReason에 **반드시 솔직히** 짚어주세요. 예: "단, 이건 사업할 '돈'을 주는 건 아니고 '온라인 판매'를 도와주는 거예요. 자금이 급하시면 다른 걸 보는 게 나아요." 좋은 점만 부풀리지 말고, 안 맞을 수 있는 점을 미리 알려 사용자가 결제 전에 판단하게 하세요.
- 사용자의 '주된 필요'(자금/공간/판로/멘토링 등)와 지원 종류가 정확히 맞는 사업을 우선 추천하세요.
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

  const gate = maintenanceGate();
  if (gate) return gate;

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

  // 인테이크 버튼 폼에서 온 구조화 프로필(지역·단계·연령) — 규칙 기반 사전 필터에 사용
  const rawProfile = (body as { profile?: unknown })?.profile;
  const profile: MatchProfile | undefined =
    typeof rawProfile === "object" && rawProfile !== null
      ? {
          stage: typeof (rawProfile as MatchProfile).stage === "string" ? (rawProfile as MatchProfile).stage : undefined,
          region: typeof (rawProfile as MatchProfile).region === "string" ? (rawProfile as MatchProfile).region : undefined,
          ageGroup: typeof (rawProfile as MatchProfile).ageGroup === "string" ? (rawProfile as MatchProfile).ageGroup : undefined,
        }
      : undefined;

  const fetched = await fetchOpenPrograms();
  const usingSample = fetched.usingSample;
  // 이미 추천한 것 제외 + '교육생/수강생 모집' 같은 분명한 교육·참가자 모집은 아예 후보에서 제거
  const TRAINEE = /(교육생|수강생|참가자|참여자|수강|교육과정)\s*모집/;
  const base = fetched.programs.filter(
    (p) => !excludeSet.has(p.id) && !TRAINEE.test(p.title),
  );
  // LLM 투입 전 규칙 기반 사전 필터: 지역·연령·업력 + 마감 임박순 상위 45건 (점검표 문제 7)
  const programs = prefilterPrograms(base, profile);
  console.log(
    `[/api/match] 후보 ${programs.length}건 (필터 전 ${base.length}건, 지역=${profile?.region ?? "-"}, 단계=${profile?.stage ?? "-"}, 연령=${profile?.ageGroup ?? "-"})`,
  );
  if (programs.length === 0) {
    return Response.json({ recommendations: [], usingSample, exhausted: true });
  }

  const conversation = messages
    .map((m) => `${m.role === "user" ? "사용자" : "상담사"}: ${m.content}`)
    .join("\n");

  // 첫 추천은 집중도·비용 때문에 최대 2개. "더 추천받기"(excludeIds 있음)일 때만 폭넓게.
  const isMore = excludeIds.length > 0;
  const moreNote = isMore
    ? "\n\n[개수] 사용자가 '다른 사업을 더' 보고 싶어해요. 사용자 사업과 관련 있는 지원사업을 최대 5개 더 골라주세요. 완벽히 딱 맞지 않아도 도움될 만하면 포함하세요. 단, 교육생·수강생·참가자 모집/강좌/행사/세미나, 그리고 사용자 사업과 무관한 공고는 절대 포함하지 마세요."
    : "\n\n[개수] 가장 잘 맞는 1~2개만 골라주세요. 절대 3개 이상 고르지 마세요. (집중도·비용 때문)";
  const llm = getLlm(provider, "fast");
  const programsJson = JSON.stringify(programs.map(programForPrompt), null, 2);
  const rank = (note: string) =>
    llm.json<RankedPick[]>({
      system: RANK_SYSTEM,
      // [개수] 지시문을 공고 목록 '뒤'에 배치 — 재시도·더보기 때 목록 프리픽스가 캐시에 걸리게(점검표 문제 7)
      messages: [{ role: "user", content: `[대화]\n${conversation}\n\n[지원사업 목록]\n${programsJson}${note}` }],
      schema: {},
      maxTokens: 2600,
    });

  // 넓게 찾기 안내 — 엄격 패스가 0개일 때만 한 번 더 시도(대화를 다 했는데 빈손인 경험 방지).
  const BROAD_NOTE =
    "\n\n[개수] 딱 맞는 게 없더라도, 사용자 사업에 '그래도 도움이 될 만한' 지원사업을 1~2개만 골라주세요(완벽히 맞지 않아도 됨). 단, 교육생·수강생·참가자 모집/강좌/행사/세미나, 사용자 사업과 완전히 무관한 공고는 절대 포함하지 마세요. fitReason에는 '딱 맞지는 않지만 ○○ 때문에 도움될 수 있어요'처럼 솔직히 적으세요.";

  let picks: RankedPick[] = [];
  let relaxed = false;
  try {
    picks = await rank(moreNote);
    // 첫 추천인데 엄격 기준으로 0개면 → 기준을 낮춰 한 번 더 (그래도 도움될 만한 것)
    if (picks.length === 0 && !isMore) {
      relaxed = true;
      picks = await rank(BROAD_NOTE);
    }
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
    .slice(0, isMore ? 5 : 2);

  return Response.json({ recommendations, usingSample, relaxed });
}
