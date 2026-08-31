import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

const { classifyApplicationKind, matchByButtons } = await import(
  "../lib/match/buttonFilter.ts"
);
const { isStillOpen, kstToday } = await import("../lib/data/openFilter.ts");
const { firstTrustedProgramUrl } = await import("../lib/data/trustedProgramUrl.ts");
const { buildPlanDocxBuffer } = await import("../lib/plan/docx.ts");
const { normalizeBojoItem, normalizeDataGoKrServiceKey } = await import("../lib/data/bojo.ts");
const { buildPublicEvidencePrompt, rankPublicEvidenceItems } = await import(
  "../lib/data/publicEvidence.ts"
);

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
const aiEvidence = rankPublicEvidenceItems("AI 공공데이터 기반 관광 서비스", "step6", 3);
assert.ok(aiEvidence.some((item) => item.id === "public-data-portal"));
assert.ok(aiEvidence.some((item) => item.id === "kogl-ai"));
const evidencePrompt = buildPublicEvidencePrompt("AI 공공데이터");
assert.match(evidencePrompt, /공식 근거 후보/);
assert.match(evidencePrompt, /확인할 공식 출처 후보/);
assert.match(evidencePrompt, /개방 예정/);

const docx = await buildPlanDocxBuffer("검증용 사업계획서", [
  {
    heading: "1. 고객과 수익모델",
    content:
      "핵심 고객: 마감이 임박한 초기창업자\n결제자: 대표자 본인\n가격: 1건 29,900원\n\n[보완 필요: 고객 인터뷰 수를 입력해 주세요]\n[증빙 필요: 결제 내역 캡처]",
  },
]);
const zip = await JSZip.loadAsync(docx);
const documentXml = await zip.file("word/document.xml")?.async("string");
assert.ok(documentXml, "DOCX 본문 XML이 있어야 함");
assert.match(documentXml, /제출 전 검토표/);
assert.match(documentXml, /검증용 사업계획서/);
assert.ok((documentXml.match(/<w:tbl>/g) ?? []).length >= 2, "검토표와 내용표가 있어야 함");

const landingSource = readFileSync(new URL("../app/landing/LandingClient.tsx", import.meta.url), "utf8");
const wizardSource = readFileSync(new URL("../components/chat/DiagnosisWizard.tsx", import.meta.url), "utf8");
const chatSource = readFileSync(new URL("../components/chat/Chat.tsx", import.meta.url), "utf8");
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

assert.match(landingSource, /내 사업에 맞는/);
assert.match(landingSource, /무료로 맞는 지원사업 찾기/);
assert.match(landingSource, /이미 지원할 공고가 있어요/);
assert.match(landingSource, /사업계획서가 필요한 지원사업을 선택했을 때만 안내됩니다/);
assert.match(wizardSource, /나에게 맞는 지원사업을 찾아주세요/);
assert.match(wizardSource, /지원사업 찾기와 신청 가능 여부 확인은 무료/);
assert.match(chatSource, /requestedStart === "find"/);
assert.match(chatSource, /requestedStart === "direct"/);
assert.match(chatSource, /PublicEvidencePanel/);
assert.match(evidencePanelSource, /계획서에 쓸 공식 근거 찾기/);
assert.match(evidencePanelSource, /\[확인 필요\]/);
assert.match(collectorWorkflow, /node-version: "22"/);
assert.match(collectorWorkflow, /BOJO_SERVICE_KEY/);
assert.match(collectorRegistry, /"bojo"/);
assert.doesNotMatch(
  collectorRegistry,
  /"ntis"/,
  "승인되지 않은 NTIS HTML 수집기는 운영 레지스트리에 없어야 함",
);
assert.match(programStore, /programs\.length === 0/);
assert.match(programStore, /기존 공고를 보존합니다/);

console.log(
  "✅ 진입·제출유형·마감·e나라도움·NTIS 안전경계·6단계 공식근거·DOCX 회귀 테스트 통과",
);
