// 사업계획서 표준 항목(골격). K-Startup 등 정부지원사업의 일반 양식 기준.
// heading = 문서에 들어갈 격식 있는 제목, guide = 그 항목에 담을 내용(LLM용).
export interface PlanSection {
  key: string;
  heading: string;
  guide: string;
}

export const MISSING_INFO_PLACEHOLDER =
  "[보완 필요: 이 항목을 작성할 실제 정보를 입력해 주세요.\n예: 실제 일정, 자금 사용 계획, 담당 인력 등 확인된 정보를 입력]";

// 환각 가드(2026-07-14): "정보가 아예 없음"과 "있다는 암시는 있지만 구체값이 없음"은
// 다른 상황이다. 후자를 MISSING_INFO_PLACEHOLDER로 뭉뚱그리면 사용자가 "왜 보완하라는
// 건지" 이해하기 어렵고, LLM도 "그럴듯한 구체값"을 만들어내고 싶은 유혹이 더 크다
// (예: "반응이 좋다"는 말만 듣고 "재구독률 42%"를 지어내는 식). 이런 경우 전용 표시로
// 무엇이 왜 필요한지 명확히 남긴다.
export const PROOF_NEEDED_PLACEHOLDER =
  "[증거 보충 안내: 현재는 신청자가 설명한 내용을 토대로 초안을 작성했습니다. 제출 전 이 주장을 확인할 수 있는 자료를 덧붙이면 설득력이 높아집니다. 예: 매출·이용 데이터, 고객 대화 메모, 계약서·MOU, 사용 화면, 시험·특허·인증 확인서 중 해당하는 자료]";

export const FORM_TABLE_ENTRY_NOTICE = "[안내: 이 내용은 공식 양식의 해당 표에 옮겨 적어야 합니다.]";
export const REGION_INFO_PLACEHOLDER = "[보완 필요: 공고에서 요구하는 소재지 정보를 입력해 주세요]";

const MAX_FORM_TOC_ITEMS = 80;
const MAX_FORM_TOC_HEADING_LENGTH = 120;
const TABLE_ENTRY_HEADINGS = [
  "□ 신청현황",
  "□ 일반현황",
  "□ 창업아이템 개요(요약)",
];
const REGION_NOTICE_TARGET_HEADINGS = ["□ 일반현황", "□ 신청현황"];
const NON_CAPITAL_REGIONS = ["부산", "대구", "광주", "대전", "울산", "세종", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];
const CAPITAL_REGIONS = ["서울", "경기", "인천"];
const SIDO_REGIONS = [...CAPITAL_REGIONS, ...NON_CAPITAL_REGIONS];

export const PLAN_SECTIONS: PlanSection[] = [
  {
    key: "overview",
    heading: "1. 창업 아이템 개요",
    guide: "한 줄 정의, 핵심 고객 페르소나, 해결 문제, 제공 방식, 수익 구조, 현재 검증 수준, 12개월 핵심 목표를 요약.",
  },
  {
    key: "problem",
    heading: "2. 문제인식 (배경 및 필요성)",
    guide: "핵심 고객 페르소나, 문제 발생 장면·빈도·비용, 기존 대안의 한계, 문제를 입증하는 사용자 증거, 출처 있는 TAM/SAM/SOM.",
  },
  {
    key: "solution",
    heading: "3. 실현 가능성 (해결방안 및 차별성)",
    guide: "문제별 해결 기능, 경쟁사·대체재 비교, MVP·고객·매출 검증, 기술·운영 구현 방식, 지식재산·규제 위험과 대응.",
  },
  {
    key: "growth",
    heading: "4. 성장 전략 (시장진입·사업화·자금계획)",
    guide: "고객 획득 채널, 가격·매출 구조, 단위경제(객단가·원가·마진·재구매), 12개월 월/분기 마일스톤·정량 KPI, 지원금 산출근거와 사업비 연결.",
  },
  {
    key: "team",
    heading: "5. 팀 구성 및 역량",
    guide: "대표·팀 역할, 관련 경험과 증빙, 실행 실적, 외부 파트너, 부족 역량의 채용·협업 계획과 담당 시점.",
  },
];

