import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

const { classifyApplicationKind, matchByButtons } = await import(
  "../lib/match/buttonFilter.ts"
);
const { isStillOpen, kstToday } = await import("../lib/data/openFilter.ts");
const { SAMPLE_PROGRAMS } = await import("../lib/data/sample.ts");
const { firstTrustedProgramUrl } = await import("../lib/data/trustedProgramUrl.ts");
const { buildPlanDocxBuffer } = await import("../lib/plan/docx.ts");
const { normalizeEvidencePack, normalizeStrategyPack } = await import("../lib/plan/strategy.ts");
const { PLAN_MAX_REVISIONS, PLAN_OUTCOME_NOTICE, PLAN_REVISION_NOTICE } = await import(
  "../lib/plan/productPolicy.ts"
);
const {
  normalizePlanReview,
  normalizeReadinessAssessment,
  READINESS_DIMENSIONS,
  reviewReportSections,
} = await import("../lib/plan/reviewer.ts");
const { normalizeBojoItem, normalizeDataGoKrServiceKey } = await import("../lib/data/bojo.ts");
const { parseEgbizPage, egbizFinalPage } = await import("../lib/data/egbiz.ts");
const { dedupePrograms } = await import("../lib/data/dedupePrograms.ts");
const { REGIONAL_SOURCE_POLICIES, regionalPeriodEnd } = await import("../lib/data/regional.ts");
const { buildPublicEvidencePrompt, rankPublicEvidenceItems } = await import(
  "../lib/data/publicEvidence.ts"
);
const { isLocalReviewMatchRequest } = await import("../lib/auth/localReview.ts");
const { paidGoogleLoginGate } = await import("../lib/auth/googleUser.ts");
const { LOCAL_REVIEW_EVIDENCE_ROWS } = await import(
  "../lib/diagnosis/localReviewEvidence.ts"
);
const {
  PLAIN_LANGUAGE_PROMPT,
  plainCondition,
  plainEligibilityLabel,
  plainEvidenceItem,
  plainSupportOption,
  plainYearOption,
} = await import("../lib/plain-language.ts");

function program(title, overrides = {}) {
  return {
    id: title,
    title,
    summary: "",
    target: "중소기업",
    supportField: "",
    region: "전국",
    applyEnd: "2099-12-31",
    url: "https://www.k-startup.go.kr",
    formUrl: null,
    source: "sample",
    ...overrides,
  };
}

const businessPlan = classifyApplicationKind(
  program("초기창업패키지", { summary: "사업계획서 제출 및 발표평가" }),
);
assert.equal(businessPlan.requiresBusinessPlan, true);
assert.equal(businessPlan.applicationKind, "business-plan");

const sampleEarly = SAMPLE_PROGRAMS.find((item) => item.id === "sample-early");
assert.ok(sampleEarly, "로컬 검사에서 초기창업패키지 샘플을 찾을 수 있어야 함");
assert.equal(
  classifyApplicationKind(sampleEarly).requiresBusinessPlan,
  true,
  "초기창업패키지 샘플은 무료 추천 뒤 사업계획서 단계로 이어져야 함",
);

const reservation = classifyApplicationKind(program("공동장비 이용 예약 모집"));
assert.equal(reservation.requiresBusinessPlan, false);
assert.equal(reservation.applicationKind, "reservation");

const simple = classifyApplicationKind(program("AI 교육생 모집"));
assert.equal(simple.requiresBusinessPlan, false);
assert.equal(simple.applicationKind, "simple-application");

const incubator = classifyApplicationKind(program("창업보육센터 입주기업 모집"));
assert.equal(incubator.requiresBusinessPlan, null, "입주기업 모집을 간단 신청으로 오판하면 안 됨");

const recommendations = matchByButtons(
  [
    program("사업계획서 제출형 사업화 지원", { supportField: "사업화" }),
    program("AI 교육생 모집", { supportField: "교육" }),
  ],
  {
    years: "창업초기(3년 이내)",
    region: "전국(중앙부처)",
    supportType: "사업화",
  },
).recommendations;
assert.equal(
  recommendations.find((item) => item.program.title.includes("사업계획서"))?.requiresBusinessPlan,
  true,
);
assert.equal(
  recommendations.find((item) => item.program.title.includes("교육생"))?.requiresBusinessPlan,
  false,
);

