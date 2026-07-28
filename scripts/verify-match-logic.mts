// 매칭 로직 검증 하네스 (API 키·DB 불필요): 실제 lib 모듈을 스텁 fetch로 구동해
// P0-2(다중 페이지 수집), P1-6(지역 공고 절단 보호), P2-7(지역 가점 정렬),
// 신규(2026-07-14 5소스 확장): NIPA·KOCCA·SMTECH 파싱 + 버튼 매칭에서 이 3소스가
// 노출 보장되는지("AI 스타트업" 케이스 — 콘텐츠·ICT 공고가 후보에서 밀려 사라지지 않는지)를 확인한다.
// 실행: npx tsx scripts/verify-match-logic.mts
//
// ⚠️ 2026-07-14 스프린트로 fetchOpenPrograms()(lib/data/programs.ts)는 Supabase DB를
// 읽는 함수로 바뀌어 이 스텁 하네스로 구동할 수 없다 — 대신 각 소스의 fetchXxxOpen()을
// 직접 호출해 배열을 합친다(DB 계층 없이 순수 매칭 로직만 검증).
process.env.KSTARTUP_KEY = "stub-key";
process.env.BIZINFO_KEY = "stub-key";
process.env.KOCCA_KEY = "stub-key";

// ── 스텁 데이터: K-Startup / 기업마당 (기존 그대로 — 파서 자체는 안 건드림) ──
// K-Startup 3페이지: 그로우업 공고는 "3페이지"에 배치 — 예전 코드(1페이지만)면 누락된다.
function ksItem(i: number, over: Record<string, unknown> = {}) {
  return {
    pbanc_sn: 10000 + i,
    biz_pbanc_nm: `전국 지원사업 ${i}`,
    pbanc_ctnt: "사업화 자금 지원",
    aply_trgt_ctnt: "중소기업",
    biz_enyy: "7년미만",
    supt_biz_clsfc: "사업화",
    supt_regin: "전국",
    pbanc_rcpt_end_dt: `202607${String(15 + (i % 14)).padStart(2, "0")}`,
    detl_pg_url: "https://www.k-startup.go.kr",
    rcrt_prgs_yn: "Y",
    ...over,
  };
}
const GROWUP = ksItem(299, {
  pbanc_sn: 99999,
  biz_pbanc_nm: "부산 관광·마이스 그로우업(Grow-up) 지원사업",
  pbanc_ctnt: "부산 관광·마이스 분야 유망 스타트업의 성장(Grow-up)을 위한 사업화 자금 및 마케팅 지원",
  aply_trgt_ctnt: "부산 소재 관광·마이스 분야 창업기업",
  biz_enyy: "7년미만",
  supt_regin: "부산",
  pbanc_rcpt_end_dt: "20261231",
});
// 밀림(crowd-out) 재현: 자금형 전국 공고 수백 건 뒤에 놓인 '비자금형' 부산 공고 —
// 순수 상위 30 절단이면 잘리고, 지역 자리 보장 로직이 있어야 노출된다.
const BUSAN_FACILITY = ksItem(298, {
  pbanc_sn: 99998,
  biz_pbanc_nm: "부산 스타트업 파크 입주기업 모집",
  pbanc_ctnt: "사무 공간 입주 및 보육 프로그램 제공",
  supt_biz_clsfc: "시설,공간,보육",
  supt_regin: "부산",
  pbanc_rcpt_end_dt: "20261130",
});
const ksPages: Record<string, unknown[]> = {
  "1": Array.from({ length: 100 }, (_, i) => ksItem(i)),
  "2": Array.from({ length: 100 }, (_, i) => ksItem(100 + i, i % 10 === 0 ? { rcrt_prgs_yn: "N" } : {})),
  "3": [...Array.from({ length: 50 }, (_, i) => ksItem(200 + i)), BUSAN_FACILITY, GROWUP],
};
function bizItem(i: number, over: Record<string, unknown> = {}) {
  return {
    pblancId: `PB${20000 + i}`,
    pblancNm: `기업마당 공고 ${i}`,
    bsnsSumryCn: "<p>판로 지원</p>",
    trgetNm: "중소기업",
    pldirSportRealmLclasCodeNm: "창업",
    reqstBeginEndDe: "2026-07-01 ~ 2026-08-30",
    pblancUrl: "/view",
    hashtags: "전국",
    ...over,
  };
}
const bizPages: Record<string, unknown[]> = {
  "1": [
    ...Array.from({ length: 30 }, (_, i) => bizItem(i)),
    bizItem(98, { pblancNm: "부산시 소상공인 사업화 지원", hashtags: "부산", reqstBeginEndDe: "2026-07-01 ~ 2026-09-15" }),
  ],
  "2": Array.from({ length: 30 }, (_, i) => bizItem(100 + i)),
};

