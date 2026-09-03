import { paidGoogleLoginGate } from "@/lib/auth/googleUser";
import { maintenanceGate } from "@/lib/config";
import { researchJson } from "@/lib/llm/research";
import type { ChatMsg } from "@/lib/llm/provider";
import { aiBudgetExceededResponse, reservePaidAiCall } from "@/lib/plan/aiBudget";
import { decideDraftApplication, draftApplicationError } from "@/lib/plan/applicationGuard";
import { saveEvidencePack } from "@/lib/plan/artifacts";
import { checkDraftAccess, markCreditUsed, paymentRequiredResponse } from "@/lib/plan/paidAccess";
import { normalizeEvidencePack, type EvidencePack } from "@/lib/plan/strategy";
import { checkRateLimit, tooManyRequests } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ProgramInput {
  id?: string;
  title?: string;
  summary?: string;
  target?: string;
  supportField?: string;
  applicationKind?: "business-plan" | "simple-application" | "reservation" | "unknown";
  requiresBusinessPlan?: boolean | null;
  applicationKindReason?: string;
}

const SYSTEM = `당신은 정부지원사업 사업계획서의 근거 조사 담당자입니다. 사용자의 초안을 대신 꾸미지 말고, 이후 작성과 도식에 쓸 수 있는 증거팩만 JSON으로 만드세요.

[보안·검색 원칙]
- 검색어에는 사용자의 이름, 연락처, 미공개 매출·고객정보, 첨부문서의 개인정보를 절대 넣지 마세요.
- 시장·산업·제품 유형·공개 경쟁서비스처럼 공개 조사에 필요한 일반 명사만 검색하세요.
- 최신성에 민감한 사실은 현재 페이지와 기준일을 확인하세요.
- 정부·공공기관·통계 원문과 기업 공식 사이트를 우선하고, 핵심 주장에는 가능하면 독립 출처를 대조하세요.
- 검색 결과에서 실제로 확인하지 못한 URL, 수치, 기능, 가격, 계약, 성과를 만들지 마세요.
- 이용약관·robots·로그인·유료벽을 우회하지 마세요. 공개적으로 열리는 페이지만 사용하세요.

[경쟁 조사 원칙]
- 대화에서 확인되는 고객, 해결 문제, 구매대안이 겹치는 후보를 최대 5곳까지만 찾으세요.
- 그중 가장 가까운 2곳만 선택해 공식 사이트의 공개 사실을 깊게 정리하세요.
- 후보가 부족하거나 사실 근거가 약하면 2곳을 억지로 채우지 말고 gaps에 남기세요.
- 경쟁우위는 선언하지 마세요. 우리 사업과 비교 가능한 사실만 정리하세요.

[도식 근거 원칙]
- TAM·SAM·SOM은 기준연도, 모집단, 단가·비율 또는 계산식이 확인될 때만 사용 가능하다고 판단하세요.
- 경쟁비교는 양쪽을 같은 기준으로 확인한 사실만 사용 가능합니다.
- 운영 프로세스·로드맵·수익구조는 사용자가 직접 밝힌 실행계획을 user 근거로 보존할 수 있습니다.
- 근거 충돌과 핵심 공백을 숨기지 말고 conflicts와 gaps에 명확히 남기세요.

설명 없이 아래 JSON 하나만 출력하세요.
{
  "checkedAt": "ISO 날짜",
  "sources": [
    {
      "id": "source-1",
      "title": "페이지 제목",
      "url": "https://... 또는 사용자 첨부면 빈 문자열",
      "publisher": "발행기관",
      "checkedAt": "ISO 날짜",
      "pageAge": "기준연도/게시일",
      "accessNote": "공개 페이지/로그인 필요/유료벽 등 확인한 이용 조건",
      "sourceType": "official|company|independent|user",
      "claim": "이 자료가 뒷받침하는 정확한 주장",
      "excerpt": "확인한 핵심 내용의 짧은 요약",
      "verified": true
    }
  ],
  "competitorCandidates": ["최대 5곳"],
  "competitors": [
    {
      "name": "선택 경쟁사",
      "url": "공식 사이트",
      "selectionReason": "고객·문제·구매대안이 겹치는 이유",
      "overlapScore": 0,
      "facts": [{"criterion":"가격/고객/제공방식 등", "value":"확인된 사실", "evidenceIds":["source-1"]}]
    }
  ],
  "conflicts": ["출처끼리 또는 사용자 주장과 충돌하는 사실"],
  "gaps": [
    {
      "id":"gap-1",
      "label":"부족한 핵심 데이터",
      "whyCritical":"제출·주장·도식에 중요한 이유",
      "suggestedAction":"사용자가 입력하거나 첨부할 자료",
      "affectedDiagrams":["tamSamSom|comparison|process|journey|revenue|roadmap"]
    }
  ],
  "summary":"검증 결과 요약"
}`;

function compactResearchMessages(messages: ChatMsg[]): ChatMsg[] {
  const eligible = messages.filter((message) => message.role === "user" || message.role === "assistant");
  const selected = eligible.length > 31 ? [eligible[0], ...eligible.slice(-30)] : eligible.slice();
  const firstContent = selected[0]?.content ?? "";
  const firstAllowance = Math.min(10_000, firstContent.length);
  let remaining = 60_000 - firstAllowance;
  let latestAttachment = -1;
  for (let index = selected.length - 1; index >= 0; index--) {
    if (selected[index].images?.length || selected[index].files?.length) {
      latestAttachment = index;
      break;
    }
  }
  const output: ChatMsg[] = selected.map((message) => ({ ...message, images: undefined, files: undefined }));
  if (output[0]) output[0].content = firstContent.slice(0, firstAllowance);
  for (let index = output.length - 1; index >= 1; index--) {
    const original = selected[index];
    const allowance = Math.min(remaining, original.content.length);
    output[index].content = original.content.slice(-allowance);
    remaining -= allowance;
    if (remaining <= 0) remaining = 0;
  }
  if (latestAttachment >= 0) {
    output[latestAttachment].images = selected[latestAttachment].images?.slice(0, 1);
    output[latestAttachment].files = selected[latestAttachment].files?.slice(0, 1);
  }
  return output.filter((message) => message.content || message.images?.length || message.files?.length);
}