export function sanitizeFormToc(headings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of headings) {
    if (typeof raw !== "string") continue;
    const heading = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!heading || heading.length > MAX_FORM_TOC_HEADING_LENGTH) continue;
    if (seen.has(heading)) continue;
    seen.add(heading);
    out.push(heading);
    if (out.length >= MAX_FORM_TOC_ITEMS) break;
  }

  return out;
}

export function formTocToPlanSections(formToc: string[]): PlanSection[] | null {
  const headings = sanitizeFormToc(formToc);
  if (headings.length === 0) return null;

  return headings.map((heading, index) => ({
    key: `formtoc-${index + 1}`,
    heading,
    guide: formTocGuide(heading, index, headings.length),
  }));
}

// 공식 양식 제목은 유지하되, 제목 키워드에 맞는 심사 체크포인트를 작성 프롬프트에 보강한다.
export function reviewChecklistForHeading(heading: string): string[] {
  const norm = normalizeHeadingForMatch(heading);
  const checks: string[] = [
    "핵심 주장마다 대화·첨부에서 확인된 근거를 붙이고, 없는 사실은 보완/증빙 표시",
    "같은 실적이나 장점을 다른 표현으로 반복하지 않고 이 항목에 필요한 내용만 배치",
  ];
  if (/개요|요약|아이템/.test(norm)) {
    checks.push("한 줄 정의·핵심 고객·문제·해결·수익 구조·현재 검증·12개월 목표를 빠짐없이 요약");
  }
  if (/문제|필요성|배경|시장/.test(norm)) {
    checks.push("고객 페르소나와 실제 문제 발생 장면, 기존 대안의 한계, 사용자 증거를 연결");
    checks.push("TAM·SAM·SOM은 출처·기준연도·산식이 있는 값만 사용하고 없으면 증빙 필요 표시");
  }
  if (/해결|실현|기술|제품|서비스|차별|경쟁/.test(norm)) {
    checks.push("경쟁사·대체재를 동일 기준으로 비교하고 기능 나열이 아니라 고객 가치 차이를 설명");
    checks.push("MVP·유료고객·매출·반복구매 등 현재 검증과 앞으로 할 일을 구분");
  }
  if (/성장|사업화|시장진입|수익|자금|예산|일정|추진/.test(norm)) {
    checks.push("가격·매출 구조·객단가·원가·마진·재구매를 연결하고 모르는 수치는 만들지 않음");
    checks.push("12개월 마일스톤을 시점·산출물·정량 KPI·담당으로 작성하고 예산 산출근거와 연결");
  }
  if (/팀|인력|대표|역량|조직/.test(norm)) {
    checks.push("역할별 책임·관련 경험·증빙 가능한 실적, 부족 역량의 채용·협업 시점을 구분");
  }
  if (/평가|배점|선정/.test(norm)) {
    checks.push("공고 평가항목·배점별 주장과 증거를 대응시키고 치명·중요·보완 위험을 구분");
  }
  return checks;
}

// 실 양식 3종 검증(2026-07-14)에서 "창업 아이템"(띄어씀) vs "창업아이템"(붙여씀) 같은
// 띄어쓰기 변형으로 정확일치가 깨지는 걸 발견 — 공백 제거 후 비교해 흡수한다.
function normalizeHeadingForMatch(h: string): string {
  return h.replace(/\s+/g, "");
}
export function isFormTableEntryHeading(heading: string): boolean {
  const norm = normalizeHeadingForMatch(heading);
  return TABLE_ENTRY_HEADINGS.some((h) => normalizeHeadingForMatch(h) === norm);
}

export function isRegionNoticeTargetHeading(heading: string): boolean {
  const norm = normalizeHeadingForMatch(heading);
  return REGION_NOTICE_TARGET_HEADINGS.some((h) => normalizeHeadingForMatch(h) === norm);
}

export function preferredRegionNoticeHeading(headings: string[]): string | null {
  for (const h of REGION_NOTICE_TARGET_HEADINGS) {
    if (headings.some((x) => normalizeHeadingForMatch(x) === normalizeHeadingForMatch(h))) return h;
  }
  return null;
}

export function ensureFormTableNotice(heading: string, content: string): string {
  if (!isFormTableEntryHeading(heading)) return content;
  const body = content.trim();
  if (body.startsWith(FORM_TABLE_ENTRY_NOTICE)) return body;
  return body ? `${FORM_TABLE_ENTRY_NOTICE}\n\n${body}` : FORM_TABLE_ENTRY_NOTICE;
}

