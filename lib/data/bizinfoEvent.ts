import type { Program } from "@/lib/match/types";
import { decodeEntities } from "./decodeEntities";
import { isStillOpen } from "./openFilter";

// 기업마당 행사정보 API — 교육·세미나·설명회·전시회 등 지원사업 외 기회를 수집한다.
// 공식 명세: https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoEventApi
const ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoEventApi.do";
const BIZINFO_BASE = "https://www.bizinfo.go.kr";
const PAGE_UNIT = 100;
const PAGE_BATCH = 5;

const SIDO = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

interface BizinfoEventItem {
  seq?: string;
  eventInfoId?: string;
  title?: string;
  nttNm?: string;
  areaNm?: string;
  eventType?: string;
  eventInfoTyNm?: string;
  description?: string;
  nttCn?: string;
  originOrg?: string;
  originEngnNm?: string;
  rceptPd?: string;
  eventPeriod?: string;
  BeginEndDe?: string;
  lcategory?: string;
  pldirSportRealmLclasCodeNm?: string;
  originUrl?: string;
  originUrlAdres?: string;
  bizinfoUrl?: string;
  hashTags?: string;
  hashtags?: string;
  totCnt?: string | number;
}

interface EventPage {
  items: BizinfoEventItem[];
  totalCount: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clean(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return decodeEntities(String(value).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function firstText(item: BizinfoEventItem, ...keys: (keyof BizinfoEventItem)[]): string {
  for (const key of keys) {
    const value = clean(item[key]);
    if (value) return value;
  }
  return "";
}

function validDate(year: string, month: string, day: string): string | null {
  const mm = Number(month);
  const dd = Number(day);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// "2026-08-01 ~ 2026-08-13", "20260813", "2026. 8. 13." 모두 지원한다.
function lastDateOf(value: string): string | null {
  const expanded = value.replace(
    /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/g,
    "$1-$2-$3",
  );
  const matches = [...expanded.matchAll(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)];
  for (let index = matches.length - 1; index >= 0; index--) {
    const normalized = validDate(matches[index][1], matches[index][2], matches[index][3]);
    if (normalized) return normalized;
  }
  return null;
}

function normalizedRegion(value: string): string | null {
  const haystack = value.replace(/\s+/g, "");
  if (!haystack) return null;
  if (/전국|온라인|비대면/.test(haystack)) return "전국";
  const found = SIDO.filter((region) => haystack.includes(region));
  return found.length > 0 ? found.join("·") : null;
}

function regionOf(item: BizinfoEventItem, title: string): string {
  // API의 전용 지역 필드가 해시태그·제목보다 우선한다.
  const areaRegion = normalizedRegion(firstText(item, "areaNm"));
  if (areaRegion) return areaRegion;
  const tagRegion = normalizedRegion(firstText(item, "hashTags", "hashtags"));
  if (tagRegion) return tagRegion;
  const bracketText = [...title.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]).join(" ");
  return normalizedRegion(bracketText) ?? "전국";
}

function absoluteHttpUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, BIZINFO_BASE);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function stableFallbackId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalize(item: BizinfoEventItem): Program | null {
  const title = firstText(item, "title", "nttNm");
  if (!title) return null;

  const externalId = firstText(item, "eventInfoId", "seq")
    || stableFallbackId(`${title}|${firstText(item, "eventPeriod", "BeginEndDe")}|${firstText(item, "originOrg", "originEngnNm")}`);
  const description = firstText(item, "description", "nttCn");
  const eventType = firstText(item, "eventType", "eventInfoTyNm");
  const category = firstText(item, "lcategory", "pldirSportRealmLclasCodeNm");
  const receptionEnd = lastDateOf(firstText(item, "rceptPd"));
  const eventEnd = lastDateOf(firstText(item, "eventPeriod", "BeginEndDe"));
  const originUrl = absoluteHttpUrl(firstText(item, "originUrl", "originUrlAdres"));
  const bizinfoUrl = absoluteHttpUrl(firstText(item, "bizinfoUrl"));

  return {
    id: `bizinfo-event:${externalId}`,
    title,
    summary: clip(description || "행사 개요는 공고 원문 확인 필요", 220),
    target: "참여 대상은 공고 원문 확인 필요",
    supportField: ["교육·행사", eventType, category].filter(Boolean).join(" · "),
    region: regionOf(item, title),
    // 접수기간이 없으면 행사 종료일을 사용해 지난 행사가 계속 노출되는 것을 막는다.
    applyEnd: receptionEnd ?? eventEnd,
    url: originUrl ?? bizinfoUrl ?? BIZINFO_BASE,
    formUrl: null,
    source: "bizinfo-event",
  };
}

function parseTotal(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function eventItems(value: unknown): BizinfoEventItem[] | null {
  if (Array.isArray(value)) return value.filter(isRecord) as BizinfoEventItem[];
  if (!isRecord(value)) return null;
  if (Array.isArray(value.item)) return value.item.filter(isRecord) as BizinfoEventItem[];
  if (isRecord(value.item)) return [value.item as BizinfoEventItem];
  if ("title" in value || "nttNm" in value || "seq" in value || "eventInfoId" in value) {
    return [value as BizinfoEventItem];
  }
  return null;
}

function parsePage(payload: unknown): EventPage {
  if (!isRecord(payload) || !("jsonArray" in payload)) {
    throw new Error("기업마당 행사 API 응답에 jsonArray가 없음");
  }
  const container = payload.jsonArray;
  const items = eventItems(container);
  if (!items) throw new Error("기업마당 행사 API 응답에서 item 목록을 찾지 못함");

  const containerTotal = isRecord(container) ? parseTotal(container.totCnt) : null;
  const itemTotal = items.length > 0 ? parseTotal(items[0].totCnt) : null;
  return { items, totalCount: containerTotal ?? itemTotal };
}

async function fetchPage(key: string, pageIndex: number): Promise<EventPage> {
  const params = new URLSearchParams({
    crtfcKey: key,
    dataType: "json",
    searchCnt: String(PAGE_UNIT),
    pageUnit: String(PAGE_UNIT),
    pageIndex: String(pageIndex),
  });
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`기업마당 행사 API HTTP ${response.status}`);
  return parsePage(await response.json());
}

function maxPages(): number {
  const parsed = Number.parseInt(process.env.BIZINFO_EVENT_MAX_PAGES ?? "10", 10);
  return Number.isFinite(parsed) ? Math.min(30, Math.max(5, parsed)) : 10;
}

async function fetchAllPages(key: string): Promise<BizinfoEventItem[]> {
  const seen = new Map<string, BizinfoEventItem>();
  const limit = maxPages();
  let totalCount: number | null = null;
  let reachedEnd = false;

  for (let start = 1; start <= limit; start += PAGE_BATCH) {
    const pageNumbers = Array.from(
      { length: Math.min(PAGE_BATCH, limit - start + 1) },
      (_, index) => start + index,
    );
    const results = await Promise.allSettled(pageNumbers.map((page) => fetchPage(key, page)));
    const failedPages = results.flatMap((result, index) =>
      result.status === "rejected" ? [pageNumbers[index]] : [],
    );
    if (failedPages.length > 0) {
      throw new Error(`기업마당 행사 API 일부 페이지 실패: ${failedPages.join(", ")}`);
    }

    const pages = results.map((result) => result.status === "fulfilled" ? result.value : { items: [], totalCount: null });
    const sizeBefore = seen.size;
    for (const page of pages) {
      totalCount ??= page.totalCount;
      for (const item of page.items) {
        const keyValue = firstText(item, "eventInfoId", "seq")
          || stableFallbackId(`${firstText(item, "title", "nttNm")}|${firstText(item, "eventPeriod", "BeginEndDe")}`);
        seen.set(keyValue, item);
      }
    }

    if (totalCount !== null && seen.size >= totalCount) {
      reachedEnd = true;
      break;
    }
    if (pages.some((page) => page.items.length < PAGE_UNIT)) {
      reachedEnd = true;
      break;
    }
    if (seen.size === sizeBefore) {
      throw new Error("기업마당 행사 API 페이지가 진행되지 않아 수집을 중단함");
    }
  }

  if (!reachedEnd && totalCount !== null && seen.size < totalCount) {
    throw new Error(`기업마당 행사 ${totalCount}건 중 ${seen.size}건에서 수집 상한 도달`);
  }
  return [...seen.values()];
}

export async function fetchBizinfoEventsOpen(): Promise<Program[]> {
  const key = process.env.BIZINFO_EVENT_KEY?.trim();
  if (!key) throw new Error("BIZINFO_EVENT_KEY가 설정되지 않음");

  const items = await fetchAllPages(key);
  const programs = items
    .map(normalize)
    .filter((program): program is Program => program !== null)
    .filter((program) => isStillOpen(program.applyEnd));
  console.log(`[bizinfo-event] 모집중 교육·행사 ${programs.length}건 수집`);
  return programs;
}