function userEvidenceFallback(messages: ChatMsg[], program?: ProgramInput): EvidencePack {
  const userStatements = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-12)
    .join("\n")
    .slice(-12_000);
  const programContext = [program?.title, program?.summary, program?.target, program?.supportField]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" / ");
  const excerpt = userStatements || programContext || "사용자가 제공한 사업 정보";

  return normalizeEvidencePack({
    checkedAt: new Date().toISOString(),
    sources: [
      {
        id: "user-conversation",
        title: "신청자가 대화로 제공한 사업 현황·실행계획",
        url: "",
        publisher: "신청자",
        checkedAt: new Date().toISOString(),
        accessNote: "사용자 대화에서 받은 주장으로, 원문 증빙은 확인하지 않음",
        sourceType: "user",
        claim: "사업 현황과 향후 실행계획은 신청자가 직접 제공했다.",
        excerpt,
        verified: false,
      },
    ],
    competitorCandidates: [],
    competitors: [],
    conflicts: [],
    gaps: [
      {
        id: "gap-public-research",
        label: "공식 시장·경쟁 근거 재확인 필요",
        whyCritical:
          "공개검색을 완료하지 못해 현재 초안은 신청자가 제공한 사실과 계획만으로 구성된다.",
        suggestedAction:
          "최종 제출 전에 시장 모집단·경쟁사 기능·가격을 공공기관 원문과 기업 공식 페이지에서 다시 확인한다.",
        affectedDiagrams: ["tamSamSom", "comparison"],
      },
    ],
    summary:
      "공개검색이 일시적으로 실패해 사용자가 직접 제공한 사실·가설·목표만 근거로 보존한 대체 근거팩이다. 공식 시장수치와 경쟁비교는 확인된 사실로 취급하지 않는다.",
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }
  const { messages, code, program, documentConfirmed } = (body ?? {}) as {
    messages?: ChatMsg[];
    code?: string;
    program?: ProgramInput;
    documentConfirmed?: boolean;
  };

  const gate = maintenanceGate();
  if (gate) return gate;
  const loginGate = await paidGoogleLoginGate(req, code);
  if (loginGate) return loginGate;
  const rl = await checkRateLimit(req, "planReview");
  if (!rl.ok) return tooManyRequests(rl.retryAfter);
  const access = await checkDraftAccess(req, code, program?.id);
  if (!access.ok) return paymentRequiredResponse(access.reason);
  const application = decideDraftApplication(program, documentConfirmed === true);
  if (!application.ok) return draftApplicationError(application);
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "조사할 사업 정보가 필요해요." }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "경쟁정보 출처 확인용 AI 키가 설정되지 않았어요." }, { status: 503 });
  }
  if (access.user && program?.id) await markCreditUsed(access.user.id, program.id);

  const reservation = await reservePaidAiCall({
    userId: access.user?.id,
    bypassBudget: access.admin,
    stage: "evidence",
    provider: "claude",
    tier: "fast",
    estimatedInputTokens: 100_000,
    maxOutputTokens: 4_000,
    maxWebSearches: 4,
  });
  if (!reservation.ok) return aiBudgetExceededResponse(reservation);

  const prompt = `[지원사업]
- 사업명: ${program?.title || "확인되지 않음"}
- 공고 요약: ${program?.summary || "확인되지 않음"}
- 지원대상: ${program?.target || "확인되지 않음"}
- 지원분야: ${program?.supportField || "확인되지 않음"}

[조사 요청]
첨부자료와 대화에서 사업의 고객·문제·제품·지역을 먼저 파악하세요. 공개검색은 꼭 필요한 시장 근거와 경쟁 후보 비교에만 사용하고, 검색 최대 4회 안에서 가까운 경쟁사 2곳의 공식 사실을 우선 검증하세요. 사용자가 직접 제공한 조사·수치·계획은 sourceType=user로 분리하고, 외부 검증 사실처럼 표시하지 마세요.`;

  let completed = false;
  try {
    const result = await researchJson<EvidencePack>({
      system: SYSTEM,
      messages: [
        ...compactResearchMessages(messages),
        { role: "user", content: prompt },
      ],
      maxTokens: 4_000,
      maxSearches: 4,
      onUsage: async (usage) => {
        await reservation.complete(usage);
        completed = true;
      },
    });
    const evidence = normalizeEvidencePack(result.data, result.searchedSources);
    if (access.user) await saveEvidencePack(access.user.id, evidence, access.admin);
    return Response.json({ evidence }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!completed) await reservation.release();
    console.error("[/api/plan/evidence]", error);
    const evidence = userEvidenceFallback(messages, program);
    if (access.user) {
      try {
        await saveEvidencePack(access.user.id, evidence, access.admin);
      } catch (storageError) {
        console.error("[/api/plan/evidence:fallback-save]", storageError);
      }
    }
    return Response.json(
      {
        evidence,
        degraded: true,
        warning:
          "공식 시장·경쟁 검색을 완료하지 못해, 직접 제공한 사실과 계획만으로 초안을 이어갑니다. 해당 근거는 최종 제출 전에 재확인해 주세요.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
