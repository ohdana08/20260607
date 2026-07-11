import type { Program } from "@/lib/match/types";
import { isStillOpen } from "./openFilter";
import { decodeEntities } from "./decodeEntities";

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
  return decodeEntities((s ?? "").replace(/<[^>]+>/g, " "))
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

// KST 기준 마감 판정 — UTC 비교 버그(전날 마감이 오전에 통과) 수정, openFilter 공용 사용
function isOpen(endDate: string | null): boolean {
  return isStillOpen(endDate);
}

function normalize(it: BizItem): Program | null {
  const title = decodeEntities(it.pblancNm).trim();
  if (!title) return null;
  const end = endDateOf(it.reqstBeginEndDe);
  return {
    id: `bizinfo:${it.pblancId ?? title}`,
    title,
    summary: clip(stripHtml(it.bsnsSumryCn), 220),
    target: clip(decodeEntities(it.trgetNm).trim() || "지원대상 정보 없음", 120),
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

async function fetchPage(key: string, pageIndex: number): Promise<BizItem[]> {
  const params = new URLSearchParams({
    crtfcKey: key,
    dataType: "json",
    pageUnit: "100",
    pageIndex: String(pageIndex),
  });
  const res = await fetch(`${BIZINFO_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`bizinfo API ${res.status}`);
  const json = (await res.json()) as { jsonArray?: BizItem[] };
  return Array.isArray(json.jsonArray) ? json.jsonArray : [];
}

// 모집중인 기업마당 공고. 키 없으면 [], 호출 실패 시 throw.
// 2페이지(최대 200건)까지 가져와 소상공인 등 다양한 공고가 더 많이 포함되게 한다.
export async function fetchBizinfoOpen(): Promise<Program[]> {
  const key = process.env.BIZINFO_KEY?.trim();
  if (!key) return [];
  const pages = await Promise.allSettled([fetchPage(key, 1), fetchPage(key, 2)]);
  const items = pages.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
  if (items.length === 0) {
    // 두 페이지 모두 실패 → 첫 페이지 단독 재시도(에러 전파)
    return (await fetchPage(key, 1))
      .map(normalize)
      .filter((p): p is Program => p !== null)
      .filter((p) => isOpen(p.applyEnd));
  }
  const seen = new Set<string>();
  return items
    .map(normalize)
    .filter((p): p is Program => p !== null)
    .filter((p) => isOpen(p.applyEnd))
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}