// ── 스텁 데이터: NIPA / KOCCA / SMTECH (신규, 2026-07-14 실HTML 구조 그대로) ──
function nipaRowHtml(id: number, title: string, program: string, end: string): string {
  return `<tr><td>1</td><td><div class="point d-one"><b>D-1</b></div></td>
    <td class="tl"><div class="co"><div><a href="/home/2-2/${id}">${title}</a></div>
    <div><span class="box bluebox">${program}</span>
    <span class="bco">신청기간 : 2026-07-01 09:00 ~ ${end} 18:00</span></div></div></td>
    <td><span class="bco">담당자</span></td><td><span class="bco">2026-07-01</span></td></tr>`;
}
// "AI 스타트업" 케이스 재현 — 사용자가 "AI 스타트업" 키워드로는 못 찾는 ICT/콘텐츠 지원사업.
const NIPA_AI_ITEM = nipaRowHtml(90001, "전 국민 AI 서비스 보편적 활용 지원(모두의 AI) 사업", "AI 융합", "2026-12-31");
const nipaHtmlPage1 = `<table>${NIPA_AI_ITEM}${nipaRowHtml(90002, "SaaS 전환 컨설팅 수요기업 모집", "SaaS 지원", "2026-11-30")}</table>`;

function smtechRowHtml(ancmId: string, title: string, program: string, end: string, status = "접수중"): string {
  return `<tr><td class="ac">1</td><td class="ac">SMTECH</td><td class="ac">${program}</td>
    <td><a href="/front/ifg/no/notice02_detail.do;jsessionid=X?ancmId=${ancmId}&amp;buclCd=X" class="board">${title}</a></td>
    <td class="ac">2026. 07. 01 ~ ${end}</td><td class="ac">2026-07-01</td>
    <td class="ac ll"><img src="/images/common/icon08.gif" alt="${status}" class="va_t"/></td></tr>`;
}
const smtechHtmlPage1 = `<table>${smtechRowHtml("S001", "AI 임베디드 R&D 과제", "중기부 R&D", "2026. 12. 31")}</table>`;

const koccaJsonPage1 = {
  INFO: {
    resultCode: "INFO-000",
    list: [
      {
        title: "오디오 콘텐츠 제작 파이프라인 지원사업",
        intcNoSeq: "K001",
        cate: "제작지원",
        content: "콘텐츠 제작사 대상 사업화 지원",
        endDt: "2026-12-31",
        link: "/kocca/pims/view.do?intcNo=K001",
      },
    ],
    listCount: 1,
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("apis.data.go.kr")) {
    // 실서버와 동일하게 cond[rcrt_prgs_yn::EQ]=Y 서버 필터 + matchCount + perPage 페이지네이션 재현
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? "1");
    const perPage = Number(u.searchParams.get("perPage") ?? "100");
    const wantOpen = u.searchParams.get("cond[rcrt_prgs_yn::EQ]") === "Y";
    const all = Object.values(ksPages).flat() as { rcrt_prgs_yn?: string }[];
    const filtered = wantOpen ? all.filter((it) => it.rcrt_prgs_yn === "Y") : all;
    const slice = filtered.slice((page - 1) * perPage, page * perPage);
    return new Response(
      JSON.stringify({ data: slice, matchCount: filtered.length, totalCount: all.length }),
      { status: 200 },
    );
  }
  if (url.includes("bizinfo.go.kr")) {
    const page = new URL(url).searchParams.get("pageIndex") ?? "1";
    return new Response(JSON.stringify({ jsonArray: bizPages[page] ?? [] }), { status: 200 });
  }
  if (url.includes("nipa.kr")) {
    const page = new URL(url).searchParams.get("curPage") ?? "1";
    return new Response(page === "1" ? nipaHtmlPage1 : "<table></table>", { status: 200 });
  }
  if (url.includes("smtech.go.kr")) {
    const page = new URL(url).searchParams.get("pageIndex") ?? "1";
    return new Response(page === "1" ? smtechHtmlPage1 : "<table></table>", { status: 200 });
  }
  if (url.includes("kocca.kr")) {
    const page = new URL(url).searchParams.get("pageIndex") ?? "1";
    return new Response(JSON.stringify(page === "1" ? koccaJsonPage1 : { INFO: { list: [] } }), { status: 200 });
  }
  return realFetch(input as never);
}) as typeof fetch;

// ── 검증 ────────────────────────────────────────────────────
const { fetchKstartupOpen } = await import("../lib/data/kstartup");
const { fetchBizinfoOpen } = await import("../lib/data/bizinfo");
const { fetchNipaOpen } = await import("../lib/data/nipa");
const { fetchKoccaOpen } = await import("../lib/data/kocca");
const { fetchSmtechOpen } = await import("../lib/data/smtech");
const { matchByButtons } = await import("../lib/match/buttonFilter");
const { prefilterPrograms, MAX_CANDIDATES } = await import("../lib/match/prefilter");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const [ksList, bizList, nipaList, koccaList, smtechList] = await Promise.all([
  fetchKstartupOpen(),
  fetchBizinfoOpen(),
  fetchNipaOpen(),
  fetchKoccaOpen(),
  fetchSmtechOpen(),
]);
const programs = [...ksList, ...bizList, ...nipaList, ...koccaList, ...smtechList];

