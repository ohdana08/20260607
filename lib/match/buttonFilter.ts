import type { Program, Recommendation } from "./types";

// ── 버튼 4단계 추천 매칭 (2026-07-10 확정 설계, 2026-07-12 구현) ──────────
// LLM 채팅 인테이크를 대체하는 규칙 기반 매칭. LLM 호출 0회 — 즉시 응답.
//   1단계 업력, 2단계 지역 = 하드 필터 (단, '확실한 미달'만 배제)
//   3단계 지원유형 = 우선순위 (일치 공고를 앞으로; 없으면 완화해서 전부 노출)
//   4단계 분야 = 보너스 매칭 (7/2 확정: 골라도 결과가 줄지 않고 특화 공고만 위로)

export const YEARS_OPTIONS = [
  "예비창업",
  "창업초기(3년 이내)",
  "창업도약기(4~7년)",
  "7년 이상",
] as const;
export const REGION_OPTIONS = ["부산", "경남", "전국(중앙부처)"] as const;
export const TYPE_OPTIONS = ["사업화", "R&D", "시설·공간", "멘토링·교육", "융자·보증"] as const;
export const SECTOR_OPTIONS = ["창업", "경영", "기술", "수출", "금융"] as const;

export interface ButtonProfile {
  years: string; // YEARS_OPTIONS 중 하나
  region: string; // REGION_OPTIONS 중 하나
  supportType: string; // TYPE_OPTIONS 중 하나
  sector?: string; // SECTOR_OPTIONS 중 하나 (선택 — 보너스 매칭)
}

// 지원유형 → 공고 텍스트(지원분야+제목) 키워드.
// K-Startup supt_biz_clsfc(사업화·기술개발(R&D)·시설,공간,보육·멘토링,컨설팅,교육·융자)와
// 기업마당 대분류(금융·기술·수출·창업·경영 등)를 함께 커버한다.
const TYPE_KEYWORDS: Record<string, RegExp> = {
  사업화: /사업화|판로|내수|마케팅|바우처|스케일업|액셀러|엑셀러|상용화/,
  "R&D": /R\s*&?\s*D|기술개발|연구개발|기술혁신|실증/i,
  "시설·공간": /시설|공간|입주|보육|사무실|공장|센터\s*입주/,
  "멘토링·교육": /멘토링|컨설팅|교육|아카데미|역량\s*강화|자문/,
  "융자·보증": /융자|보증|대출|정책자금|금융\s*지원|자금\s*지원/,
};

// 분야(보너스) → 키워드. 기업마당 대분류 값과 이름이 같아 대부분 그대로 걸린다.
const SECTOR_KEYWORDS: Record<string, RegExp> = {
  창업: /창업/,
  경영: /경영|인력|노무|세무/,
  기술: /기술|R\s*&?\s*D|특허|지식재산/i,
  수출: /수출|글로벌|해외|무역/,
  금융: /금융|융자|보증|투자/,
};

function regionOk(p: Program, region: string): boolean {
  if (region.includes("전국")) return p.region.includes("전국");
  return p.region.includes(region.slice(0, 2)) || p.region.includes("전국");
}