export function ensureConditionalRegionNotice(
  heading: string,
  content: string,
  notice: string | null,
  targetHeading: string | null,
): string {
  const cleaned = content.replace(new RegExp(escapeRegExp(REGION_INFO_PLACEHOLDER), "g"), "").replace(/\n{3,}/g, "\n\n").trim();
  if (!notice || !targetHeading || heading.trim() !== targetHeading.trim()) return cleaned;
  if (cleaned.includes(notice)) return cleaned;
  return cleaned ? `${cleaned}\n\n${notice}` : notice;
}

export function extractBusinessRegion(text: string, fallback?: string | null): string | null {
  const candidates = [fallback ?? "", text].join("\n");
  if (/전국/.test(fallback ?? "")) return null;
  for (const region of SIDO_REGIONS) {
    if (new RegExp(`(사업\\s*소재지|소재지|사업장|본사|공장|지역)\\s*[:：]?\\s*[^\\n]{0,12}${region}`).test(candidates)) {
      return region;
    }
  }
  if (fallback && fallback.trim()) return fallback.trim().slice(0, 2);
  return null;
}

export function buildRegionNotice(requirementText: string, userRegion: string | null): string | null {
  const text = requirementText.replace(/\s+/g, " ");
  const basis = regionBasis(text);
  const nonCapital = /비수도권|수도권\s*(외|제외)|서울[·,\s]*경기[·,\s]*인천\s*제외|서울·경기·인천\s*제외/.test(text);
  if (nonCapital) {
    if (!userRegion) return `[보완 필요: 신청 마감일 기준 ${basis} 비수도권에 소재하는지 확인할 정보를 입력해 주세요.]`;
    if (CAPITAL_REGIONS.includes(userRegion)) {
      return `[지역 자격 확인 필요: 입력한 사업 소재지(${userRegion})가 비수도권 요건을 충족하지 못할 수 있습니다. 공고의 ${basis} 소재지 기준을 확인해 주세요.]`;
    }
    return null;
  }

  const specific = specificRegionRequirement(text);
  if (specific) {
    if (!userRegion) return `[보완 필요: 신청 마감일 기준 ${basis} ${specific}에 소재하는지 확인할 정보를 입력해 주세요.]`;
    if (userRegion !== specific) {
      return `[지역 자격 확인 필요: 입력한 사업 소재지(${userRegion})가 ${specific} 소재 요건을 충족하는지 확인해 주세요.]`;
    }
    return null;
  }

  if (/전국/.test(text)) return null;
  return null;
}

function formTocGuide(heading: string, index: number, total: number): string {
  const base = [
    `공식 양식 목차의 ${index + 1}/${total}번째 항목입니다.`,
    "항목명 원문과 순서를 유지하고, 이 항목에 해당하는 내용만 작성하세요.",
    `사용자가 실제로 제공한 근거가 부족하면 ${MISSING_INFO_PLACEHOLDER} 표시를 남기세요.`,
  ];
  if (!isFormTableEntryHeading(heading)) return base.join(" ");
  return [
    ...base,
    "이 항목은 장문 본문이 아니라 공식 양식 표에 옮겨 적을 간결한 입력 초안입니다.",
    "사업자등록일, 매출, 투자금액, 직원 수, 고객 수 등 입력에 없는 숫자는 절대 만들지 마세요.",
    "사업 소재지는 사용자가 실제 입력한 지역만 쓰고, 지역 자격 보완 문구는 시스템이 별도로 한 번만 표시합니다.",
  ].join(" ");
}

function regionBasis(text: string): string {
  const found = ["본사", "사업장", "공장"].filter((word) => text.includes(word));
  if (found.length > 0) return `${found.join(" 또는 ")}이`;
  return "본사 또는 사업장이";
}

function specificRegionRequirement(text: string): string | null {
  for (const region of SIDO_REGIONS) {
    const re = new RegExp(`${region}(광역시|특별시|특별자치시|특별자치도|도)?[^\\n]{0,20}(소재|본사|사업장|공장|기업|창업기업|중소기업|대상|한정)`);
    if (re.test(text)) return region;
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
