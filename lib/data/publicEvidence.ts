export type PublicEvidenceStage = "step5" | "step6";
export type PublicEvidenceAvailability =
  | "available"
  | "application_required"
  | "manual_only";

export interface PublicEvidenceItem {
  id: string;
  stage: PublicEvidenceStage;
  kind: "program" | "statistics" | "dataset" | "research" | "company" | "patent" | "license";
  title: string;
  institution: string;
  officialUrl: string;
  why: string;
  useFor: string;
  availability: PublicEvidenceAvailability;
  accessNote: string;
  citationNote: string;
  searchTemplate: string;
  tags: string[];
  checkedAt: string;
  autoCollect: boolean;
}

const CHECKED_AT = "2026-08-31";

// 작성 프롬프트와 화면이 같은 카탈로그를 쓴다.
// '검증된 사실'이 아니라 '검색·확인할 공식 후보'이며, 숫자나 정책 문장은
// 사용자가 원문을 가져온 뒤에만 사업계획서에 인용해야 한다.
export const PUBLIC_EVIDENCE_ITEMS: PublicEvidenceItem[] = [
  {
    id: "bojo-programs",
    stage: "step5",
    kind: "program",
    title: "e나라도움 국고보조금 공모사업",
    institution: "기획예산처·공공데이터포털",
    officialUrl: "https://www.data.go.kr/data/15156853/openapi.do",
    why: "K-Startup에 없는 문화·관광·환경·농업·지역 보조금 공모를 보강합니다.",
    useFor: "지금 신청할 수 있는 민간기업·사업자 대상 공모 탐색",
    availability: "application_required",
    accessNote: "무료·자동승인이지만 공공데이터포털 활용신청과 서비스키가 필요합니다.",
    citationNote: "공고명·주관기관·접수마감일·원문 URL을 표시합니다.",
    searchTemplate: "{field} 지원대상",
    tags: ["보조금", "공모", "문화", "관광", "환경", "농업", "지역", "법인"],
    checkedAt: CHECKED_AT,
    autoCollect: true,
  },
  {
    id: "ntis-announcements",
    stage: "step5",
    kind: "program",
    title: "NTIS 국가R&D 통합공고",
    institution: "국가과학기술지식정보서비스",
    officialUrl: "https://www.ntis.go.kr/ThSearchResultAnnouncementList.do",
    why: "범부처 R&D·기술개발·실증 공고를 확인하는 공식 검색창입니다.",
    useFor: "기업이 주관·공동기관으로 신청할 수 있는 R&D 공고 원문 확인",
    availability: "manual_only",
    accessNote:
      "통합공고 전용 대국민 OpenAPI는 확인되지 않았습니다. NTIS OpenAPI는 로그인·소속기관 확인 후 승인이 필요하므로 자동수집을 꺼 둔 상태입니다.",
    citationNote: "NTIS 출처와 공고 원문 URL을 명시하고, 이용 승인 범위를 준수합니다.",
    searchTemplate: "{field} 기업 주관 R&D",
    tags: ["R&D", "연구개발", "기술개발", "실증", "AI", "특허", "과제"],
    checkedAt: CHECKED_AT,
    autoCollect: false,
  },
  {
    id: "kosis",
    stage: "step6",
    kind: "statistics",
    title: "KOSIS 국가통계포털",
    institution: "통계청",
    officialUrl: "https://kosis.kr/",
    why: "인구·사업체 수·산업 현황처럼 심사에서 검증할 수 있는 숫자를 찾는 기본 출처입니다.",
    useFor: "고객 규모, 사업체 수, 지역별·연령별 수요 근거",
    availability: "available",
    accessNote: "검색은 바로 가능하며, 선택한 통계표의 기준연도·단위를 반드시 함께 확인합니다.",
    citationNote: "통계표명·제공기관·기준연도·단위·URL을 표시합니다.",
    searchTemplate: "{field} 사업체 수",
    tags: ["시장", "고객", "인구", "사업체", "매출", "지역", "수요", "규모"],
    checkedAt: CHECKED_AT,
    autoCollect: false,
  },
  {
    id: "public-data-portal",
    stage: "step6",
    kind: "dataset",
    title: "공공데이터포털",
    institution: "행정안전부·한국지능정보사회진흥원",
    officialUrl: "https://www.data.go.kr/",
    why: "제품·서비스에 실제로 쓸 수 있는 공공 API·파일데이터를 확인합니다.",
    useFor: "제품 구현 데이터, 지역·시설·교통·관광·보건 등 공식 데이터 근거",
    availability: "available",
    accessNote: "파일은 바로 받을 수 있지만 OpenAPI는 데이터별 활용신청·승인 여부가 다릅니다.",
    citationNote: "데이터명·보유기관·기준일·이용허락범위·URL을 표시합니다.",
    searchTemplate: "{field} 공공데이터 API",
    tags: ["AI", "데이터", "API", "교통", "관광", "보건", "농업", "환경", "재난", "안전"],
    checkedAt: CHECKED_AT,
    autoCollect: false,
  },
  {
    id: "ntis-research",
    stage: "step6",
    kind: "research",
    title: "NTIS 국가R&D 과제·성과",
    institution: "국가과학기술지식정보서비스",
    officialUrl: "https://www.ntis.go.kr/rndopen/api/mng/apiMain.do",
    why: "기존 국가R&D 과제·논문·특허·연구보고서를 찾아 기술 필요성과 선행연구를 확인합니다.",
    useFor: "R&D 필요성, 선행과제, 기술동향, 유사 성과 근거",
    availability: "application_required",
    accessNote: "대국민용 API도 NTIS 로그인과 소속기관 확인 후 활용신청·승인이 필요합니다.",
    citationNote: "NTIS 출처·과제명·기준연도·URL을 명시하고 승인된 용도 범위를 준수합니다.",
    searchTemplate: "{field} 국가R&D 과제",
    tags: ["R&D", "연구", "기술", "실증", "특허", "AI", "제조", "소재"],
    checkedAt: CHECKED_AT,
    autoCollect: false,
  },
  {
    id: "kogl-ai",
    stage: "step6",
    kind: "license",
    title: "공공누리 AI유형",
    institution: "한국문화정보원",
    officialUrl: "https://www.kogl.or.kr/info/licenseTypeAi.do",
    why: "공공저작물을 AI 학습에 쓸 수 있는지와 직접 인용 시 조건을 확인합니다.",
    useFor: "AI 학습데이터 활용계획과 저작권·출처 준수계획",
    availability: "available",
    accessNote: "AI유형이 표시된 저작물에만 적용되며, 일반 이용은 함께 표시된 기존 공공누리 조건을 따릅니다.",
    citationNote: "RAG 등으로 원문을 직접 인용할 때는 출처명시 조치를 두고 재판매 금지 조건을 확인합니다.",
    searchTemplate: "{field} AI유형 공공저작물",
    tags: ["AI", "저작권", "콘텐츠", "문화", "학습데이터", "RAG", "데이터"],
    checkedAt: CHECKED_AT,
    autoCollect: false,
  },
  {
    id: "opendart",
    stage: "step6",
    kind: "company",
    title: "OpenDART 기업공시",
    institution: "금융감독원",
    officialUrl: "https://opendart.fss.or.kr/",
    why: "공시대상 경쟁사의 매출·사업내용·투자 현황을 추측이 아닌 공식 공시로 확인합니다.",
    useFor: "경쟁사 매출·사업구조·투자·주요 고객 근거",
    availability: "application_required",
    accessNote: "공시 검색은 가능하고, OpenAPI 자동활용은 인증키 발급이 필요합니다.",
    citationNote: "회사명·공시명·공시일·보고서 기준연도·URL을 표시합니다.",
    searchTemplate: "{field} 경쟁사 사업보고서",
    tags: ["경쟁사", "매출", "재무", "투자", "B2B", "시장", "상장사"],
    checkedAt: CHECKED_AT,
    autoCollect: false,
  },
  {
    id: "kipris-plus",
    stage: "step6",
    kind: "patent",
    title: "KIPRIS Plus",
    institution: "특허청·한국특허정보원",
    officialUrl: "https://plus.kipris.or.kr/",
    why: "유사 특허·상표·디자인을 확인해 기술 차별성을 과장 없이 설명합니다.",
    useFor: "유사 특허, 기술분류, 권리자, 출원·등록 현황 근거",
    availability: "application_required",
    accessNote: "검색과 API 제공 범위가 다르므로 자동활용 전 신청·이용조건을 확인합니다.",
    citationNote: "공개번호·발명명·출원인·기준일·URL을 표시합니다.",
    searchTemplate: "{field} 유사 특허",
    tags: ["특허", "기술", "차별성", "상표", "디자인", "R&D", "제조"],
    checkedAt: CHECKED_AT,
    autoCollect: false,
  },
];

