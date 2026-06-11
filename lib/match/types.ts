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
  source: "kstartup" | "bizinfo" | "sample";
}

// One recommended program with a plain-language explanation.
export interface Recommendation {
  program: Program;
  whatItIs: string; // 이 사업이 실제로 뭘 해주는지 — 쉬운 설명
  fitReason: string; // 왜 이 사람에게 맞는지 — 일상어
  eligibility: "가능성 높음" | "확인 필요"; // 참여 가능성
}

// What the LLM returns when ranking (merged back to Program by id).
export interface RankedPick {
  id: string;
  whatItIs: string;
  fitReason: string;
  eligibility: "가능성 높음" | "확인 필요";
}
