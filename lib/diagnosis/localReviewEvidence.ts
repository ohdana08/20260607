import type { EvidenceRow } from "@/lib/diagnosis/evidence";

// 운영 evidence_map을 복제하지 않는 로컬 UI 검사용 가상 항목.
// LOCAL_REVIEW_MODE에서 Supabase 서비스 키가 없을 때만 사용한다.
export const LOCAL_REVIEW_EVIDENCE_ROWS: EvidenceRow[] = [
  { item: "실제 매출 발생", market: true, growth: true, feasibility: false, capability: true },
  { item: "유료 고객 확보", market: true, growth: true, feasibility: false, capability: false },
  { item: "거래처 계약", market: true, growth: true, feasibility: true, capability: true },
  { item: "반복 구매 고객", market: true, growth: true, feasibility: false, capability: false },
  { item: "직원 고용", market: false, growth: true, feasibility: true, capability: true },
  { item: "특허·상표권", market: false, growth: false, feasibility: true, capability: true },
  { item: "인증", market: false, growth: false, feasibility: true, capability: true },
  { item: "투자유치", market: true, growth: true, feasibility: false, capability: true },
  { item: "수출 실적", market: true, growth: true, feasibility: true, capability: true },
  { item: "정부지원사업 수행 경험", market: false, growth: false, feasibility: true, capability: true },
];
