import type { Program, Recommendation } from "@/lib/match/types";

// 딱지원핏의 핵심 제품 원칙:
// - 저장·판정·문서 생성에는 정부지원사업 원문 값을 그대로 사용한다.
// - 사용자가 선택하고 이해하는 화면에서는 같은 값을 생활 언어로 번역한다.
// - 최종 사업계획서에서만 공식 항목명과 심사용 표현을 사용한다.

export interface PlainOption {
  label: string;
  sub: string;
}

export const PLAIN_YEAR_OPTIONS: Record<string, PlainOption> = {
  예비창업: {
    label: "아직 사업자등록 전이에요",
    sub: "앞으로 사업을 시작할 계획이에요.",
  },
  "창업초기(3년 이내)": {
    label: "사업자등록한 지 3년이 안 됐어요",
    sub: "사업을 막 시작했거나 자리를 잡아가는 중이에요.",
  },
  "창업도약기(4~7년)": {
    label: "사업자등록한 지 4~7년 됐어요",
    sub: "지금보다 더 크게 키울 방법을 찾고 있어요.",
  },
  "7년 이상": {
    label: "사업자등록한 지 7년이 넘었어요",
    sub: "오래 운영한 사업에 맞는 도움을 찾고 있어요.",
  },
};

export const PLAIN_SUPPORT_OPTIONS: Record<string, PlainOption> = {
  사업화: {
    label: "제품을 만들고 팔아볼 돈이 필요해요",
    sub: "제품 제작, 홍보, 판매 준비에 드는 비용을 찾습니다.",
  },
  "R&D": {
    label: "새 기술이나 제품을 만들 돈이 필요해요",
    sub: "연구, 개발, 시험, 성능 개선에 드는 비용을 찾습니다.",
  },
  "시설·공간": {
    label: "일할 곳이나 장비가 필요해요",
    sub: "사무실, 공장, 입주 공간, 공동 장비를 찾습니다.",
  },
  "멘토링·교육": {
    label: "전문가 도움이나 교육이 필요해요",
    sub: "혼자 풀기 어려운 문제를 상담하거나 배우고 싶어요.",
  },
  "융자·보증": {
    label: "낮은 이자로 빌릴 돈이나 보증이 필요해요",
    sub: "지원금이 아니라 나중에 갚는 자금도 함께 찾습니다.",
  },
};

export const PLAIN_SECTOR_OPTIONS: Record<string, PlainOption> = {
  창업: {
    label: "사업을 처음 시작하거나 다시 시작하고 싶어요",
    sub: "처음 준비하는 사람이나 새 출발을 돕는 사업을 먼저 봅니다.",
  },
  경영: {
    label: "홍보·판매·사람 문제를 해결하고 싶어요",
    sub: "고객을 늘리고 사업 운영을 더 안정시키는 도움을 봅니다.",
  },
  기술: {
    label: "제품·기술·특허를 만들거나 고치고 싶어요",
    sub: "기술을 개발하고 시험하거나 권리를 지키는 도움을 봅니다.",
  },
  수출: {
    label: "해외에 팔아보고 싶어요",
    sub: "해외 고객, 전시회, 수출 준비를 돕는 사업을 봅니다.",
  },
  금융: {
    label: "사업을 운영할 돈을 마련하고 싶어요",
    sub: "대출, 보증, 투자처럼 자금을 마련하는 방법을 봅니다.",
  },
};

export function plainYearOption(value: string): PlainOption {
  return PLAIN_YEAR_OPTIONS[value] ?? { label: value, sub: "사업을 시작한 시기를 기준으로 확인합니다." };
}

export function plainSupportOption(value: string): PlainOption {
  return PLAIN_SUPPORT_OPTIONS[value] ?? { label: value, sub: "지금 필요한 도움과 가까운 사업을 먼저 봅니다." };
}

export function plainSectorOption(value: string): PlainOption {
  return PLAIN_SECTOR_OPTIONS[value] ?? { label: value, sub: "앞으로 해보고 싶은 일과 가까운 사업을 먼저 봅니다." };
}

