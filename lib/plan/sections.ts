// 사업계획서 표준 항목(골격). K-Startup 등 정부지원사업의 일반 양식 기준.
// heading = 문서에 들어갈 격식 있는 제목, guide = 그 항목에 담을 내용(LLM용).
export interface PlanSection {
  key: string;
  heading: string;
  guide: string;
}

export const MISSING_INFO_PLACEHOLDER =
  "[보완 필요: 이 항목을 작성할 실제 정보를 입력해 주세요.\n예: 실제 일정, 자금 사용 계획, 담당 인력 등 확인된 정보를 입력]";

export const FORM_TABLE_ENTRY_NOTICE = "[안내: 이 내용은 공식 양식의 해당 표에 옮겨 적어야 합니다.]";
export const REGION_INFO_PLACEHOLDER = "[보완 필요: 공고에서 요구하는 소재지 정보를 입력해 주세요]";

const MAX_FORM_TOC_ITEMS = 80;
const MAX_FORM_TOC_HEADING_LENGTH = 120;
const TABLE_ENTRY_HEADINGS = [
  "□ 신청현황",
  "□ 일반현황",
  "□ 창업아이템 개요(요약)",
];

export const PLAN_SECTIONS: PlanSection[] = [
  {
    key: "overview",
    heading: "1. 창업 아이템 개요",
    guide: "어떤 제품/서비스인지, 한눈에 들어오게 요약. 무엇을 누구에게 어떻게 제공하는지.",
  },
  {
    key: "problem",
    heading: "2. 문제인식 (배경 및 필요성)",
    guide: "어떤 불편/문제를 해결하는지, 왜 지금 필요한지, 누가 겪는 문제인지(목표 고객).",
  },
  {
    key: "solution",
    heading: "3. 실현 가능성 (해결방안 및 차별성)",
    guide: "어떻게 해결하는지, 기존/경쟁 대비 차별점, 현재까지 진행한 것이나 실현 근거.",
  },
  {
    key: "growth",
    heading: "4. 성장 전략 (시장진입·사업화·자금계획)",
    guide: "어떻게 알리고 팔지, 어떻게 수익을 내는지, 받은 지원금/자금을 어디에 쓸지, 향후 1년 계획.",
  },
  {
    key: "team",
    heading: "5. 팀 구성 및 역량",
    guide: "대표자/팀의 강점과 이 사업을 해낼 수 있는 이유, 부족한 부분은 어떻게 보완하는지.",
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

export function isFormTableEntryHeading(heading: string): boolean {
  return TABLE_ENTRY_HEADINGS.includes(heading.trim());
}

export function ensureFormTableNotice(heading: string, content: string): string {
  if (!isFormTableEntryHeading(heading)) return content;
  const body = content.trim();
  if (body.startsWith(FORM_TABLE_ENTRY_NOTICE)) return body;
  return body ? `${FORM_TABLE_ENTRY_NOTICE}\n\n${body}` : FORM_TABLE_ENTRY_NOTICE;
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
    `사업 소재지는 사용자가 실제 입력한 지역만 쓰고, 지역 정보가 부족하면 ${REGION_INFO_PLACEHOLDER} 표시를 남기세요.`,
  ].join(" ");
}
