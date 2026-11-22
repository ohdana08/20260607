import type { Question } from "./types";

export function questionExample(q: Question): string {
  if (typeof q.example === "string" && q.example.trim() && q.example.length <= 160) return q.example.trim();
  const wording = q.prompt + " " + q.quote;
  if (/날인|원본대조필/.test(wording)) return "사본은 준비했고, 원본대조필 도장만 찍으면 돼요.";
  if (/등기사항|등기부/.test(wording)) return "등기증명서는 갖고 있는데, 발급일이 이번 공고 기준에 맞는지 확인 중이에요.";
  if (/매출/.test(wording)) return "전체 매출은 정리했고, 이 사업과 관련된 매출만 따로 집계 중이에요.";
  if (/추천/.test(q.prompt)) return "운영사와 추천을 논의했고, 공식 접수 여부는 답변을 기다리고 있어요.";
  if (/투자/.test(q.prompt)) return "투자계약은 체결했고, 입금 확인 자료를 기다리고 있어요.";
  return "";
}