assert.equal(isStillOpen("2000-01-01"), false);
assert.equal(isStillOpen(null), true);
assert.equal(isStillOpen(kstToday()), true);

assert.equal(
  firstTrustedProgramUrl([{ role: "user", content: "https://www.k-startup.go.kr/web/test" }]),
  "https://www.k-startup.go.kr/web/test",
);
assert.equal(
  firstTrustedProgramUrl([{ role: "user", content: "https://evil.example/k-startup.go.kr" }]),
  null,
);
assert.equal(
  firstTrustedProgramUrl([{ role: "user", content: "https://www.bojo.go.kr/example" }]),
  "https://www.bojo.go.kr/example",
);

const bojoBusiness = normalizeBojoItem({
  DTLBZ_ID: "detail-1",
  DDTLBZ_ID: "sub-1",
  PBLANC_NM: "2026년 지역 소상공인 판로지원 공고",
  DTLBZ_BSNS_PURPS_DC: "지역 상권의 온라인 판로 개척을 지원",
  SPORT_TRGET_CN: "사업장을 운영 중인 소상공인·개인사업자",
  RCEPT_END_DE: "20261231",
  CTPRVN_NM: "부산광역시",
  PBLANC_POPUP_URL: "http://www.bojo.go.kr/example",
});
assert.ok(bojoBusiness, "기업·사업자 대상 e나라도움 공고는 정규화되어야 함");
assert.equal(bojoBusiness?.source, "bojo");
assert.equal(bojoBusiness?.applyEnd, "2026-12-31");
assert.equal(bojoBusiness?.url, "https://www.bojo.go.kr/example");
assert.equal(
  normalizeDataGoKrServiceKey("abc%2Bdef%2Fghi%3D"),
  "abc+def/ghi=",
  "공공데이터포털 Encoding 키는 URL에 한 번만 인코딩되도록 정규화해야 함",
);
const bojoCamelCase = normalizeBojoItem({
  pblancNm: "2026년 AI 소상공인 지원",
  sportTrgetCn: "소상공인 및 개인사업자",
  rceptEndDe: "20261231",
  dtlbzBsnsPurpsDc: "AI 전환과 판로 개척 지원",
  pblancPopupUrl: "https://www.bojo.go.kr/example-camel",
});
assert.equal(bojoCamelCase?.title, "2026년 AI 소상공인 지원");
assert.equal(bojoCamelCase?.applyEnd, "2026-12-31");
const bojoCdata = normalizeBojoItem({
  PBLANC_NM: "<![CDATA[2026년 콘텐츠 기업 사업화 지원]]>",
  SPORT_TRGET_CN: "<![CDATA[콘텐츠 분야 중소기업·개인사업자]]>",
  RCEPT_END_DE: "<![CDATA[20261231]]>",
  DDTLBZ_BSNS_PURPS_DC: "<![CDATA[콘텐츠 기업의 사업화와 판로 개척 지원]]>",
});
assert.equal(bojoCdata?.title, "2026년 콘텐츠 기업 사업화 지원");
assert.equal(bojoCdata?.applyEnd, "2026-12-31");
assert.equal(
  normalizeBojoItem({
    PBLANC_NM: "공공기관 전용 연구사업",
    SPORT_TRGET_CN: "국가·지방자치단체·대학·연구기관",
    RCEPT_END_DE: "20261231",
  }),
  null,
  "명백한 기관전용 공고는 기업 추천 풀에 넣지 않아야 함",
);