// 업력 판정 — target 원문에서 확실한 미달만 배제, 명시적 일치는 match, 나머지는 unknown.
// K-Startup target에는 "업력: 예비창업자,1년미만,3년미만…" 형태의 목록이 들어온다.
type YearsJudge = "match" | "unknown" | "exclude";
export function judgeYears(p: Program, years: string): YearsJudge {
  const t = p.target;
  const has예비 = /예비/.test(t);
  // "예비창업자"만 대상(기창업 표현이 전혀 없음)인 공고
  const 예비전용 = /예비\s*창업/.test(t) && !/(년|기창업|재창업|초기|도약|창업\s*기업)/.test(t);
  const uppers = [...t.matchAll(/(\d+)\s*년\s*(미만|이내|이하)/g)].map((m) => Number(m[1]));
  const lowers = [...t.matchAll(/(\d+)\s*년\s*(이상|초과)/g)].map((m) => Number(m[1]));
  const maxUpper = uppers.length ? Math.max(...uppers) : null; // 가장 관대한 업력 상한
  const minLower = lowers.length ? Math.min(...lowers) : null; // 가장 관대한 업력 하한

  if (years.startsWith("예비")) {
    if (minLower !== null && !has예비 && uppers.length === 0) return "exclude"; // "N년 이상"만 요구
    if (has예비) return "match";
    return "unknown";
  }
  if (years.includes("3년 이내")) {
    if (예비전용) return "exclude";
    if (minLower !== null && minLower > 3 && maxUpper === null) return "exclude";
    if (maxUpper !== null && maxUpper >= 1) return "match"; // 1·2·3·5·7년미만 등 어떤 상한이든 초기 포함
    if (/초기/.test(t)) return "match";
    return "unknown";
  }
  if (years.includes("4~7년")) {
    if (예비전용) return "exclude";
    if (maxUpper !== null && maxUpper <= 3 && minLower === null) return "exclude"; // 상한 3년 → 4년차 불가
    if (minLower !== null && minLower > 7 && maxUpper === null) return "exclude";
    if ((maxUpper !== null && maxUpper >= 5) || /도약/.test(t)) return "match";
    return "unknown";
  }
  // 7년 이상
  if (예비전용) return "exclude";
  if (maxUpper !== null && maxUpper <= 7 && minLower === null) return "exclude"; // 상한 7년 이하 → 불가
  if (minLower !== null && minLower <= 7) return "match"; // "N년 이상"(N≤7) 요구 충족
  if (maxUpper !== null && maxUpper > 7) return "match";
  return "unknown";
}

function byDeadline(a: Program, b: Program): number {
  return (a.applyEnd ?? "9999-99-99").localeCompare(b.applyEnd ?? "9999-99-99");
}

export interface ButtonMatchResult {
  recommendations: Recommendation[];
  relaxed: boolean; // 지원유형 일치가 0건이라 유형 조건을 완화해 보여주는 상태
  total: number; // 지역·업력 통과 총 건수
}

export function matchByButtons(programs: Program[], profile: ButtonProfile): ButtonMatchResult {
  const typeRe = TYPE_KEYWORDS[profile.supportType];
  const sectorRe = profile.sector ? SECTOR_KEYWORDS[profile.sector] : null;
  const regionLabel = profile.region.includes("전국") ? "전국(중앙부처)" : `${profile.region}·전국`;

  const scored = programs
    .map((p) => {
      if (!regionOk(p, profile.region)) return null;
      const yearsJudge = judgeYears(p, profile.years);
      if (yearsJudge === "exclude") return null;
      const hay = `${p.supportField} ${p.title}`;
      const typeHit = typeRe ? typeRe.test(hay) : false;
      const sectorHit = sectorRe ? sectorRe.test(hay) : false;
      return { p, typeHit, sectorHit, yearsJudge };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      if (a.typeHit !== b.typeHit) return a.typeHit ? -1 : 1;
      if (a.sectorHit !== b.sectorHit) return a.sectorHit ? -1 : 1;
      if ((a.yearsJudge === "match") !== (b.yearsJudge === "match"))
        return a.yearsJudge === "match" ? -1 : 1;
      return byDeadline(a.p, b.p);
    });

  const relaxed = scored.length > 0 && !scored.some((s) => s.typeHit);

  const recommendations: Recommendation[] = scored.slice(0, 30).map((s) => {
    const parts: string[] = [];
    parts.push(
      s.typeHit
        ? `찾으시는 ‘${profile.supportType}’ 지원이에요`
        : `‘${profile.supportType}’과 정확히 일치하진 않지만 조건에 맞는 공고예요`,
    );
    if (s.sectorHit && profile.sector) parts.push(`‘${profile.sector}’ 분야 특화`);
    parts.push(`${regionLabel} 대상`);
    parts.push(
      s.yearsJudge === "match"
        ? `업력(${profile.years}) 조건 충족`
        : "업력 조건은 공고 원문에서 한 번 확인해 주세요",
    );
    return {
      program: s.p,
      whatItIs: "",
      fitReason: parts.join(" · "),
      eligibility: s.typeHit && s.yearsJudge === "match" ? "가능성 높음" : "확인 필요",
    };
  });

  return { recommendations, relaxed, total: scored.length };
}
