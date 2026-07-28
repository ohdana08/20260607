import type { Program } from "@/lib/match/types";
import { decodeEntities } from "./decodeEntities";

// NIPA(정보통신산업진흥원) 사업공고 게시판 — data.go.kr에 국내 사업공고를 다루는 공식 API가
// 없음을 확인(2026-07-14, "글로벌ICT포털" 데이터셋은 해외진출 지원으로 별개 카테고리).
// 공개 게시판(nipa.kr/home/2-2)을 파싱한다 — djfksjd/ir-search(MIT)의 sources_crawl.py
// page_nipa()를 참고해 TS로 재작성 (THIRD_PARTY_NOTICES.md 참조). 실HTML로 구조 재검증 완료(2026-07-14).
const LIST_URL = (page: number) => `https://www.nipa.kr/home/2-2?curPage=${page}`;
const DETAIL_BASE = "https://www.nipa.kr/home/2-2/";
const MAX_PAGES = 30; // 10건/페이지 — ir-search 기본값과 동일(사이트 자체가 크지 않아 대개 훨씬 일찍 종료)
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const DELAY_MS = 300; // 예의 지연 — ir-search 관례

function clean(s: string): string {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

function normDate(s: string): string | null {
  const m = s.match(/(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

function splitPeriodEnd(s: string): string | null {
  const parts = s.split(/~|∼/);
  return normDate(parts.length === 2 ? parts[1] : s);
}

interface NipaItem {
  id: string;
  title: string;
  program: string;
  applyEnd: string | null;
  url: string;
}

function parseListPage(html: string): NipaItem[] {
  const items: NipaItem[] = [];
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const m = row.match(/href="(\/home\/2-2\/(\d+))"[^>]*>([\s\S]*?)<\/a>/);
    if (!m) continue;
    const period = row.match(/신청기간\s*:\s*([^<]+)/);
    const prog = row.match(/<span class="box[^"]*">([^<]+)<\/span>/);
    const title = clean(m[3].replace(/<!--[\s\S]*?-->/g, ""));
    if (!title) continue;
    items.push({
      id: m[2],
      title,
      program: prog ? clean(prog[1]) : "",
      applyEnd: period ? splitPeriodEnd(period[1]) : null,
      url: `${DETAIL_BASE}${m[2]}`,
    });
  }
  return items;
}

function normalize(it: NipaItem): Program {
  return {
    id: `nipa:${it.id}`,
    title: it.title,
    // 목록 페이지에는 요약·지원대상 텍스트가 없다 — 추정하지 않고 '불명'으로 명시(원문 확인 유도).
    summary: "불명 — 목록에 개요 없음, 공고 원문 확인 필요",
    target: "불명 — 목록에 지원대상 명시 없음, 공고 원문 확인 필요",
    supportField: it.program || "기타",
    region: "전국", // NIPA는 ICT 전문기관 특성상 대부분 전국 대상. 지역 제한은 원문에서만 확인 가능.
    applyEnd: it.applyEnd,
    url: it.url,
    formUrl: null,
    source: "nipa",
  };
}

async function fetchPage(page: number): Promise<NipaItem[]> {
  const res = await fetch(LIST_URL(page), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`NIPA HTTP ${res.status}`);
  return parseListPage(await res.text());
}

// 목록에 '모집중' 플래그가 따로 없다(마감일만 있음) — 마감 여부는 상위 호출자의
// isStillOpen()이 판정한다(K-Startup·기업마당과 동일 원칙).
export async function fetchNipaOpen(): Promise<Program[]> {
  const seen = new Map<string, NipaItem>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let items: NipaItem[];
    try {
      items = await fetchPage(page);
    } catch (err) {
      console.error(`[nipa] page ${page} 실패`, err);
      break;
    }
    const before = seen.size;
    for (const it of items) seen.set(it.id, it);
    if (items.length === 0 || seen.size === before) break; // 빈 페이지 또는 전부 중복 → 끝
    if (page < MAX_PAGES) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  if (seen.size === 0) console.warn("[nipa] 0건 수집 — 사이트 구조 변경 가능성, 확인 필요");
  return Array.from(seen.values()).map(normalize);
}