const growup = programs.find((p) => p.title.includes("그로우업"));
const bySource: Record<string, number> = {};
for (const p of programs) bySource[p.source] = (bySource[p.source] ?? 0) + 1;

check(
  "P0-2: 모집중 전량 수집 — 서버 필터(cond)로 전 페이지 공고 포함",
  programs.length > 150,
  `풀 ${programs.length}건 (${JSON.stringify(bySource)})`,
);
check("P0-2: 그로우업 공고(아카이브 뒤편)가 풀에 존재", Boolean(growup), growup?.applyEnd ?? "");
check("P0-2: 기업마당 부산 공고가 풀에 존재", programs.some((p) => p.title.includes("부산시 소상공인")));

// 신규(2026-07-14): 5소스 전부 풀에 존재하는지
check(
  "5소스 확장: kstartup·bizinfo·nipa·kocca·smtech 전부 풀에 존재",
  ["kstartup", "bizinfo", "nipa", "kocca", "smtech"].every((s) => (bySource[s] ?? 0) > 0),
  JSON.stringify(bySource),
);

// 버튼 경로: 사용자 재현 조건 그대로
const res = matchByButtons(programs, { years: "창업도약기(4~7년)", region: "부산", supportType: "사업화" });
const idx = res.recommendations.findIndex((r) => r.program.title.includes("그로우업"));
check("재현: 부산·창업도약기·사업화 추천에 그로우업 노출", idx >= 0, idx >= 0 ? `${idx + 1}위 / ${res.recommendations.length}건` : "미노출");
check("P2-7: 지역 가점 — 그로우업이 상위 5위 이내", idx >= 0 && idx < 5, `실제 ${idx + 1}위`);
const growupRec = idx >= 0 ? res.recommendations[idx] : null;
console.log(`   └ 판정: ${growupRec?.eligibility} | 근거: ${growupRec?.fitReason}`);

// 밀림 보장: 자금형 250+건 뒤의 부산 시설형 공고가 상위 30 안에 자리 보장되는지
const facIdx = res.recommendations.findIndex((r) => r.program.title.includes("부산 스타트업 파크"));
check(
  "노출 보장: 비자금형 부산 공고가 30건 안에 포함 (순수 절단이면 밀림)",
  facIdx >= 0 && res.recommendations.length <= 30,
  facIdx >= 0 ? `${facIdx + 1}위 / ${res.recommendations.length}건` : "미노출",
);

// 신규(2026-07-14) "AI 스타트업" 케이스: 전국·창업초기·사업화 조합에서 K-Startup 250+건에
// 밀려 KOCCA·NIPA 공고가 상위 30 밖으로 사라지지 않는지 — buttonFilter의 신규 소스 노출 보장 검증.
const aiRes = matchByButtons(programs, { years: "창업초기(3년 이내)", region: "전국(중앙부처)", supportType: "사업화" });
const koccaIdx = aiRes.recommendations.findIndex((r) => r.program.source === "kocca");
const nipaIdx = aiRes.recommendations.findIndex((r) => r.program.source === "nipa");
check(
  "AI스타트업 케이스: KOCCA 콘텐츠 공고(오디오 콘텐츠 제작지원)가 후보에 노출",
  koccaIdx >= 0,
  koccaIdx >= 0 ? `${koccaIdx + 1}위 / ${aiRes.recommendations.length}건` : "미노출 — 풀에 없거나 30건 밖으로 밀림",
);
check(
  "AI스타트업 케이스: NIPA ICT 공고(모두의 AI)가 후보에 노출",
  nipaIdx >= 0,
  nipaIdx >= 0 ? `${nipaIdx + 1}위 / ${aiRes.recommendations.length}건` : "미노출 — 풀에 없거나 30건 밖으로 밀림",
);

// 대화 경로: 마감 임박순 45건 절단 보호 (그로우업 마감 12-31은 예전 코드면 절단됨)
const pre = prefilterPrograms(programs, { region: "부산" });
check(
  "P1-6: prefilter 절단 보호 — 마감 먼(12-31) 부산 공고가 45건 안에 생존",
  pre.some((p) => p.title.includes("그로우업")),
  `후보 ${pre.length}건 (상한 ${MAX_CANDIDATES})`,
);
// 회귀 확인: 전국 조건은 기존 동작(마감 임박순 45건) 유지
const preNation = prefilterPrograms(programs, { region: "전국(어디든 가능)" });
check("회귀 없음: 전국 조건 prefilter 45건 상한 유지", preNation.length === MAX_CANDIDATES, `${preNation.length}건`);

console.log(failed === 0 ? "\n모든 검증 통과" : `\n${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
