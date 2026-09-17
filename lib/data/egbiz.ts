import type { Program } from "@/lib/match/types";
import { CollectionError } from "./collectionError.ts";
import {
  cleanRegionalText,
  regionalNoticeToProgram,
  regionalPeriodEnd,
  type RegionalNotice,
} from "./regional.ts";

// 경기기업비서 공개 목록 중 "경기도 지원사업" 표만 수집한다.
// 같은 화면의 "타기관 지원사업"은 기업마당 복제 데이터라 중복 방지를 위해 제외한다.
const BASE_URL = "https://www.egbiz.or.kr";
const MAX_PAGES = 20;
const PAGE_SIZE = 10;
const BATCH_SIZE = 3;
const COLLECTION_BUDGET_MS = 35_000;
const USER_AGENT = "DdakJiwonFit/1.0 (+https://ddakfit.bccconsulting.kr; regional-support-index)";

function listUrl(page: number): string {
  const params = new URLSearchParams({
    pageIndex: String(page),
    pageIndex1: "1",
    prjStatus: "apply",
  });
  return `${BASE_URL}/sp/supportPrjOutsideList.do?${params.toString()}`;
}

function nativeGyeonggiSection(html: string): string {
  const start = html.indexOf("경기도 지원사업");
  const end = html.indexOf("타기관 지원사업", start + 1);
  if (start < 0 || end < 0 || end <= start) return "";
  return html.slice(start, end);
}

export function parseEgbizPage(html: string): Program[] {
  const section = nativeGyeonggiSection(html);
  if (!section) return [];
  const programs: Program[] = [];
  for (const row of section.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const detail = row.match(/fn_supportPrjDtl\('([^']+)'\)[^>]*>([\s\S]*?)<\/a>/);
    if (!detail) continue;
    const cells = (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map(cleanRegionalText);
    const status = cells[4] ?? "";
    if (!status.includes("접수중")) continue;
    const notice: RegionalNotice = {
      id: detail[1],
      title: cleanRegionalText(detail[2]),
      agency: cells[2] ?? "경기도 지원기관",
      region: "경기",
      applyEnd: regionalPeriodEnd(cells[3]),
      url: `${BASE_URL}/sp/supportPrjOutsideDtl.do?listUrl=supportPrjOutsideList&bizCyclId=${encodeURIComponent(detail[1])}`,
    };
    const program = regionalNoticeToProgram(notice, "egbiz");
    if (program) programs.push(program);
  }
  return programs;
}

export function egbizFinalPage(html: string): number {
  const section = nativeGyeonggiSection(html);
  const total = Number(section.match(/경기도\s*지원사업[\s\S]*?class="num">\s*([\d,]+)/)?.[1]?.replaceAll(",", "") ?? 0);
  const byTotal = total > 0 ? Math.ceil(total / PAGE_SIZE) : 1;
  const linkedPages = [...section.matchAll(/fn_opMovePage1\((\d+)\)/g)].map((match) => Number(match[1]));
  return Math.min(MAX_PAGES, Math.max(1, byTotal, ...linkedPages));
}

function inspectPage(html: string, page: number): { total: number; ids: string[] } {
  const section = nativeGyeonggiSection(html);
  const count = section.match(/경기도\s*지원사업[\s\S]*?class="num">\s*([\d,]+)/);
  if (!section || !count) throw new CollectionError("SCHEMA_CHANGED", page);
  const total = Number(count[1].replaceAll(",", ""));
  if (!Number.isSafeInteger(total)) throw new CollectionError("SCHEMA_CHANGED", page);
  const ids = [...section.matchAll(/fn_supportPrjDtl\('([^']+)'\)[^>]*>([\s\S]*?)<\/a>/g)].map((match) => match[1]);
  // Compare unfiltered source IDs: excluded procurement/agency notices still count
  // toward the source's total. Filtering happens only after completeness checks.
  return { total, ids };
}

async function fetchPage(page: number, deadline: number): Promise<string> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CollectionError("DEADLINE_EXCEEDED", page);
  try {
    const response = await fetch(listUrl(page), {
      cache: "no-store",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(Math.min(15_000, remaining)),
    });
    if (!response.ok) throw new CollectionError("HTTP_ERROR", page, { status: response.status });
    const html = await response.text();
    if (Date.now() >= deadline) throw new CollectionError("DEADLINE_EXCEEDED", page);
    return html;
  } catch (cause) {
    if (cause instanceof CollectionError) throw cause;
    const name = cause && typeof cause === "object" && "name" in cause ? cause.name : "";
    throw new CollectionError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR", page, { cause });
  }
}

export async function fetchEgbizOpen(): Promise<Program[]> {
  const deadline = Date.now() + COLLECTION_BUDGET_MS;
  const firstHtml = await fetchPage(1, deadline);
  const first = inspectPage(firstHtml, 1);
  const linkedPages = [...nativeGyeonggiSection(firstHtml).matchAll(/fn_opMovePage1\((\d+)\)/g)].map((match) => Number(match[1]));
  if (Math.max(Math.ceil(first.total / PAGE_SIZE), ...linkedPages) > MAX_PAGES) {
    throw new CollectionError("PAGE_LIMIT", 1);
  }
  const finalPage = egbizFinalPage(firstHtml);
  const pages: string[] = [firstHtml];
  const ids = new Set(first.ids);

  for (let start = 2; start <= finalPage; start += BATCH_SIZE) {
    const batch = Array.from(
      { length: Math.min(BATCH_SIZE, finalPage - start + 1) },
      (_, index) => start + index,
    );
    const results = await Promise.allSettled(batch.map((page) => fetchPage(page, deadline)));
    for (const [index, result] of results.entries()) {
      // Never return partial success: upsertAndDiff interprets missing rows as closed.
      if (result.status === "rejected") throw result.reason;
      const inspected = inspectPage(result.value, batch[index]);
      if (inspected.total !== first.total) throw new CollectionError("INCOMPLETE_SNAPSHOT", batch[index]);
      for (const id of inspected.ids) ids.add(id);
      pages.push(result.value);
    }
  }

  if (ids.size < first.total) throw new CollectionError("INCOMPLETE_SNAPSHOT", finalPage);
  // The live source can under-report its total (2026-09-17: 43 displayed, 50
  // distinct notices). Keep usable notices, but never infer closure from absence:
  // persistence treats EGBIZ as non-exhaustive independently of this fetcher.
  if (ids.size > first.total) {
    console.warn(JSON.stringify({ component: "egbiz", event: "collection_count_mismatch", expected: first.total, observed: ids.size }));
  }

  const unique = new Map<string, Program>();
  for (const program of pages.flatMap(parseEgbizPage)) unique.set(program.id, program);
  if (unique.size === 0) {
    console.warn("[egbiz] 경기도 자체 접수중 공고 0건 — 사이트 구조 변경 가능성, 확인 필요");
  } else {
    console.log(`[egbiz] 경기도 자체 접수중 공고 ${unique.size}건 수집`);
  }
  return [...unique.values()];
}