export function plainEligibilityLabel(value: Recommendation["eligibility"]): string {
  return value === "확인 필요" ? "한 가지만 더 확인해요" : "지금 정보로는 신청해볼 만해요";
}

export function plainCheckReason(reason?: string): string | null {
  if (!reason) return null;
  return reason
    .replace(/업력 조건이 공고에 명시되지 않아 원문 확인 필요/g, "사업을 시작한 시기 조건이 안내문에 분명하지 않아요")
    .replace(/투자유치 실적 필요/g, "전에 투자를 받은 적이 있어야 해요")
    .replace(/사회적경제기업 대상/g, "사회적기업·협동조합 등에 해당해야 해요")
    .replace(/폐업 후 재창업자 대상/g, "전에 사업을 정리한 뒤 다시 시작하는 사람을 위한 사업이에요")
    .replace(/대상 제한 있음/g, "신청할 수 있는 사람에 제한이 있어요");
}

export function plainCondition(condition: string): string {
  if (/^💰/.test(condition)) return condition.replace(/^💰\s*/, "💰 받을 수 있는 금액: ");
  if (/^✓\s*전국(?:\s*공고)?$/.test(condition)) return "✓ 어느 지역에서나 신청할 수 있어요";
  if (/^✓\s*.+\s소재 대상$/.test(condition)) {
    return condition.replace(/^✓\s*(.+)\s소재 대상$/, "✓ $1에서 사업하면 볼 수 있어요");
  }
  if (/^✓\s*창업\s*.+\s충족$/.test(condition) || /^✓\s*예비창업\s*충족$/.test(condition) || /^✓\s*업력\s*.+\s충족$/.test(condition)) {
    return "✓ 사업을 시작한 시기가 맞아요";
  }
  if (/^✓\s*.+\s분야$/.test(condition)) return "✓ 앞으로 하려는 일과 가까워요";
  if (/^✓\s*(사업화|R&D|시설·공간|멘토링·교육|융자·보증)$/.test(condition)) {
    return "✓ 지금 필요한 도움과 가까워요";
  }
  if (condition.startsWith("⚠️")) {
    return `⚠️ ${plainCheckReason(condition.replace(/^⚠️\s*/, ""))}`;
  }
  return condition;
}

export function plainProgramExplanation(program: Program): string {
  const text = `${program.title} ${program.summary} ${program.supportField}`;
  if (/융자|대출|정책자금|보증/.test(text)) {
    return "사업에 필요한 돈을 비교적 낮은 부담으로 빌리거나, 대출받기 쉽도록 보증을 도와주는 사업이에요. 지원금과 달리 갚아야 할 수 있어요.";
  }
  if (/수출|해외|바이어|무역|글로벌|전시회/.test(text)) {
    return "해외에서 고객을 찾고 제품이나 서비스를 팔 수 있도록 준비 비용이나 전문가 도움을 주는 사업이에요.";
  }
  if (/R\s*&?\s*D|연구개발|기술개발|실증|시험|시제품/i.test(text)) {
    return "새 기술이나 제품을 만들고 시험하는 데 필요한 비용과 도움을 주는 사업이에요.";
  }
  if (/입주|공간|시설|사무실|공장|장비|스튜디오/.test(text)) {
    return "일할 공간이나 제품을 만들고 시험할 장비를 이용할 수 있도록 도와주는 사업이에요.";
  }
  if (/마케팅|판로|판매|홍보|브랜딩|온라인몰/.test(text)) {
    return "더 많은 고객에게 알리고 실제 판매로 이어지도록 홍보비나 판매 기회를 도와주는 사업이에요.";
  }
  if (/교육|멘토링|컨설팅|자문|아카데미/.test(text)) {
    return "사업을 운영하며 막힌 문제를 전문가와 풀거나 필요한 내용을 배울 수 있게 도와주는 사업이에요.";
  }
  return "사업을 시작하거나 키우는 데 필요한 비용·기회·전문가 도움을 제공하는 사업이에요. 정확한 지원 내용은 공식 안내문에서 함께 확인해 주세요.";
}