const egbizHtml = `
  <div>경기도 지원사업 <span class="num">21</span> 건</div>
  <table><tbody>
    <tr>
      <td>1</td>
      <td><a onclick="javascript:fn_supportPrjDtl('PD-1');">[경기] AI 스타트업 사업화 지원 참여기업 모집</a></td>
      <td>경기도경제과학진흥원</td>
      <td>2026-08-01 - 2026-09-30</td>
      <td><span class="state">접수중</span></td>
      <td>10</td>
    </tr>
    <tr>
      <td>2</td>
      <td><a onclick="javascript:fn_supportPrjDtl('PD-2');">글로벌 전시 운영 대행사 모집</a></td>
      <td>경기도경제과학진흥원</td>
      <td>2026-08-01 - 2026-09-30</td>
      <td><span class="state">접수중</span></td>
      <td>3</td>
    </tr>
  </tbody></table>
  <a onclick="fn_opMovePage1(3)">3</a>
  <div>타기관 지원사업 <span class="num">100</span> 건</div>
  <table><tr><td>1</td><td><a onclick="javascript:fn_supportPrjDtl('EXT-1');">기업마당 복제 공고</a></td><td>기업마당</td><td>2026-08-01 - 2026-09-30</td><td>접수중</td></tr></table>
`;
const egbizPrograms = parseEgbizPage(egbizHtml);
assert.equal(egbizPrograms.length, 1, "경기도 자체 공고만 남기고 대행사·타기관 복제 공고는 제외해야 함");
assert.equal(egbizPrograms[0].source, "egbiz");
assert.equal(egbizPrograms[0].region, "경기");
assert.equal(egbizPrograms[0].applyEnd, "2026-09-30");
assert.equal(egbizFinalPage(egbizHtml), 3);
assert.equal(regionalPeriodEnd("26-08-20~26-09-01"), "2026-09-01");
assert.equal(regionalPeriodEnd("예산 소진시까지"), null);

const duplicateRegional = program("[경기] AI 스타트업 사업화 지원 참여기업 모집", {
  id: "egbiz:PD-1",
  source: "egbiz",
  region: "경기",
  applyEnd: "2026-09-30",
  url: "https://www.egbiz.or.kr/sp/supportPrjOutsideDtl.do?bizCyclId=PD-1",
});
const duplicateCentral = program("AI 스타트업 사업화 지원 참여기업 모집", {
  id: "bizinfo:1",
  source: "bizinfo",
  region: "경기",
  applyEnd: "2026-09-30",
});
assert.deepEqual(dedupePrograms([duplicateCentral, duplicateRegional]).map((item) => item.id), [
  "egbiz:PD-1",
]);
assert.equal(REGIONAL_SOURCE_POLICIES.find((item) => item.id === "egbiz")?.status, "active");
assert.equal(
  REGIONAL_SOURCE_POLICIES.find((item) => item.id === "busanstartup")?.status,
  "permission-required",
);
assert.equal(REGIONAL_SOURCE_POLICIES.find((item) => item.id === "bizok")?.status, "permission-required");
const aiEvidence = rankPublicEvidenceItems("AI 공공데이터 기반 관광 서비스", "step6", 3);
assert.ok(aiEvidence.some((item) => item.id === "public-data-portal"));
assert.ok(aiEvidence.some((item) => item.id === "kogl-ai"));
const evidencePrompt = buildPublicEvidencePrompt("AI 공공데이터");
assert.match(evidencePrompt, /공식 근거 후보/);
assert.match(evidencePrompt, /확인할 공식 출처 후보/);
assert.match(evidencePrompt, /개방 예정/);

assert.equal(plainYearOption("예비창업").label, "아직 사업자등록 전이에요");
assert.match(plainSupportOption("R&D").label, /새 기술이나 제품/);
assert.equal(plainEligibilityLabel("신청 가능"), "지금 정보로는 신청해볼 만해요");
assert.equal(plainEligibilityLabel("확인 필요"), "한 가지만 더 확인해요");
assert.equal(plainCondition("✓ 업력 3년 이내 충족"), "✓ 사업을 시작한 시기가 맞아요");
assert.equal(plainEvidenceItem("유료 고객 확보"), "실제로 돈을 낸 고객이 있어요");
assert.match(PLAIN_LANGUAGE_PROMPT, /대표님이 직접 내야 하는 돈/);

const readyDimensions = READINESS_DIMENSIONS.map((item) => ({
  key: item.key,
  status: "strong",
  evidenceLevel: "verified",
  finding: `${item.label} 근거 확인`,
  nextQuestion: "",
}));
const readyAssessment = normalizeReadinessAssessment({
  ready: true,
  score: 88,
  verdict: "핵심 답변과 근거가 모였습니다.",
  dimensions: readyDimensions,
  criticalGaps: [],
  nextQuestions: [],
  evaluationAlignment: ["문제인식 → 고객 인터뷰"],
});
assert.equal(readyAssessment.ready, true, "독립 준비도 심사는 8개 필수 축이 모두 있어야 통과해야 함");
const missingAssessment = normalizeReadinessAssessment({
  ready: true,
  score: 95,
  dimensions: readyDimensions.filter((item) => item.key !== "business_model"),
  criticalGaps: [],
});
assert.equal(missingAssessment.ready, false, "AI가 높은 점수를 줘도 필수 축이 빠지면 초안 작성을 막아야 함");
assert.ok(missingAssessment.score < 80);
const claimsOnlyAssessment = normalizeReadinessAssessment({
  ready: true,
  score: 92,
  dimensions: readyDimensions.map((item) => ({ ...item, evidenceLevel: "stated" })),
  criticalGaps: [],
});
assert.equal(claimsOnlyAssessment.ready, false, "구체적인 주장만 있고 확인 가능한 근거가 없으면 작성을 보류해야 함");
assert.match(claimsOnlyAssessment.criticalGaps.join(" "), /최소 2개/);

