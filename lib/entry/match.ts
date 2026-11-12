import type { Program } from "../match/types.ts";
import type { EntryConditions } from "./conditions.ts";

const REGION_ALIASES: Record<string, string[]> = {
  서울: ["서울"], 부산: ["부산"], 대구: ["대구"], 인천: ["인천"], 광주: ["광주"], 대전: ["대전"], 울산: ["울산"], 세종: ["세종"], 경기: ["경기"], 강원: ["강원"],
  충북: ["충북", "충청북도"], 충남: ["충남", "충청남도"], 전북: ["전북", "전라북도"], 전남: ["전남", "전라남도"], 경북: ["경북", "경상북도"], 경남: ["경남", "경상남도"], 제주: ["제주"],
};
const INDUSTRY: Record<EntryConditions["industry"], RegExp> = {
  tech: /IT|ICT|소프트웨어|정보통신|디지털|인공지능|기술\s*(기업|창업)/i,
  manufacturing: /제조|공장/, food: /외식|음식점|식품|식당|카페/, retail: /도소매|도매|소매|유통|온라인\s*쇼핑/,
  service: /서비스업|서비스\s*기업/, other: /$a/,
};
const AGE: Record<EntryConditions["age"], [number, number]> = { under_30: [0, 29], "30_39": [30, 39], "40_49": [40, 49], "50_plus": [50, Infinity] };
const YEARS: Record<Exclude<EntryConditions["business"], "pre">, [number, number]> = { under_3: [0, 3], "3_7": [3, 7], over_7: [7, Infinity] };
export function safeEntryUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".") && url.hostname !== "localhost"; } catch { return false; }
}
export function entryDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function regionMatches(p: Program, c: EntryConditions): boolean {
  const aliases = REGION_ALIASES[c.region];
  if (!p.region.includes("전국") && !aliases.some((name) => p.region.includes(name))) return false;
  // A national source label must not override an explicit local eligibility rule.
  const text = `${p.title} ${p.target}`;
  const restricted = Object.entries(REGION_ALIASES).filter(([, names]) => names.some((name) => new RegExp(`${name}.{0,12}(소재|거주|관내|한정|시민|도민|사업장)`).test(text))).map(([region]) => region);
  return restricted.length === 0 || restricted.includes(c.region);
}
function ageMatches(text: string, age: EntryConditions["age"]): boolean {
  const [min, max] = AGE[age];
  const bounds = [...text.matchAll(/(\d+)\s*세\s*(이상|초과|이하|미만)/g)];
  const ranges = [...text.matchAll(/(\d+)\s*(?:세)?\s*[~∼～-]\s*(\d+)\s*세/g)];
  if (!bounds.length && !ranges.length) return !/청년|중장년|고령|시니어|\d+\s*(?:세|대)|연령\s*(?:제한|:).*\d/.test(text);
  return bounds.every((m) => {
    const n = Number(m[1]);
    return m[2] === "이상" ? min >= n : m[2] === "초과" ? min > n : m[2] === "이하" ? max <= n : max < n;
  }) && ranges.every((m) => min >= Number(m[1]) && max <= Number(m[2]));
}
function yearsMatches(text: string, business: EntryConditions["business"]): boolean {
  if (business === "pre") return /예비\s*창업/.test(text) && !/예비\s*창업[^.,/]{0,8}(제외|불가)/.test(text);
  if (/예비\s*창업/.test(text) && !/창업\s*기업|기창업|중소기업|소상공인|\d+\s*년/.test(text)) return false;
  const [min, max] = YEARS[business];
  const bounds = [...text.matchAll(/(\d+)\s*년\s*(이상|초과|이하|미만|이내)/g)];
  const ranges = [...text.matchAll(/(\d+)\s*(?:년)?\s*[~∼～-]\s*(\d+)\s*년/g)];
  if (!bounds.length && !ranges.length) return /기업|소상공인|사업자|업력\s*(무관|제한\s*없음)/.test(text) && !/초기|도약/.test(text);
  return bounds.every((m) => {
    const n = Number(m[1]);
    if (m[2] === "이상") return min >= n;
    if (m[2] === "초과") return min > n;
    // All finite bins are half-open: [0,3), [3,7), [7,infinity).
    // The unselected upper boundary may equal either a strict or inclusive cap.
    return max <= n;
  }) && ranges.every((m) => min >= Number(m[1]) && max <= Number(m[2]));
}
function industryMatches(text: string, industry: EntryConditions["industry"]): boolean {
  const mentioned = Object.entries(INDUSTRY).filter(([, re]) => re.test(text)).map(([key]) => key);
  if (!mentioned.length) return !/농업|어업|농어|축산|관광|콘텐츠|문화예술|게임|바이오|건설|의료/.test(text);
  return mentioned.includes(industry);
}
/** Conservative candidates, not a certification of all notice-specific eligibility.
 * Entire selected ranges must fit an explicit limit; unknown/special qualifications
 * are omitted rather than inferred. No LLM, sample fallback or profile logging. */
export function matchEntryPrograms(programs: Program[], conditions: EntryConditions, now = new Date()): Program[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const seen = new Set<string>();
  return programs.filter((p) => {
    if (p.source === "sample" || /^sample[-:]/i.test(p.id) || !safeEntryUrl(p.url) || !p.title.trim() || seen.has(p.id)) return false;
    const deadline = entryDate(p.applyEnd);
    if ((p.applyEnd !== null && !deadline) || (deadline && deadline < today)) return false;
    if (!deadline && !/상시|수시|예산\s*소진/.test(`${p.title} ${p.summary}`)) return false;
    if (!p.target.trim() || /지원대상 정보 없음|상세\s*(공고|내용|페이지)\s*(참조|확인)/.test(p.target)) return false;
    const text = `${p.title} ${p.target}`;
    // Four coarse answers cannot resolve nested exceptions or negative lists.
    // Omit such notices rather than turn an excluded industry into a match.
    if (/제외|불가|지원\s*불가|신청\s*불가/.test(text)) return false;
    if (/여성|장애인|재창업|재기|폐업|사회적기업|협동조합|소셜벤처|투자유치|수출\s*실적|인증\s*(기업|필수)|특허\s*보유/.test(text)) return false;
    if (!regionMatches(p, conditions) || !ageMatches(text, conditions.age) || !yearsMatches(p.target, conditions.business) || !industryMatches(text, conditions.industry)) return false;
    seen.add(p.id); return true;
  }).sort((a, b) => (a.applyEnd ?? "9999").localeCompare(b.applyEnd ?? "9999") || a.id.localeCompare(b.id));
}