const EVIDENCE_ITEM_COPY: Record<string, string> = {
  "실제 매출 발생": "제품이나 서비스를 팔아 돈을 벌어본 적이 있어요",
  "유료 고객 확보": "실제로 돈을 낸 고객이 있어요",
  "거래처 계약": "거래처와 계약한 적이 있어요",
  "반복 구매 고객": "한 번 산 뒤 다시 찾아온 고객이 있어요",
  "직원 고용": "대표님 말고 함께 일하는 직원이 있어요",
  "특허·상표권": "특허나 상표를 등록했어요",
  인증: "제품이나 회사와 관련된 인증서가 있어요",
  투자유치: "다른 회사나 투자자에게 사업자금을 받은 적이 있어요",
  "수출 실적": "해외 고객에게 팔아본 적이 있어요",
  "언론 보도": "신문·방송·온라인 매체에 소개된 적이 있어요",
  "수상 경력": "사업이나 제품으로 상을 받은 적이 있어요",
  "정부지원사업 수행 경험": "정부나 기관의 사업비를 받아 일을 끝내본 적이 있어요",
};

export function plainEvidenceItem(item: string): string {
  return EVIDENCE_ITEM_COPY[item] ?? item;
}

const EVIDENCE_CATEGORY_COPY: Record<string, string> = {
  시장성: "사려는 사람이 있다는 근거",
  성장성: "앞으로 더 커질 수 있다는 근거",
  실현가능성: "실제로 만들고 해낼 수 있다는 근거",
  "사업화 역량": "사업을 꾸준히 운영할 수 있다는 근거",
};

export function plainEvidenceCategory(category: string): string {
  return EVIDENCE_CATEGORY_COPY[category] ?? category;
}

export function plainGap(gap: string): string {
  if (gap === "시장성") return "돈을 내거나 써보겠다는 고객의 반응";
  if (gap === "성장성") return "고객·매출이 늘고 있다는 기록";
  if (gap === "실현가능성") return "제품이나 서비스를 실제로 만들고 제공한 결과";
  if (gap === "사업화 역량") return "대표와 팀이 이 일을 해낼 수 있다는 경험";
  if (gap.startsWith("성과의 문서화")) return "매출·계약처럼 이미 만든 결과를 날짜와 숫자가 보이는 자료로 정리하기";
  if (gap.startsWith("자금 활용 계획 구체화")) return "받은 돈을 어디에 얼마씩 쓸지 적어보기";
  return gap;
}

export const PLAIN_LANGUAGE_PROMPT = `[사용자에게 말하는 언어 — 반드시 지킬 것]
- 사용자는 정부지원사업 용어를 모른다고 가정하세요. 사용자가 자기 사업을 공부해 와야 이해할 수 있는 표현은 쓰지 마세요.
- 내부 판단에는 공식 용어를 써도 되지만 사용자에게는 생활 언어로 번역하세요.
- 다음 표현은 그대로 쓰지 말고 바꿔 말하세요:
  · 업력 → "사업자등록한 지 얼마나 됐는지"
  · 사업화 → "제품을 만들고 실제로 팔아보는 일"
  · 시장 검증 → "돈을 내거나 써보겠다는 고객 반응"
  · 수익모델/BM → "누가 언제 얼마를 내는지"
  · 정량지표/KPI → "언제까지 만들 숫자 목표"
  · TAM·SAM·SOM/시장규모 → "살 가능성이 있는 사람이 얼마나 되는지"
  · 수행역량/보유역량 → "왜 대표님과 팀이 이 일을 해낼 수 있는지"
  · 판로 → "제품이나 서비스를 팔 곳"
  · 실증 → "실제 현장에서 써보고 효과를 확인하는 일"
  · 자부담금 → "지원금과 함께 대표님이 직접 내야 하는 돈"
- 공식 용어가 꼭 필요하면 쉬운 설명을 먼저 하고 괄호 안에 한 번만 적으세요.
- 한 문장은 짧게, 한 번에 질문 하나만, 예시는 사용자의 사실처럼 섞지 마세요.`;
