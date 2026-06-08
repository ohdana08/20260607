import type { Program } from "@/lib/match/types";

// 데모/폴백용 샘플. 실제 소스(K-Startup·기업마당)가 0건일 때만 사용.
export const SAMPLE_PROGRAMS: Program[] = [
  {
    id: "sample-preliminary",
    title: "예비창업패키지",
    summary: "예비창업자의 사업화를 돕는 대표 지원사업. 사업화 자금과 멘토링 제공.",
    target: "예비창업자(사업자등록 전), 만 39세 이하 우대",
    supportField: "사업화 자금",
    region: "전국",
    applyEnd: null,
    url: "https://www.k-startup.go.kr",
    formUrl: "https://www.k-startup.go.kr",
    source: "sample",
  },
  {
    id: "sample-content-creator",
    title: "1인 미디어·콘텐츠 창작자 지원",
    summary: "콘텐츠·교육·온라인 기반 1인 창업자의 제작·마케팅·사업화 지원.",
    target: "콘텐츠/온라인 분야 예비·초기 창업자",
    supportField: "사업화·마케팅",
    region: "전국",
    applyEnd: null,
    url: "https://www.k-startup.go.kr",
    formUrl: null,
    source: "sample",
  },
  {
    id: "sample-early",
    title: "초기창업패키지",
    summary: "창업 3년 이내 초기 창업기업의 시장 안착과 성장을 위한 사업화 지원.",
    target: "창업 3년 이내 초기창업자",
    supportField: "사업화 자금",
    region: "전국",
    applyEnd: null,
    url: "https://www.k-startup.go.kr",
    formUrl: null,
    source: "sample",
  },
];
