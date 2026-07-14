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

// 모집중 전량 수집 (2026-07-14 P0 확정): 이 API는 역대 공고 29,000건+ 아카이브를
// 최신순으로 반환해, 페이지 확대(1,000행)로도 마감이 먼 지역 공고
// (예: 부산 관광ㆍ마이스 그로우업, 3/17 등록·12/31 마감)를 놓쳤다.
// odcloud cond 문법이 실작동함을 실키로 검증(2026-07-14): cond[rcrt_prgs_yn::EQ]=Y
// 서버 필터로 모집중 전체(실측 274건)가 perPage=500 1콜에 들어온다.
// matchCount>500이면 페이지를 추가하고, 상한 초과는 경고 로그로 감지한다.
const PER_PAGE = 500;
const MAX_PAGES = 4; // 모집중 2,000건까지 대응

interface KstartupPage {
  data?: KstartupItem[];
  matchCount?: number;
}

async function fetchPage(key: string, page: number): Promise<KstartupPage> {
  const params = new URLSearchParams({
    serviceKey: key,
    page: String(page),
    perPage: String(PER_PAGE),
    returnType: "json",
  });
  params.set("cond[rcrt_prgs_yn::EQ]", "Y"); // 모집중만 — 서버 필터 (percent-encoding 허용 확인됨)
  const res = await fetch(`${KSTARTUP_ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`K-Startup API ${res.status}`);
  return (await res.json()) as KstartupPage;
}

// 클라이언트측 방어 필터: 서버 필터가 무시·오작동해도 모집중만 남기고 중복 제거
function toOpenPrograms(items: KstartupItem[]): Program[] {
  const seen = new Set<string>();
  return items
    .filter((it) => it.rcrt_prgs_yn === "Y")
    .map(normalize)
    .filter((p): p is Program => p !== null)
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

async function fetchKstartupPrograms(key: string): Promise<Program[] | null> {
  const first = await fetchPage(key, 1);
  const matchCount = first.matchCount ?? 0;
  const needed = Math.min(MAX_PAGES, Math.max(1, Math.ceil(matchCount / PER_PAGE)));
  const rest =
    needed > 1
      ? await Promise.allSettled(
          Array.from({ length: needed - 1 }, (_, i) => fetchPage(key, i + 2)),
        )
      : [];
  const items = [
    ...(first.data ?? []),
    ...rest.flatMap((p) => (p.status === "fulfilled" ? (p.value.data ?? []) : [])),
  ];
  const programs = toOpenPrograms(items);
  console.log(`[kstartup] 모집중 ${matchCount}건 중 ${programs.length}건 수집`);
  if (matchCount > MAX_PAGES * PER_PAGE)
    console.warn(
      `[kstartup] 모집중 ${matchCount}건이 수집 상한(${MAX_PAGES * PER_PAGE})을 초과 — MAX_PAGES 확대 필요`,
    );
  return programs.length > 0 ? programs : null;
}

// 모집중인 K-Startup 공고. 키 없으면 [], 호출 실패 시 throw(상위 aggregator가 처리).
export async function fetchKstartupOpen(): Promise<Program[]> {
  const key = process.env.KSTARTUP_KEY?.trim();
  if (!key) return [];
  return (await fetchKstartupPrograms(key)) ?? [];
}