const blockedReview = normalizePlanReview(
  {
    score: 96,
    verdict: "좋은 초안",
    scores: [],
    issues: [],
    evidenceChecklist: [],
  },
  [{ heading: "성장 전략", content: "[보완 필요: 실제 예산을 입력해 주세요]\n[증빙 필요: 매출 자료]" }],
);
assert.equal(blockedReview.status, "blocked", "보완 표시가 남은 초안은 높은 AI 점수와 무관하게 제출 보류여야 함");
assert.equal(blockedReview.submissionReady, false);
assert.ok(blockedReview.score <= 69);
assert.ok(reviewReportSections(blockedReview).some((section) => section.heading.includes("심사위원 관점")));

const localReviewEnv = { NODE_ENV: "development", LOCAL_REVIEW_MODE: "on" };

const searchedEvidence = [
  {
    id: "web-1",
    title: "공식 통계",
    url: "https://example.com/stat",
    publisher: "공공기관",
    checkedAt: "2026-09-01T00:00:00.000Z",
    sourceType: "official",
    claim: "시장 모집단",
    excerpt: "확인 내용",
    verified: true,
  },
  {
    id: "web-2",
    title: "경쟁사 공식",
    url: "https://example.com/competitor",
    publisher: "경쟁사",
    checkedAt: "2026-09-01T00:00:00.000Z",
    sourceType: "company",
    claim: "공개 가격",
    excerpt: "확인 내용",
    verified: true,
  },
];
const evidencePack = normalizeEvidencePack(
  {
    sources: searchedEvidence,
    competitorCandidates: ["가", "나", "다", "라", "마", "바"],
    competitors: [
      {
        name: "가",
        url: "https://example.com/competitor",
        selectionReason: "고객과 구매대안이 겹침",
        overlapScore: 90,
        facts: [{ criterion: "가격", value: "월 구독", evidenceIds: ["web-2"] }],
      },
      {
        name: "나",
        url: "https://example.com/competitor",
        selectionReason: "같은 문제를 해결",
        overlapScore: 80,
        facts: [{ criterion: "가격", value: "건별", evidenceIds: ["web-2"] }],
      },
      {
        name: "다",
        url: "https://example.com/competitor",
        selectionReason: "후보",
        overlapScore: 70,
        facts: [{ criterion: "가격", value: "무료", evidenceIds: ["web-2"] }],
      },
    ],
  },
  searchedEvidence,
);
assert.equal(evidencePack.competitorCandidates.length, 5, "경쟁 후보는 최대 5곳이어야 함");
assert.equal(evidencePack.competitors.length, 2, "깊은 경쟁분석은 가까운 2곳만 저장해야 함");
const groundedStrategy = normalizeStrategyPack(
  {
    advantageStatus: "verified",
    claims: [{ claim: "시장 주장", status: "verified", evidenceIds: ["web-1"] }],
    diagrams: {
      tamSamSom: { tam: "10억", sam: "5억", som: "1억", evidenceIds: ["web-1"] },
      journey: { stages: ["인지", "상담", "구매"], evidenceIds: ["missing-source"] },
    },
  },
  evidencePack,
);
assert.ok(groundedStrategy.diagrams.tamSamSom, "검증 id가 있는 시장 도식은 선택할 수 있어야 함");
assert.equal(groundedStrategy.diagrams.journey, undefined, "근거 없는 도식은 서버 정규화에서 제거해야 함");
const unverifiedEvidence = normalizeEvidencePack({
  sources: [
    {
      id: "invented-source",
      title: "검색에서 확인하지 않은 페이지",
      url: "https://example.com/invented",
      publisher: "미확인",
      sourceType: "independent",
      claim: "근거 없는 주장",
      excerpt: "근거 없는 요약",
      verified: true,
    },
  ],
});
const rejectedDiagramStrategy = normalizeStrategyPack(
  {
    diagrams: {
      tamSamSom: { tam: "10억", sam: "5억", som: "1억", evidenceIds: ["invented-source"] },
    },
  },
  unverifiedEvidence,
);
assert.equal(
  rejectedDiagramStrategy.diagrams.tamSamSom,
  undefined,
  "실제 검색 결과나 사용자 자료로 검증되지 않은 출처 id는 도식 근거가 될 수 없음",
);
assert.equal(PLAN_MAX_REVISIONS, 3);
assert.match(PLAN_OUTCOME_NOTICE, /선정 결과를 보장하지 않습니다/);
assert.match(PLAN_REVISION_NOTICE, /동일 공고·동일 사업아이템·동일 양식/);
assert.equal(
  isLocalReviewMatchRequest(new Request("http://localhost:3000/api/match"), localReviewEnv),
  true,
);
assert.equal(
  isLocalReviewMatchRequest(new Request("https://example.com/api/match"), localReviewEnv),
  false,
  "로컬 검사 인증 예외는 localhost 밖에서 절대 열리면 안 됨",
);
assert.equal(
  isLocalReviewMatchRequest(new Request("http://localhost:3000/api/chat"), localReviewEnv),
  false,
  "로컬 검사 인증 예외는 읽기 전용 추천 API 외에는 열리면 안 됨",
);
assert.equal(
  isLocalReviewMatchRequest(new Request("http://localhost:3000/api/match"), {
    NODE_ENV: "production",
    LOCAL_REVIEW_MODE: "on",
  }),
  false,
  "운영 빌드에서는 환경변수를 잘못 넣어도 인증 예외가 열리면 안 됨",
);
const previousMasterCodes = process.env.MASTER_CODES;
process.env.MASTER_CODES = "REVIEW-ONLY-MASTER";
assert.equal(
  await paidGoogleLoginGate(
    new Request("https://example.com/api/plan/readiness"),
    "REVIEW-ONLY-MASTER",
  ),
  null,
  "등록된 운영자 마스터 코드는 Google 세션 없이 유료 심사 흐름을 점검할 수 있어야 함",
);
if (previousMasterCodes === undefined) delete process.env.MASTER_CODES;
else process.env.MASTER_CODES = previousMasterCodes;
assert.ok(LOCAL_REVIEW_EVIDENCE_ROWS.length >= 5);
assert.ok(LOCAL_REVIEW_EVIDENCE_ROWS.every((row) => typeof row.item === "string"));

