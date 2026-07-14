import type { Program } from "@/lib/match/types";
import { decodeEntities } from "./decodeEntities";

// KOCCA(한국콘텐츠진흥원) 지원사업공고 — 자체 Open API 사용(공공데이터포털 경유 아님).
// 서비스키는 kocca.kr Open API 메뉴(< 정보공개 < 열린경영 < OPEN API)에서 별도 발급.
// 엔드포인트·파라미터(serviceKey/pageIndex/numOfRows)는 2026-07-14 무키 호출로 에러 응답
// 스키마까지 실측 확인함: {"INFO":{"resultCode":...,"resultMgs":...,"pageNo":...,"numOfRows":...,"listCount":...}}
// ⚠️ 목록 배열 필드명(list/List 등)은 유효키가 없어 미확인 — 실키 발급 후 최초 1회 응답 구조 검증 필요.
//    (아래 findListArray가 후보 키를 순서대로 시도하고, 못 찾으면 raw 키를 로그로 남긴다.)
const ENDPOINT = "https://www.kocca.kr/api/pims/List.do";
const NUM_OF_ROWS = 100;
const MAX_PAGES = 10;

interface KoccaItem {
  title?: string;
  intcNoSeq?: string | number;
  cate?: string;
  content?: string;
  startDt?: string;
  endDt?: string;
  link?: string;
}

function normDate(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function stripHtml(s: string | undefined): string {
  return decodeEntities((s ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// 후보 키를 순서대로 시도 — 실키로 검증 전까지는 응답 스키마가 확정이 아니다.
function findListArray(json: unknown): KoccaItem[] {
  const info = (json as { INFO?: Record<string, unknown> })?.INFO ?? (json as Record<string, unknown>);
  for (const key of ["list", "List", "resultList", "items"]) {
    const v = (info as Record<string, unknown>)?.[key];
    if (Array.isArray(v)) return v as KoccaItem[];
  }
  return [];
}

function normalize(it: KoccaItem): Program | null {
  const title = decodeEntities(it.title).trim();
  if (!title) return null;
  const id = String(it.intcNoSeq ?? title);
  const link = it.link ? decodeEntities(it.link) : "";
  return {
    id: `kocca:${id}`,
    title,
    summary: it.content ? clip(stripHtml(it.content), 220) : "불명 — 응답에 개요 없음, 공고 원문 확인 필요",
    target: "불명 — 목록 응답에 지원대상 필드 없음, 공고 원문 확인 필요",
    supportField: it.cate ? decodeEntities(it.cate).trim() : "콘텐츠 지원",
    region: "전국", // KOCCA는 콘텐츠 산업 전문기관 특성상 대부분 전국 대상.
    applyEnd: normDate(it.endDt),
    url: link ? (link.startsWith("http") ? link : `https://www.kocca.kr${link}`) : `https://www.kocca.kr/kocca/pims/view.do?intcNo=${id}`,
    formUrl: null,
    source: "kocca",
  };
}

async function fetchPage(key: string, pageIndex: number): Promise<KoccaItem[]> {
  const params = new URLSearchParams({
    serviceKey: key,
    pageIndex: String(pageIndex),
    numOfRows: String(NUM_OF_ROWS),
  });
  const res = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`KOCCA HTTP ${res.status}`);
  const json = (await res.json()) as unknown;
  const list = findListArray(json);
  if (list.length === 0 && pageIndex === 1) {
    console.warn("[kocca] 응답에서 목록 배열을 못 찾음 — 응답 키:", Object.keys((json as { INFO?: object }).INFO ?? json ?? {}));
  }
  return list;
}

// 키 없으면 [] (다른 소스와 동일 관례). 실패 시 throw — 상위 collectSource가 처리.
export async function fetchKoccaOpen(): Promise<Program[]> {
  const key = process.env.KOCCA_KEY?.trim();
  if (!key) return [];
  const seen = new Map<string, KoccaItem>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await fetchPage(key, page);
    const before = seen.size;
    for (const it of items) seen.set(String(it.intcNoSeq ?? it.title ?? Math.random()), it);
    if (items.length === 0 || seen.size === before) break;
  }
  return Array.from(seen.values())
    .map(normalize)
    .filter((p): p is Program => p !== null);
}
