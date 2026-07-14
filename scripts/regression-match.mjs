// 추천 커버리지 회귀 테스트 — 지역 4종 × 조건 3종 = 12개 조합 (2026-07-14 P0)
//
// 사용법:
//   node scripts/regression-match.mjs                        # 로컬 dev (http://localhost:3000)
//   BASE=https://<배포URL> node scripts/regression-match.mjs # 배포 환경
//   COOKIE='_vercel_jwt=...' BASE=... node ...               # Vercel 배포 보호 우회 쿠키
//
// ⚠️ /api/match 레이트리밋은 IP당 15회/1시간 (lib/ratelimit.ts) — 12개 조합이 한도의
//    대부분을 쓴다. 같은 시간대에 수동 테스트와 섞어 돌리면 429가 난다.
//
// 통과 기준:
//   1) 각 조합에서 추천 > 0건, poolStats에 bizinfo·kstartup 둘 다 존재
//   2) 특정 지역 조합에서 그 지역 소재 공고 ≥ 1건 (풀 기준 — 노출 0건이면 실패)
//   3) EXPECTED 목록(원천 사이트에서 눈으로 확인한 공고)이 모집 기간 중이면 반드시 노출
//      → "원천 사이트 대비 명백 누락 0건" 기준. 목록은 수동 검수로 늘려간다.
//   4) (2026-07-14 5소스 확장) poolStats.bySource에 nipa·kocca·smtech도 존재.
//      ⚠️ 이 체크는 (a) supabase/04-programs.sql 실행 (b) scripts/collect-programs.mts를
//      최소 1회 성공 실행(KOCCA_KEY 발급 포함) (c) 배포 반영까지 끝나야 통과한다 —
//      그 전까지는 실패가 정상이다(아직 배치가 안 돌았을 뿐, 코드 결함이 아님).
const BASE = process.env.BASE ?? "http://localhost:3000";
const COOKIE = process.env.COOKIE ?? "";

// 원천 사이트(K-Startup·기업마당)에서 직접 확인한 "반드시 나와야 하는" 공고.
// deadline이 지나면 자동으로 검사에서 제외된다.
const EXPECTED = [
  {
    // P0 실사고 재현 사례 (pbanc_sn 176953). API 원문 제목은 "관광ㆍ마이스"로
    // 가운뎃점이 한글 자모(ㆍ)라 전체 문자열 매칭이 깨진다 — 안전한 부분 문자열만 사용.
    title: "그로우업",
    region: "부산",
    years: "창업도약기(4~7년)",
    supportType: "사업화",
    deadline: "2026-12-31",
  },
];

const REGIONS = ["부산", "울산", "경남", "전국(중앙부처)"];
const CONDS = [
  { years: "창업도약기(4~7년)", supportType: "사업화" }, // P0 재현 조건
  { years: "창업초기(3년 이내)", supportType: "멘토링·교육" },
  { years: "7년 이상", supportType: "융자·보증" },
];

const today = new Date().toISOString().slice(0, 10);
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
};

let poolPrinted = false;
for (const region of REGIONS) {
  for (const cond of CONDS) {
    const label = `${region} × ${cond.years} × ${cond.supportType}`;
    console.log(`\n[${label}]`);
    let d;
    try {
      const res = await fetch(`${BASE}/api/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(COOKIE ? { cookie: COOKIE } : {}) },
        body: JSON.stringify({ buttonProfile: { region, ...cond }, provider: "claude" }),
      });
      d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? `HTTP ${res.status}`);
    } catch (err) {
      check("호출 성공", false, String(err));
      continue;
    }
    const recs = d.recommendations ?? [];
    const stats = d.poolStats ?? {};
    if (!poolPrinted) {
      console.log(`  풀: ${stats.total}건 | 소스: ${JSON.stringify(stats.bySource)} | 지역 종류: ${Object.keys(stats.byRegion ?? {}).length}개`);
      poolPrinted = true;
    }
    check("샘플 폴백 아님", !d.usingSample);
    check("추천 > 0건", recs.length > 0, `${recs.length}건 (지역·업력 통과 ${d.total}건)`);
    check("풀에 kstartup·bizinfo 둘 다 존재", (stats.bySource?.kstartup ?? 0) > 0 && (stats.bySource?.bizinfo ?? 0) > 0, JSON.stringify(stats.bySource));
    check(
      "풀에 nipa·kocca·smtech 전부 존재 (배치 실행 후에만 통과 — 위 4번 참고)",
      ["nipa", "kocca", "smtech"].every((s) => (stats.bySource?.[s] ?? 0) > 0),
      JSON.stringify(stats.bySource),
    );
    if (!region.includes("전국")) {
      const sido = region.slice(0, 2);
      check(`풀에 ${sido} 소재 공고 ≥ 1건`, (stats.local ?? 0) > 0, `${stats.local ?? 0}건`);
      const localShown = recs.filter((r) => r.program.region.includes(sido)).length;
      check(`추천에 ${sido} 소재 공고 노출`, localShown > 0, `${localShown}건`);
    }
    for (const exp of EXPECTED) {
      if (exp.region !== region || exp.years !== cond.years || exp.supportType !== cond.supportType) continue;
      if (exp.deadline < today) continue; // 마감 지난 기대 공고는 건너뜀
      const at = recs.findIndex((r) => r.program.title.includes(exp.title));
      check(
        `기대 공고 노출: "${exp.title}"`,
        at >= 0,
        at >= 0
          ? `${at + 1}위 · ${recs[at].eligibility} · 마감 ${recs[at].program.applyEnd}`
          : "누락(명백 누락!)",
      );
    }
  }
}

console.log(failed === 0 ? "\n✅ 12개 조합 회귀 전부 통과" : `\n❌ ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
