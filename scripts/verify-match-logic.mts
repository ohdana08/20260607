// 매칭 로직 검증 하네스 (API 키 불필요): 실제 lib 모듈을 스텁 fetch로 구동해
// P0-2(다중 페이지 수집), P1-6(지역 공고 절단 보호), P2-7(지역 가점 정렬)을 확인한다.
// 실행: npx tsx scripts/verify-match-logic.mts
process.env.KSTARTUP_KEY = "stub-key";
process.env.BIZINFO_KEY = "stub-key";

// ── 스텁 데이터 ──────────────────────────────────────────────
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
  return realFetch(input as never);
}) as typeof fetch;

// ── 검증 ────────────────────────────────────────────────────
const { fetchOpenPrograms } = await import("../lib/data/programs");
const { matchByButtons } = await import("../lib/match/buttonFilter");
const { prefilterPrograms, MAX_CANDIDATES } = await import("../lib/match/prefilter");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

const { programs, usingSample } = await fetchOpenPrograms();
const growup = programs.find((p) => p.title.includes("그로우업"));
const bySource = { kstartup: 0, bizinfo: 0 };
for (const p of programs) bySource[p.source as "kstartup" | "bizinfo"]++;

check("샘플 폴백 아님", !usingSample);
check(
  "P0-2: 모집중 전량 수집 — 서버 필터(cond)로 전 페이지 공고 포함",
  programs.length > 150,
  `풀 ${programs.length}건 (kstartup ${bySource.kstartup} + bizinfo ${bySource.bizinfo})`,
);
check("P0-2: 그로우업 공고(아카이브 뒤편)가 풀에 존재", Boolean(growup), growup?.applyEnd ?? "");
check("P0-2: 기업마당 부산 공고가 풀에 존재", programs.some((p) => p.title.includes("부산시 소상공인")));

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
