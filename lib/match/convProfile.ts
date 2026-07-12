import type { Program } from "./types";
import { judgeYears, YEARS_OPTIONS } from "./buttonFilter";

// ── 대화에서 파생하는 구조화 프로필 (2026-07-12) ─────────────────────────
// 인테이크 3문항의 '예비/운영중'만으로는 업력이 없어서, 대화 중 "업력 6년"·"2020.07 설립"
// 같은 사용자 발화를 규칙으로 추출해 추천 하드 필터에 태운다. (LLM 아님 — 결정적)
// ⚠️ 반드시 "사용자" 발화만 넣을 것 — 어시스턴트 발화·공고 인용문에는 연도가 흔해 오탐된다.

export interface ConvYears {
  bucket: (typeof YEARS_OPTIONS)[number];
  foundDate: Date | null; // 설립일을 알면 "YYYY.MM.DD 이후 설립" 컷오프 검사에 사용
}

export function deriveConvYears(userText: string, now: Date = new Date()): ConvYears | null {
  // ① 명시적 업력: "업력 6년", "6년차", "창업한 지 6년"
  let years: number | null = null;
  const y =
    userText.match(/업력\s*(\d{1,2})\s*년/) ??
    userText.match(/(\d{1,2})\s*년\s*차/) ??
    userText.match(/창업한\s*지\s*(\d{1,2})\s*년/);
  if (y) years = Number(y[1]);

  // ② 설립 시점: "2020.07 설립", "2020년 7월 개업", "2020.07 창업했" (단순 '창업'은 공고 인용 오탐 방지로 제외)
  let foundDate: Date | null = null;
  const f = userText.match(
    /(20\d{2})\s*[.\-\/년]?\s*(0?[1-9]|1[0-2])?\s*[월.]?\s*(?:에\s*)?(설립|개업|법인\s*설립|창업(?:했|함|한))/,
  );
  if (f) {
    foundDate = new Date(Number(f[1]), f[2] ? Number(f[2]) - 1 : 0, 1);
    if (years === null) {
      const diff = (now.getTime() - foundDate.getTime()) / (365.25 * 86400000);
      if (diff >= 0 && diff < 60) years = Math.floor(diff);
    }
  }

  if (years === null) {
    if (/예비\s*창업/.test(userText)) return { bucket: YEARS_OPTIONS[0], foundDate: null };
    return null;
  }
  const bucket =
    years <= 3 ? YEARS_OPTIONS[1] : years <= 7 ? YEARS_OPTIONS[2] : YEARS_OPTIONS[3];
  return { bucket, foundDate };
}

// 공고가 "YYYY.MM.DD 이후 설립/창업"을 요구하는데 사용자 설립일이 그보다 이르면 확실한 미달.
// (judgeYears는 "N년" 표현만 다루므로, 날짜 컷 방식 공고를 여기서 보강)
export function violatesFoundingCutoff(p: Program, foundDate: Date | null): boolean {
  if (!foundDate) return false;
  const hay = `${p.title} ${p.target} ${p.summary}`;
  const m = hay.match(
    /(20\d{2})\s*[.\-\/년]\s*(0?[1-9]|1[0-2])\s*[.\-\/월]?\s*(0?[1-9]|[12]\d|3[01])?\s*[일.]?\s*이후[에\s]*(설립|창업)/,
  );
  if (!m) return false;
  const cutoff = new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
  return foundDate < cutoff;
}

// 업력 하드 필터 — 어느 추천 경로든 최종 출력 전에 이 검사를 통과해야 한다.
export function passesHardYears(p: Program, conv: ConvYears | null): boolean {
  if (!conv) return true;
  if (judgeYears(p, conv.bucket) === "exclude") return false;
  if (violatesFoundingCutoff(p, conv.foundDate)) return false;
  return true;
}
