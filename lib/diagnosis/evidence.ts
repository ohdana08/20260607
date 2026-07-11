// 합격 가능성 진단 (2026-07-10 확정 설계) — 사람 분석이 아니라 사업 분석.
// 버튼식 2화면(월매출 + 확보 실적) → 진단지 전부 무료 공개. LLM 호출 0회.
// 체크항목→평가항목 매핑의 원본은 Supabase evidence_map 테이블(bcc-admin에서 수정).
// ⚠️ 매핑값을 이 파일에 하드코딩하지 말 것 — 표시용 문장만 여기 둔다.

// 화면 1: 월 평균 매출 (단일선택)
export const REVENUE_OPTIONS = [
  "없음",
  "100만원 미만",
  "100~500만원",
  "500~1,000만원",
  "1,000만원 이상",
  "5,000만원 이상",
] as const;

// 화면 2: "해당 없음"은 다른 항목과 배타 선택
export const NONE_ITEM = "해당 없음";

// evidence_map 한 행 (API /api/evidence-map 응답)
export interface EvidenceRow {
  item: string;
  market: boolean; // 시장성
  growth: boolean; // 성장성
  feasibility: boolean; // 실현가능성
  capability: boolean; // 사업화 역량
}

export const CATEGORY_LABELS = {
  market: "시장성",
  growth: "성장성",
  feasibility: "실현가능성",
  capability: "사업화 역량",
} as const;
export type CategoryKey = keyof typeof CATEGORY_LABELS;
export const CATEGORY_KEYS: CategoryKey[] = ["market", "growth", "feasibility", "capability"];

// 진단지 강점 문장 — 표시용 카피(매핑값 아님). 관리자가 새 항목을 추가하면 아래 fallback 사용.
const STRENGTH_SENTENCES: Record<string, string> = {
  "실제 매출 발생": "실제 매출이 발생하고 있습니다",
  "유료 고객 확보": "돈을 내는 고객을 확보했습니다",
  "거래처 계약": "거래처 계약을 보유하고 있습니다",
  "반복 구매 고객": "다시 찾아오는 반복 구매 고객이 있습니다",
  "직원 고용": "직원을 고용해 조직을 운영하고 있습니다",
  "특허·상표권": "특허·상표권을 보유하고 있습니다",
  "인증": "인증을 보유하고 있습니다",
  "투자유치": "투자를 유치한 경험이 있습니다",
  "수출 실적": "수출 실적이 있습니다",
  "언론 보도": "언론에 보도된 적이 있습니다",
  "수상 경력": "수상 경력이 있습니다",
  "정부지원사업 수행 경험": "정부지원사업을 수행해 본 경험이 있습니다",
};
export function strengthSentence(item: string): string {
  return STRENGTH_SENTENCES[item] ?? `'${item}' 실적을 보유하고 있습니다`;
}

// 진단지 = 강점(체크 항목 → 매핑표 자동 생성) + 보완(근거 0건 평가항목만)
export interface EvidenceSheet {
  strengths: { item: string; sentence: string; tags: string[] }[];
  gaps: string[]; // 근거 0건인 평가항목 라벨
}

export function buildSheet(rows: EvidenceRow[], checkedItems: string[]): EvidenceSheet {
  const covered = new Set<CategoryKey>();
  const strengths: EvidenceSheet["strengths"] = [];
  for (const item of checkedItems) {
    if (item === NONE_ITEM) continue;
    const row = rows.find((r) => r.item === item);
    const tags = row ? CATEGORY_KEYS.filter((k) => row[k]) : [];
    tags.forEach((t) => covered.add(t));
    strengths.push({
      item,
      sentence: strengthSentence(item),
      tags: tags.map((t) => CATEGORY_LABELS[t]),
    });
  }
  const gaps = CATEGORY_KEYS.filter((k) => !covered.has(k)).map((k) => CATEGORY_LABELS[k]);
  return { strengths, gaps };
}

// 분기 규칙: '해당 없음' 단독 or 매출 '없음'+실적 0개 → pre (실적 만드는 공고 안내)
// 화면 2는 최소 1개 선택을 강제하므로, 실질 실적(해당 없음 제외)이 0개면 pre.
export function isPreStage(checkedItems: string[]): boolean {
  return checkedItems.filter((i) => i !== NONE_ITEM).length === 0;
}

// 보완할 부분 고정 항목 (근거 0건 평가항목 뒤에 항상 표시)
export const FIXED_GAPS = [
  "성과의 문서화 — 매출·계약 등 가진 실적을 증빙 서류로 정리하기",
  "자금 활용 계획 구체화 — 지원금을 어디에 어떻게 쓸지 숫자로 보여주기",
];

// 마무리 고정 문구 (확정 카피 — 수정 금지)
export const SHEET_CLOSING =
  "사업의 기반은 이미 갖춰져 있습니다. 필요한 것은 새 성과가 아니라, 이미 있는 성과를 심사위원이 이해하는 문서로 정리하는 것입니다.";
