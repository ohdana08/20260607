import type { Program } from "./types";

// 추천(match) LLM 투입 전 규칙 기반 사전 필터 (점검표 문제 7).
// ① region: 사용자 지역 + 전국만 ② target 텍스트 연령·업력 키워드 매칭
// ③ 마감 임박순 상위 MAX_CANDIDATES 건만 LLM에 전달.
// 필터는 "확실히 자격 미달"만 떨어뜨린다 — 애매하면 남겨서 LLM이 판단.

export const MAX_CANDIDATES = 45;

// 인테이크 앞단 3문항(버튼)에서 오는 구조화 프로필. 없으면 해당 필터는 건너뜀.
export interface MatchProfile {
  stage?: string; // "예비" | "운영중"
  region?: string; // 시도명 (예: "서울") 또는 "전국"
  ageGroup?: string; // "20대" | "30대" | "40대" | "50대" | "60대 이상"
}

// 연령대 → 대표 나이 (필터 판정용 중앙값)
function representativeAge(ageGroup?: string): number | null {
  if (!ageGroup) return null;
  const m = ageGroup.match(/(\d{2})\s*대/);
  if (!m) return null;
  const decade = Number(m[1]);
  return decade + 5; // 20대→25, 30대→35 …
}

function regionOk(p: Program, region?: string): boolean {
  if (!region || region.includes("전국")) return true; // "전국(어디든 가능)" 포함
  if (!p.region || p.region.includes("전국")) return true;
  return p.region.includes(region);
}

// 연령: target에 "만 39세 이하/미만/이상" 같은 명시적 숫자 제한이 있을 때만 배제.
// "청년"처럼 숫자 없는 표현은 정의가 제각각이라 50대 이상일 때만 배제(그 외엔 LLM 판단).
function ageOk(p: Program, ageGroup?: string): boolean {
  const age = representativeAge(ageGroup);
  if (age === null) return true;
  const t = p.target;
  const upper = t.match(/만?\s*(\d{2})\s*세\s*(이하|미만)/);
  if (upper) {
    const limit = Number(upper[1]);
    if (upper[2] === "이하" ? age > limit : age >= limit) return false;
  }
  const lower = t.match(/만?\s*(\d{2})\s*세\s*(이상|초과)/);
  if (lower) {
    const limit = Number(lower[1]);
    if (lower[2] === "이상" ? age < limit : age <= limit) return false;
  }
  if (!upper && !lower && age >= 55 && /청년/.test(t)) return false;
  return true;
}

// 업력: "예비"는 업력 N년 이상 요구 공고 배제, "운영중"은 예비창업자 전용 공고 배제.
function stageOk(p: Program, stage?: string): boolean {
  if (!stage) return true;
  const t = p.target;
  if (stage.includes("예비")) {
    if (/(업력|창업\s*후?)\s*(\d+)\s*년\s*이상/.test(t)) return false;
    return true;
  }
  if (stage.includes("운영")) {
    // "예비창업자"만 대상인 공고 배제. 단 "예비창업자 및 3년 이내 창업기업"처럼
    // 기창업자도 포함하는 공고는 남긴다.
    if (/예비\s*창업/.test(t) && !/(\d+\s*년|창업\s*기업|기창업|재창업|초기)/.test(t)) return false;
    return true;
  }
  return true;
}

// 마감 임박순(상시·기한 없음은 뒤로)
function byDeadline(a: Program, b: Program): number {
  const ax = a.applyEnd ?? "9999-99-99";
  const bx = b.applyEnd ?? "9999-99-99";
  return ax.localeCompare(bx);
}

export function prefilterPrograms(programs: Program[], profile?: MatchProfile): Program[] {
  const filtered = programs.filter(
    (p) => regionOk(p, profile?.region) && ageOk(p, profile?.ageGroup) && stageOk(p, profile?.stage),
  );
  // 지역 소재 공고 보호 (2026-07-14 P1): 마감 임박순 45건 절단은 마감이 먼 지역 공고
  // (실사례: 부산 관광·마이스 그로우업, 마감 12-31)를 밀어낸다. 사용자 지역 소재 공고는
  // 애초에 소수이므로 전량 보존하고, 나머지 자리만 마감 임박순으로 채운다.
  const userSido =
    profile?.region && !profile.region.includes("전국") ? profile.region.slice(0, 2) : null;
  if (!userSido) return filtered.sort(byDeadline).slice(0, MAX_CANDIDATES);
  const local = filtered.filter((p) => p.region.includes(userSido)).sort(byDeadline);
  const rest = filtered.filter((p) => !p.region.includes(userSido)).sort(byDeadline);
  return [...local, ...rest].slice(0, MAX_CANDIDATES); // 지역 소재가 45건을 넘어도 토큰 가드는 유지
}
