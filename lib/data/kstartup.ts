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

// ── 실제 K-Startup API (data.go.kr 게이트웨이) ──────────────────────────────
// 엔드포인트·필드명은 실제 응답으로 검증 완료.
const KSTARTUP_ENDPOINT =
  "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";

interface KstartupItem {
  pbanc_sn?: string | number;
  biz_pbanc_nm?: string;
  intg_pbanc_biz_nm?: string;
  pbanc_ctnt?: string;
  aply_trgt_ctnt?: string;
  biz_enyy?: string; // 사업업력 (예비창업자,1년미만...)
  biz_trgt_age?: string; // 대상 연령
  supt_biz_clsfc?: string; // 지원분야
  supt_regin?: string; // 지원지역
  pbanc_rcpt_end_dt?: string; // YYYYMMDD
  detl_pg_url?: string;
  biz_gdnc_url?: string;
  aply_mthd_onli_rcpt_istc?: string;
  rcrt_prgs_yn?: string; // 모집진행 Y/N
}

function decode(s: string | undefined): string {
  return (s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function ymdToDate(s: string | undefined): string | null {
  if (s && /^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

function normalize(it: KstartupItem): Program | null {
  const title = decode(it.biz_pbanc_nm || it.intg_pbanc_biz_nm);
  if (!title) return null;
  const targetParts = [
    decode(it.aply_trgt_ctnt),
    it.biz_enyy ? `업력: ${decode(it.biz_enyy)}` : "",
    it.biz_trgt_age ? `연령: ${decode(it.biz_trgt_age)}` : "",
  ].filter(Boolean);
  return {
    id: `kstartup:${it.pbanc_sn ?? title}`,
    title,
    summary: clip(decode(it.pbanc_ctnt), 220),
    target: clip(targetParts.join(" / "), 220) || "지원대상 정보 없음",
    supportField: decode(it.supt_biz_clsfc) || "기타",
    region: decode(it.supt_regin) || "전국",
    applyEnd: ymdToDate(it.pbanc_rcpt_end_dt),
    url: it.detl_pg_url || it.aply_mthd_onli_rcpt_istc || it.biz_gdnc_url || "https://www.k-startup.go.kr",
    formUrl: null, // 양식은 상세페이지 첨부에 있음 — 상세 링크로 안내
    source: "kstartup",
  };
}

async function fetchKstartupPrograms(key: string): Promise<Program[] | null> {
  const params = new URLSearchParams({
    serviceKey: key,
    page: "1",
    perPage: "100",
    returnType: "json",
  });
  const res = await fetch(`${KSTARTUP_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`K-Startup API ${res.status}`);
  const json = (await res.json()) as { data?: KstartupItem[] };
  const items = Array.isArray(json.data) ? json.data : [];
  const open = items.filter((it) => it.rcrt_prgs_yn === "Y");
  const programs = open.map(normalize).filter((p): p is Program => p !== null);
  return programs.length > 0 ? programs : null;
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