export function getPublicEvidenceItems(stage?: PublicEvidenceStage): PublicEvidenceItem[] {
  return stage ? PUBLIC_EVIDENCE_ITEMS.filter((item) => item.stage === stage) : PUBLIC_EVIDENCE_ITEMS;
}

export function rankPublicEvidenceItems(
  query: string,
  stage: PublicEvidenceStage = "step6",
  limit = 5,
): PublicEvidenceItem[] {
  const haystack = query.toLowerCase().replace(/\s+/g, " ");
  return getPublicEvidenceItems(stage)
    .map((item, index) => ({
      item,
      index,
      score: item.tags.reduce(
        (sum, tag) => sum + (haystack.includes(tag.toLowerCase()) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, limit))
    .map(({ item }) => item);
}

export function suggestedEvidenceQuery(item: PublicEvidenceItem, field: string): string {
  const safeField = field.trim().replace(/\s+/g, " ").slice(0, 60) || "내 사업 분야";
  return item.searchTemplate.replace("{field}", safeField);
}

export function buildPublicEvidencePrompt(query: string): string {
  const candidates = rankPublicEvidenceItems(query, "step6", 5)
    .map(
      (item) =>
        `- ${item.title}(${item.institution}): ${item.useFor} / ${item.officialUrl} / ${item.accessNote}`,
    )
    .join("\n");

  return `[공식 근거 후보 — 검색·확인 후에만 인용]
${candidates}

- 이 목록은 '사실로 확인된 내용'이 아니라 '확인할 공식 출처 후보'입니다.
- 사용자가 원문·통계표·캡처를 가져오기 전에는 구체적인 수치·정책·기업 사실을 새로 만들거나 사업계획서에 단정하지 마세요.
- 인용할 때는 자료명·기관·기준연도·URL·이용조건·최종 확인일을 함께 남기세요.
- '개방 예정'과 '현재 이용 가능'을 구분하고, 확인하지 못한 내용은 [확인 필요]로 남기세요.`;
}
