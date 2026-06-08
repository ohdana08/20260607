import type { Program } from "@/lib/match/types";

// 기업마당(bizinfo) 지원사업정보 API. 중앙부처+지자체+공공기관 통합.
const BIZINFO_ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";

const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];

interface BizItem {
  pblancId?: string;
  pblancNm?: string; // 사업명
  bsnsSumryCn?: string; // 요약(HTML)
  trgetNm?: string; // 대상
  pldirSportRealmLclasCodeNm?: string; // 지원분야 대분류
  reqstBeginEndDe?: string; // "YYYY-MM-DD ~ YYYY-MM-DD"
  pblancUrl?: string; // 상세
  jrsdInsttNm?: string; // 소관기관
  hashtags?: string;
}

function stripHtml(s: string | undefined): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// "2026-06-04 ~ 2026-06-17" → 끝 날짜
function endDateOf(period: string | undefined): string | null {
  if (!period) return null;
  const m = period.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return m[2];
  const single = period.match(/(\d{4}-\d{2}-\d{2})/);
  return single ? single[1] : null;
}

function regionOf(hashtags: string | undefined): string {
  if (!hashtags) return "전국";
  const found = SIDO.filter((r) => hashtags.includes(r));
  if (found.length === 0) return "전국";
  if (found.length >= 10) return "전국"; // 거의 모든 지역 = 전국
  return found.join("·");
}

function isOpen(endDate: string | null): boolean {
  if (!endDate) return true; // 기간 불명확 → 일단 포함
  const today = new Date().toISOString().slice(0, 10);
  return endDate >= today;
}

function normalize(it: BizItem): Program | null {
  const title = (it.pblancNm ?? "").trim();
  if (!title) return null;
  const end = endDateOf(it.reqstBeginEndDe);
  return {
    id: `bizinfo:${it.pblancId ?? title}`,
    title,
    summary: clip(stripHtml(it.bsnsSumryCn), 220),
    target: clip((it.trgetNm ?? "").trim() || "지원대상 정보 없음", 120),
    supportField: (it.pldirSportRealmLclasCodeNm ?? "").trim() || "기타",
    region: regionOf(it.hashtags),
    applyEnd: end,
    url: it.pblancUrl?.startsWith("http")
      ? it.pblancUrl
      : `https://www.bizinfo.go.kr${it.pblancUrl ?? ""}` || "https://www.bizinfo.go.kr",
    formUrl: null,
    source: "bizinfo",
  };
}

// 모집중인 기업마당 공고. 키 없으면 [], 호출 실패 시 throw.
export async function fetchBizinfoOpen(): Promise<Program[]> {
  const key = process.env.BIZINFO_KEY?.trim();
  if (!key) return [];
  const params = new URLSearchParams({
    crtfcKey: key,
    dataType: "json",
    pageUnit: "100",
    pageIndex: "1",
  });
  const res = await fetch(`${BIZINFO_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`bizinfo API ${res.status}`);
  const json = (await res.json()) as { jsonArray?: BizItem[] };
  const items = Array.isArray(json.jsonArray) ? json.jsonArray : [];
  return items
    .map(normalize)
    .filter((p): p is Program => p !== null)
    .filter((p) => isOpen(p.applyEnd));
}
