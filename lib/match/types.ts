// A normalized government support program, regardless of source.
export interface Program {
  id: string;
  title: string;
  summary: string; // 사업 개요 (간단)
  target: string; // 지원대상 원문
  supportField: string; // 지원분야
  region: string; // 지원지역 (예: 전국, 서울)
  applyEnd: string | null; // 마감일 (YYYY-MM-DD) 또는 상시(null)
  url: string; // 공고 상세/신청 페이지
  formUrl: string | null; // 사업계획서 양식 다운로드 (있으면)
  source: "kstartup" | "bizinfo" | "bizinfo-event" | "nipa" | "kocca" | "smtech" | "sample";
}

// One recommended program with a plain-language explanation.
export interface Recommendation {
  program: Program;
  whatItIs: string; // 이 사업이 실제로 뭘 해주는지 — 쉬운 설명
  fitReason: string; // 왜 이 사람에게 맞는지 — 일상어
  // 참여 가능성 — "조건 충족"(버튼 매칭, 전부 일치)·"가능성 높음"(LLM 랭킹)·"확인 필요"
  eligibility: "조건 충족" | "가능성 높음" | "확인 필요";
  conditions?: string[]; // 버튼 매칭: 사용자 조건 대조형 칩 ("✓ 부산", "⚠️ 재창업자 대상" 등)
  kind?: "funding" | "facility" | "event" | "other"; // 공고 유형 — 자금지원/시설·공간/교육·행사
  checkReason?: string; // eligibility가 '확인 필요'일 때 무엇을 확인해야 하는지 한 줄
  // 아이템 적합성(2026-07-12) — 정렬 전용, 필터 금지. "low"는 하단 접힘(제외 아님)
  relevance?: "high" | "low";
  bizWhy?: string; // "내 사업과의 연관" 한 줄 — 근거를 못 만들면 생략(빈 값)
}

// What the LLM returns when ranking (merged back to Program by id).
export interface RankedPick {
  id: string;
  whatItIs: string;
  fitReason: string;
  eligibility: "가능성 높음" | "확인 필요";
}
