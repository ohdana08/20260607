import type { Program } from "@/lib/match/types";
import { decodeEntities } from "./decodeEntities";

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
  return decodeEntities(s).replace(/\s+/g, " ").trim();
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

// 1~3페이지(최대 300행) 수집 (2026-07-14 P0): 1페이지(100행)만 가져오던 시절
// 기본 정렬 뒤편의 지역 공고(예: 부산 관광·마이스 그로우업, 마감 12-31)가 통째로 누락됐다.
const KSTARTUP_PAGES = 3;

async function fetchPage(key: string, page: number): Promise<KstartupItem[]> {
  const params = new URLSearchParams({
    serviceKey: key,
    page: String(page),
    perPage: "100",
    returnType: "json",
  });
  const res = await fetch(`${KSTARTUP_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`K-Startup API ${res.status}`);
  const json = (await res.json()) as { data?: KstartupItem[] };
  return Array.isArray(json.data) ? json.data : [];
}

function toOpenPrograms(items: KstartupItem[]): Program[] {
  const seen = new Set<string>();
  return items
    .filter((it) => it.rcrt_prgs_yn === "Y")
    .map(normalize)
    .filter((p): p is Program => p !== null)
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

async function fetchKstartupPrograms(key: string): Promise<Program[] | null> {
  const pages = await Promise.allSettled(
    Array.from({ length: KSTARTUP_PAGES }, (_, i) => fetchPage(key, i + 1)),
  );
  const items = pages.flatMap((p) => (p.status === "fulfilled" ? p.value : []));
  // 전 페이지 실패 → 첫 페이지 단독 재시도 (에러는 전파해 상위 aggregator가 로깅)
  const programs = toOpenPrograms(items.length > 0 ? items : await fetchPage(key, 1));
  return programs.length > 0 ? programs : null;
}

// 모집중인 K-Startup 공고. 키 없으면 [], 호출 실패 시 throw(상위 aggregator가 처리).
export async function fetchKstartupOpen(): Promise<Program[]> {
  const key = process.env.KSTARTUP_KEY?.trim();
  if (!key) return [];
  return (await fetchKstartupPrograms(key)) ?? [];
}
