// 기업마당 행사정보 API 파서 검증 — 실제 인증키·네트워크·DB 없이 실행한다.
import assert from "node:assert/strict";

process.env.BIZINFO_EVENT_KEY = "stub-key";
process.env.BIZINFO_EVENT_MAX_PAGES = "5";

const requests: URL[] = [];
const originalFetch = globalThis.fetch;

const futureBusan = {
  seq: "EVEN_BUSAN_1",
  title: "[부산] 지역 기반 여성 협동조합 창업의 이해",
  areaNm: "부산",
  eventType: "교육",
  description: "<p>협동조합 기본 개념과 설립 절차를 다룹니다.</p>",
  originOrg: "동래여성인력개발센터",
  rceptPd: "2099-08-01 ~ 2099-08-13",
  eventPeriod: "20990813 ~ 20990813",
  originUrl: "https://womancenter.or.kr/course/1",
  lcategory: "창업",
  hashTags: "부산,창업",
  totCnt: "3",
};

const closedEvent = {
  seq: "EVEN_CLOSED_1",
  title: "마감된 창업 설명회",
  areaNm: "전국",
  eventType: "사업설명회",
  description: "이미 마감된 행사",
  rceptPd: "2020-01-01 ~ 2020-01-02",
  eventPeriod: "20200103 ~ 20200103",
  bizinfoUrl: "/event/closed",
  totCnt: "3",
};

const noReceptionPeriod = {
  eventInfoId: "EVEN_ONLINE_1",
  nttNm: "온라인 창업 세미나",
  areaNm: "온라인",
  eventInfoTyNm: "세미나",
  nttCn: "신청기간 없이 행사일만 제공되는 과정",
  BeginEndDe: "2099. 10. 1. ~ 2099. 10. 2.",
  originUrlAdres: "https://example.org/events/online",
  pldirSportRealmLclasCodeNm: "경영@창업",
  totCnt: "3",
};

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  requests.push(url);
  const page = url.searchParams.get("pageIndex");
  const items = page === "1" ? [futureBusan, closedEvent, noReceptionPeriod] : [];
  return new Response(JSON.stringify({ jsonArray: { item: items, totCnt: "3" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

try {
  const { fetchBizinfoEventsOpen } = await import("../lib/data/bizinfoEvent");
  const programs = await fetchBizinfoEventsOpen();

  assert.equal(programs.length, 2, "마감된 행사는 제외해야 함");
  const busan = programs.find((program) => program.id === "bizinfo-event:EVEN_BUSAN_1");
  assert.ok(busan, "부산 교육을 수집해야 함");
  assert.equal(busan.region, "부산");
  assert.equal(busan.applyEnd, "2099-08-13");
  assert.equal(busan.source, "bizinfo-event");
  assert.match(busan.supportField, /교육·행사/);
  assert.equal(busan.url, "https://womancenter.or.kr/course/1");
  assert.equal(busan.summary, "협동조합 기본 개념과 설립 절차를 다룹니다.");

  const online = programs.find((program) => program.id === "bizinfo-event:EVEN_ONLINE_1");
  assert.ok(online, "접수기간이 없는 온라인 행사를 수집해야 함");
  assert.equal(online.region, "전국");
  assert.equal(online.applyEnd, "2099-10-02", "접수기간이 없으면 행사 종료일을 사용해야 함");

  assert.ok(requests.length >= 1);
  assert.equal(requests[0].searchParams.get("dataType"), "json");
  assert.equal(requests[0].searchParams.get("pageUnit"), "100");
  assert.equal(requests[0].searchParams.get("crtfcKey"), "stub-key");

  delete process.env.BIZINFO_EVENT_KEY;
  await assert.rejects(fetchBizinfoEventsOpen(), /BIZINFO_EVENT_KEY/);
  console.log("✅ 기업마당 행사정보 파서 검증 통과");
} finally {
  globalThis.fetch = originalFetch;
}
