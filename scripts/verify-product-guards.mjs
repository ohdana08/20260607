import assert from "node:assert/strict";
import JSZip from "jszip";

const { classifyApplicationKind, matchByButtons } = await import(
  "../lib/match/buttonFilter.ts"
);
const { isStillOpen, kstToday } = await import("../lib/data/openFilter.ts");
const { firstTrustedProgramUrl } = await import("../lib/data/trustedProgramUrl.ts");
const { buildPlanDocxBuffer } = await import("../lib/plan/docx.ts");

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

console.log("✅ 제출유형·마감·공식 URL·DOCX 검토표 회귀 테스트 통과");
