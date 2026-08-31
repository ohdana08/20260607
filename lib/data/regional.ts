import type { Program } from "@/lib/match/types";
import { decodeEntities } from "./decodeEntities.ts";

export interface RegionalNotice {
  id: string;
  title: string;
  agency: string;
  supportField?: string;
  target?: string;
  region: string;
  applyEnd: string | null;
  url: string;
}

export interface RegionalSourcePolicy {
  id: string;
  region: string;
  name: string;
  url: string;
  status: "active" | "permission-required";
  reason: string;
}

// 지역 포털은 기술적으로 읽을 수 있는지뿐 아니라 재이용 약관까지 통과한 경우에만
// 운영 수집기에 넣는다. 부산·인천은 공개 목록의 상업적 재사용 제한을 확인해 보류한다.
export const REGIONAL_SOURCE_POLICIES: readonly RegionalSourcePolicy[] = [
  {
    id: "egbiz",
    region: "경기",
    name: "경기기업비서",
    url: "https://www.egbiz.or.kr/sp/supportPrjOutsideList.do",
    status: "active",
    reason: "robots.txt가 공개 지원사업 경로를 허용하며 자체 경기도 공고 구간만 최소 수집",
  },
  {
    id: "busanstartup",
    region: "부산",
    name: "부산창업포털",
    url: "https://www.busanstartup.kr/biz_sup/",
    status: "permission-required",
    reason: "이용약관상 서비스 자료의 상업적 가공·사용 제한을 확인해 API 또는 서면 허용 필요",
  },
  {
    id: "bizok",
    region: "인천",
    name: "BizOK",
    url: "https://bizok.incheon.go.kr/open_content/support.do",
    status: "permission-required",
    reason: "이용약관상 게시물의 타 사이트 사용·인용과 상업적 유통 제한을 확인해 허용 필요",
  },
] as const;

export function cleanRegionalText(value: string | undefined): string {
  return decodeEntities((value ?? "").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeRegionalDate(value: string | undefined): string | null {
  if (!value) return null;
  const fourDigit = value.match(/(20\d{2})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
  if (fourDigit) {
    return `${fourDigit[1]}-${fourDigit[2].padStart(2, "0")}-${fourDigit[3].padStart(2, "0")}`;
  }
  const twoDigit = value.match(/(?:^|\D)(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\D|$)/);
  if (!twoDigit) return null;
  return `20${twoDigit[1]}-${twoDigit[2].padStart(2, "0")}-${twoDigit[3].padStart(2, "0")}`;
}

export function regionalPeriodEnd(period: string | undefined): string | null {
  if (!period || /예산\s*소진|상시|수시/.test(period)) return null;
  const parts = period.split(/\s*(?:~|∼|－|-)\s*/);
  if (parts.length >= 2) {
    const end = normalizeRegionalDate(parts.slice(-3).join("-"));
    if (end) return end;
  }
  const dates = period.match(/(?:20)?\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/g);
  return normalizeRegionalDate(dates?.at(-1));
}

export function inferRegionalSupportField(title: string): string {
  const text = title.toLowerCase();
  if (/융자|정책자금|보증|이차보전|금융/.test(text)) return "정책자금";
  if (/r&d|연구개발|기술개발|실증|시험인증|시제품/.test(text)) return "R&D·기술";
  if (/수출|해외|전시회|시장개척|바이어|판로|마케팅/.test(text)) return "판로·해외진출";
  if (/입주|공간|보육센터|공유오피스/.test(text)) return "시설·공간";
  if (/컨설팅|클리닉|멘토링|전문가\s*상담/.test(text)) return "멘토링·컨설팅";
  if (/교육|아카데미|세미나|특강|훈련/.test(text)) return "교육";
  if (/인증|유망기업|우수기업/.test(text)) return "인증·제도";
  if (/창업|사업화|바우처|기업지원|지원사업/.test(text)) return "사업화";
  return "기타 지원";
}

// 조달·채용·수행기관 선정 등은 지원받으려는 대표자의 공고가 아니므로 추천 풀에서 제외한다.
export function isLikelyRegionalApplicantSupport(title: string): boolean {
  const text = cleanRegionalText(title);
  if (!text) return false;
  return !/(?:운영|행사|전시)\s*대행사\s*모집|용역\s*(?:입찰|공고)|입찰\s*공고|평가위원|심사위원|유공\s*후보자|포상\s*후보자|수행기관\s*모집|주관기관\s*모집/.test(
    text,
  );
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function regionalNoticeToProgram(
  notice: RegionalNotice,
  source: Program["source"],
): Program | null {
  const title = cleanRegionalText(notice.title);
  if (!isLikelyRegionalApplicantSupport(title)) return null;
  const agency = cleanRegionalText(notice.agency) || "지역 지원기관";
  const supportField = notice.supportField || inferRegionalSupportField(title);
  return {
    id: `${source}:${notice.id}`,
    title,
    summary: clip(`${agency} 주관 ${supportField} 공고입니다. 세부 자격과 제출서류는 공고 원문에서 확인하세요.`, 220),
    target: clip(notice.target || `${notice.region} 소재 기업·소상공인·예비창업자(세부 자격은 원문 확인)`, 140),
    supportField,
    region: notice.region,
    applyEnd: notice.applyEnd,
    url: notice.url,
    formUrl: null,
    source,
  };
}
