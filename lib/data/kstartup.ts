import type { Program } from "@/lib/match/types";

// ── 샘플 데이터 (키 승인 전 데모용) ─────────────────────────────────────────
// data.go.kr K-Startup 키(KSTARTUP_KEY)가 승인되어 환경변수에 들어오면
// fetchKstartupPrograms()가 실제 공고를 가져오고, 아래 샘플은 폴백으로만 쓰임.
const SAMPLE_PROGRAMS: Program[] = [
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
    id: "sample-youth-academy",
    title: "청년창업사관학교",
    summary: "만 39세 이하 청년 창업자 대상 사업화·공간·교육 종합 지원.",
    target: "예비창업자 또는 창업 3년 이내, 만 39세 이하",
    supportField: "사업화 자금·공간·교육",
    region: "전국",
    applyEnd: null,
    url: "https://www.k-startup.go.kr",
    formUrl: null,
    source: "sample",
  },
  {
    id: "sample-local-creator",
    title: "로컬크리에이터 활성화 지원사업",
    summary: "지역 자원·콘텐츠를 활용한 창업 아이템을 가진 창업자 지원.",
    target: "지역 기반 예비/초기 창업자",
    supportField: "사업화 자금",
    region: "전국(지역별)",
    applyEnd: null,
    url: "https://www.k-startup.go.kr",
    formUrl: null,
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

// ── 실제 K-Startup API (키 승인 후 정확한 엔드포인트로 확정 예정) ────────────
// NOTE: data.go.kr 게이트웨이의 정확한 엔드포인트/필드명은 키 승인 후 실제
// 응답을 보고 확정한다. 현재는 best-effort + 실패 시 샘플 폴백.
async function fetchKstartupPrograms(key: string): Promise<Program[] | null> {
  void key;
  // TODO(key-arrives): 승인된 KSTARTUP_KEY와 실제 응답으로 엔드포인트/필드 매핑 확정.
  return null;
}

export async function fetchOpenPrograms(): Promise<{ programs: Program[]; usingSample: boolean }> {
  const key = process.env.KSTARTUP_KEY;
  if (key) {
    try {
      const real = await fetchKstartupPrograms(key);
      if (real && real.length > 0) return { programs: real, usingSample: false };
    } catch (err) {
      console.error("[kstartup] real fetch failed, falling back to sample", err);
    }
  }
  return { programs: SAMPLE_PROGRAMS, usingSample: true };
}