const docx = await buildPlanDocxBuffer(
  "검증용 사업계획서",
  [
    {
      heading: "1. 고객과 수익모델",
      content:
        "핵심 고객: 마감이 임박한 초기창업자\n결제자: 대표자 본인\n가격: 1건 29,900원\n\n[보완 필요: 고객 인터뷰 수를 입력해 주세요]\n[증빙 필요: 결제 내역 캡처]",
    },
  ],
  [],
  [{ id: "web-1", title: "공식 통계", publisher: "공공기관", checkedAt: "2026-09-01", url: "https://example.com/stat", claim: "시장 모집단" }],
);
const zip = await JSZip.loadAsync(docx);
const documentXml = await zip.file("word/document.xml")?.async("string");
assert.ok(documentXml, "DOCX 본문 XML이 있어야 함");
assert.match(documentXml, /제출 전 검토표/);
assert.match(documentXml, /검증용 사업계획서/);
assert.match(documentXml, /근거 출처/);
assert.ok((documentXml.match(/<w:tbl>/g) ?? []).length >= 2, "검토표와 내용표가 있어야 함");

const landingSource = readFileSync(new URL("../app/landing/LandingClient.tsx", import.meta.url), "utf8");
const wizardSource = readFileSync(new URL("../components/chat/DiagnosisWizard.tsx", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../components/chat/Chat.tsx", import.meta.url), "utf8");
const evidenceRouteSource = readFileSync(new URL("../app/api/plan/evidence/route.ts", import.meta.url), "utf8");
const strategyRouteSource = readFileSync(new URL("../app/api/plan/strategy/route.ts", import.meta.url), "utf8");
const batchRouteSource = readFileSync(new URL("../app/api/plan/draft-batch/route.ts", import.meta.url), "utf8");
const auditRouteSource = readFileSync(new URL("../app/api/plan/audit/route.ts", import.meta.url), "utf8");
const reviseRouteSource = readFileSync(new URL("../app/api/plan/revise/route.ts", import.meta.url), "utf8");
const docxRouteSource = readFileSync(new URL("../app/api/plan/docx/route.ts", import.meta.url), "utf8");
const evidencePanelSource = readFileSync(
  new URL("../components/chat/PublicEvidencePanel.tsx", import.meta.url),
  "utf8",
);
const collectorWorkflow = readFileSync(
  new URL("../.github/workflows/collect-programs.yml", import.meta.url),
  "utf8",
);
const collectorRegistry = readFileSync(new URL("../lib/data/collect.ts", import.meta.url), "utf8");
const programStore = readFileSync(
  new URL("../lib/supabase/programs.ts", import.meta.url),
  "utf8",
);

assert.match(landingSource, /사업 얘기부터 하세요/);
assert.match(landingSource, /3분 만에 받을 수 있는 지원 보기/);
assert.match(landingSource, /빠진 사실과 자료/);
assert.match(landingSource, /결제 전 자격/);
assert.doesNotMatch(landingSource, /다음 2년|앞으로 2년/);
assert.match(landingSource, /사업계획서가 필요한 지원사업을 선택했을 때만 안내됩니다/);
assert.match(wizardSource, /어떤 지원을 받을 수 있는지 모르겠어요/);
assert.match(wizardSource, /맞는 지원 찾기와 내가 신청할 수 있는지 확인하는 건 무료/);
assert.match(wizardSource, /사업을 시작한 지 얼마나 되셨나요/);
assert.match(wizardSource, /plain_flow_step_view/);
assert.match(wizardSource, /plain_flow_answer/);
assert.match(wizardSource, /programWithApplicationDecision/);
assert.match(chatSource, /requestedStart === "find"/);
assert.match(chatSource, /requestedStart === "direct"/);
assert.match(chatSource, /PublicEvidencePanel/);
assert.match(chatSource, /근거 확인 후 사업계획서 만들기/);
assert.match(chatSource, /심사위원 관점 모의심사/);
assert.match(chatSource, /지적·요청 한 번에 반영하기/);
assert.match(chatSource, /필수 확인 4개/);
assert.doesNotMatch(chatSource, /보완용 Word/);
assert.match(evidenceRouteSource, /maxSearches: 4/);
assert.match(evidenceRouteSource, /가까운 경쟁사 2곳/);
assert.match(strategyRouteSource, /최대 6종/);
assert.match(batchRouteSource, /draft_batch/);
assert.match(auditRouteSource, /신청자 원답변과 작성 대화/);
assert.match(auditRouteSource, /canAutoFix/);
assert.match(auditRouteSource, /evidenceGuardIssues/);
assert.match(reviseRouteSource, /revision_batch/);
assert.match(reviseRouteSource, /묶음 수정 요청/);
assert.match(docxRouteSource, /acknowledgements/);
assert.match(docxRouteSource, /audit\.sectionsDigest/);
assert.match(docxRouteSource, /audit\.evidenceDigest/);
assert.match(evidencePanelSource, /계획서에 쓸 공식 근거 찾기/);
assert.match(evidencePanelSource, /\[확인 필요\]/);
assert.match(collectorWorkflow, /node-version: "22"/);
assert.match(collectorWorkflow, /BOJO_SERVICE_KEY/);
assert.match(collectorRegistry, /"bojo"/);
assert.match(collectorRegistry, /"egbiz"/);
assert.doesNotMatch(collectorRegistry, /"busanstartup"|"bizok"/);
assert.doesNotMatch(
  collectorRegistry,
  /"ntis"/,
  "승인되지 않은 NTIS HTML 수집기는 운영 레지스트리에 없어야 함",
);
assert.match(programStore, /programs\.length === 0/);
assert.match(programStore, /기존 공고를 보존합니다/);
assert.match(programStore, /NON_EXHAUSTIVE_SOURCES/);
assert.match(programStore, /부분 수집 소스라/);

console.log(
  "✅ 진입·제출유형·마감·수집원·공식근거·독립 작성준비도·심사위원 모의심사·사실기반 재작성·DOCX 회귀 테스트 통과",
);
