import type { Program } from "@/lib/match/types";
import { decodeEntities } from "./decodeEntities";

// SMTECH(중소기업기술정보진흥원) 과제공고 게시판.
// 공식 연계 API(중소벤처24, data.go.kr #15113191)는 승인 절차·기간이 확인 안 돼
// 이번 스프린트는 공개 게시판을 파싱한다 — djfksjd/ir-search(MIT)의 sources_crawl.py
// page_smtech()를 참고해 TS로 재작성(THIRD_PARTY_NOTICES.md 참조).
// 실HTML로 구조 재검증 완료(2026-07-14) — 상태 아이콘(alt="접수중"/"접수완료")까지 확인.
// 중소벤처24 API 키가 발급되면 이 파일의 fetch 부분만 교체하면 된다(normalize 유지).
const LIST_URL = (page: number) => `https://www.smtech.go.kr/front/ifg/no/notice02_list.do?pageIndex=${page}`;
const MAX_PAGES = 20;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const DELAY_MS = 300;

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

interface SmtechItem {
  id: string;
  title: string;
  field: string;
  applyEnd: string | null;
  status: string | null; // "접수중" | "접수완료" | null(파싱 실패 — 날짜로만 판정)
  url: string;
}

function parseListPage(html: string): SmtechItem[] {
  const items: SmtechItem[] = [];
  const rows = html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const m = row.match(
      /href="(\/front\/ifg\/no\/notice02_detail\.do[^"]*ancmId=([^&"]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/,
    );
    if (!m) continue;
    const tds = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map((td) =>
      clean(td.replace(/<[^>]+>/g, " ")),
    );
    const period = tds.find((t) => t.includes("~")) ?? "";
    const status = row.match(/alt="(접수중|접수완료|접수예정)"/);
    const path = decodeEntities(m[1]).replace(/;jsessionid=[^?]*/, "");
    const title = clean(m[3]);
    if (!title) continue;
    items.push({
      id: m[2],
      title,
      field: tds[2] || tds[1] || "",
      applyEnd: period ? splitPeriodEnd(period) : null,
      status: status ? status[1] : null,
      url: `https://www.smtech.go.kr${path}`,
    });
  }
  return items;
}

function normalize(it: SmtechItem): Program {
  return {
    id: `smtech:${it.id}`,
    title: it.title,
    summary: "불명 — 목록에 개요 없음, 공고 원문 확인 필요",
    target: "불명 — 목록에 지원대상 명시 없음, 공고 원문 확인 필요",
    supportField: it.field || "R&D",
    region: "전국", // SMTECH(중기부 R&D)는 전국 공모가 원칙. 지역 특화 과제는 원문 확인.
    applyEnd: it.applyEnd,
    url: it.url,
    formUrl: null,
    source: "smtech",
  };
}

async function fetchPage(page: number): Promise<SmtechItem[]> {
  const res = await fetch(LIST_URL(page), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`SMTECH HTTP ${res.status}`);
  return parseListPage(await res.text());
}

export async function fetchSmtechOpen(): Promise<Program[]> {
  const seen = new Map<string, SmtechItem>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let items: SmtechItem[];
    try {
      items = await fetchPage(page);
    } catch (err) {
      console.error(`[smtech] page ${page} 실패`, err);
      break;
    }
    const before = seen.size;
    for (const it of items) seen.set(it.id, it);
    if (items.length === 0 || seen.size === before) break;
    if (page < MAX_PAGES) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  if (seen.size === 0) console.warn("[smtech] 0건 수집 — 사이트 구조 변경 가능성, 확인 필요");
  // 상태가 명시적으로 '접수완료/접수예정'이면 제외. 파싱 실패(status=null)는 날짜 필터에 맡긴다
  // (불명을 임의로 배제하지 않는다 — 조용히 빠뜨리지 않는다는 원칙).
  return Array.from(seen.values())
    .filter((it) => it.status !== "접수완료" && it.status !== "접수예정")
    .map(normalize);
}
