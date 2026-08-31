import type { Program } from "@/lib/match/types";

// 보조금통합포털(e나라도움·보탬e) 공모사업 공식 OpenAPI.
// 공공데이터포털 #15156853, 기획예산처_국고보조금 공모사업 상세.
// 개발·운영 모두 자동승인이지만 활용신청과 서비스키는 필수다.
const ENDPOINT =
  "https://apis.data.go.kr/1051000/MoefOpenAPI2025/T_OPD_ASBS_PBNS_UNITY";
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;
const FALLBACK_URL = "https://bojo.go.kr/da/getDA001200View.do";

export interface BojoApiItem {
  [key: string]: unknown;
  BSNSYEAR?: string;
  DTLBZ_ID?: string;
  DTLBZ_NM?: string;
  DTLBZ_BSNS_PURPS_DC?: string;
  DTLBZ_BSNS_SCALE_DC?: string;
  DDTLBZ_ID?: string;
  DDTLBZ_NM?: string;
  DDTLBZ_BSNS_PURPS_DC?: string;
  DDTLBZ_BSNS_SCALE_DC?: string;
  JRSD_NM?: string;
  SPORT_CN_DC?: string;
  SPORT_CND_CN?: string;
  BSNS_GUIDANCE_URL?: string;
  BSNS_POPUP_URL?: string;
  PBLANC_NM?: string;
  PBLANC_BEGIN_DE?: string;
  PBLANC_END_DE?: string;
  RCEPT_BEGIN_DE?: string;
  RCEPT_END_DE?: string;
  RCEPT_PD_DC?: string;
  SPORT_TRGET_CN?: string;
  EXCL_TRGET_CN?: string;
  PRESENTN_PAPERS_GUIDANCE_CN?: string;
  PBLANC_POPUP_URL?: string;
  DTLBZ_DDTLBZ_ID?: string;
  DLVPL_NM?: string;
  CMMN_ATRB_NM?: string;
  CL_STDR_DC?: string;
  CTPRVN_NM?: string;
  SIGNGU_NM?: string;
}

interface BojoApiResponse {
  response?: BojoPayload;
  header?: BojoHeader;
  body?: BojoBody;
}

interface BojoPayload {
  header?: BojoHeader;
  body?: BojoBody;
}

interface BojoHeader {
  resultCode?: string;
  resultMsg?: string;
}

interface BojoBody {
  totalCount?: string | number;
  items?: { item?: BojoApiItem | BojoApiItem[] } | BojoApiItem[];
}

function clean(value: unknown): string {
  const decoded = String(value ?? "")
    // 이 API는 JSON 응답에서도 문자열을 <![CDATA[...]]>로 감싸서 내려준다.
    // 일반 HTML 태그 제거를 먼저 하면 CDATA 안의 실제 값까지 사라지므로 선해제한다.
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
  return decoded
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function read(item: BojoApiItem, ...keys: string[]): string | undefined {
  const values = new Map<string, unknown>();
  for (const [key, value] of Object.entries(item)) {
    values.set(canonicalFieldName(key), value);
  }
  for (const key of keys) {
    const value = values.get(canonicalFieldName(key));
    if (value != null) return String(value);
  }
  return undefined;
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function toIsoDate(value: unknown): string | null {
  const text = clean(value);
  if (!text) return null;
  const match = text.match(/(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function safeOfficialUrl(...values: unknown[]): string {
  for (const raw of values) {
    const value = clean(raw);
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const hostname = url.hostname.toLowerCase();
      if (
        hostname === "bojo.go.kr" ||
        hostname.endsWith(".bojo.go.kr") ||
        hostname === "gosims.go.kr" ||
        hostname.endsWith(".gosims.go.kr")
      ) {
        if (url.protocol === "http:") url.protocol = "https:";
        return url.toString();
      }
    } catch {
      // URL 형식이 아니면 다음 후보를 본다.
    }
  }
  return FALLBACK_URL;
}

// 기업·사업자 타깃에 명백히 맞지 않는 기관전용 공모만 제외한다.
// 표현이 애매한 경우는 원문 확인을 위해 남긴다.
export function isPotentialBusinessAudience(item: BojoApiItem): boolean {
  const target = clean(
    `${read(item, "SPORT_TRGET_CN") ?? ""} ${read(item, "SPORT_CND_CN") ?? ""}`,
  );
  const business =
    /(중소기업|소상공인|창업기업|기업|법인|개인사업자|자영업|벤처|스타트업|사회적기업|협동조합|마을기업|농업경영체|영농조합)/.test(target);
  if (business) return true;
  const institutionOnly =
    /(중앙관서|지방자치단체|공공기관|대학|연구기관|비영리단체|협회|재단)/.test(target);
  return !institutionOnly;
}

function itemArray(body: BojoBody | undefined): BojoApiItem[] {
  const items = body?.items;
  if (Array.isArray(items)) return items;
  const item = items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export function normalizeBojoItem(item: BojoApiItem): Program | null {
  const title = clean(read(item, "PBLANC_NM"));
  if (!title || !isPotentialBusinessAudience(item)) return null;

  const applyEnd = toIsoDate(read(item, "RCEPT_END_DE", "PBLANC_END_DE"));
  const period = clean(read(item, "RCEPT_PD_DC"));
  // 종료일도 없고 '상시'라는 표시도 없는 항목은 열린 공고로 간주하지 않는다.
  if (!applyEnd && !/상시|예산\s*소진\s*시/.test(period)) return null;

  const summary = clip(
    clean(
      read(item, "DDTLBZ_BSNS_PURPS_DC") ||
        read(item, "DTLBZ_BSNS_PURPS_DC") ||
        read(item, "SPORT_CN_DC") ||
        read(item, "DDTLBZ_BSNS_SCALE_DC") ||
        read(item, "DTLBZ_BSNS_SCALE_DC") ||
        title,
    ),
    300,
  );
  const target = clip(
    clean(
      [
        read(item, "SPORT_TRGET_CN") || "지원대상 정보 없음",
        read(item, "SPORT_CND_CN"),
        read(item, "EXCL_TRGET_CN") ? `제외대상: ${read(item, "EXCL_TRGET_CN")}` : "",
      ]
        .filter(Boolean)
        .join(" / "),
    ),
    360,
  );
  const region = clip(
    clean([read(item, "CTPRVN_NM"), read(item, "SIGNGU_NM")].filter(Boolean).join(" ")) ||
      "전국",
    80,
  );
  const supportField = clip(
    clean(
      [
        read(item, "CMMN_ATRB_NM"),
        read(item, "CL_STDR_DC"),
        read(item, "JRSD_NM"),
        read(item, "DLVPL_NM"),
      ]
        .filter(Boolean)
        .join(" / "),
    ) || "국고보조금 공모",
    140,
  );
  const externalKey = [
    read(item, "DTLBZ_DDTLBZ_ID"),
    read(item, "DDTLBZ_ID"),
    read(item, "DTLBZ_ID"),
    read(item, "PBLANC_BEGIN_DE"),
    title,
  ]
    .filter(Boolean)
    .join(":");

  return {
    id: `bojo:${read(item, "DDTLBZ_ID", "DTLBZ_ID") || "notice"}:${stableHash(externalKey)}`,
    title,
    summary,
    target,
    supportField,
    region,
    applyEnd,
    url: safeOfficialUrl(
      read(item, "PBLANC_POPUP_URL"),
      read(item, "BSNS_GUIDANCE_URL"),
      read(item, "BSNS_POPUP_URL"),
    ),
    formUrl: null,
    source: "bojo",
  };
}

export function normalizeDataGoKrServiceKey(raw: string): string {
  const trimmed = raw.trim();
  // 공공데이터포털은 Encoding 키와 Decoding 키를 함께 보여준다.
  // Encoding 키를 URLSearchParams에 그대로 넣으면 '%'가 다시 인코딩되어 403이 날 수 있으므로
  // 내부에서는 한 번 디코딩한 원문 키로 통일하고, URLSearchParams가 정확히 한 번만 인코딩하게 한다.
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function keyForBojo(): string | null {
  // 같은 data.go.kr 프로젝트 서비스키를 재사용할 수 있도록 KSTARTUP_KEY를 후보로 둔다.
  // 단, #15156853에 대한 활용신청이 안 되어 있으면 공공데이터 게이트웨이가 권한 없음으로 응답한다.
  const raw =
    process.env.BOJO_SERVICE_KEY?.trim() ||
    process.env.DATA_GO_KR_SERVICE_KEY?.trim() ||
    process.env.KSTARTUP_KEY?.trim() ||
    null;
  return raw ? normalizeDataGoKrServiceKey(raw) : null;
}

async function fetchPage(key: string, year: number, pageNo: number): Promise<{
  items: BojoApiItem[];
  totalCount: number;
}> {
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    resultType: "json",
    bsnsyear: String(year),
  });
  const response = await fetch(`${ENDPOINT}?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`e나라도움 OpenAPI HTTP ${response.status}`);

  const json = (await response.json()) as BojoApiResponse;
  const payload = json.response ?? json;
  const code = payload.header?.resultCode ?? "";
  if (code && code !== "00") {
    throw new Error(
      `e나라도움 OpenAPI ${code}: ${payload.header?.resultMsg || "활용신청·서비스키 확인 필요"}`,
    );
  }
  const body = payload.body;
  return {
    items: itemArray(body),
    totalCount: Number(body?.totalCount ?? 0) || 0,
  };
}

async function fetchYear(key: string, year: number): Promise<Program[]> {
  const first = await fetchPage(key, year, 1);
  const pageCount = Math.min(MAX_PAGES, Math.max(1, Math.ceil(first.totalCount / PAGE_SIZE)));
  const rest =
    pageCount > 1
      ? await Promise.allSettled(
          Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(key, year, index + 2)),
        )
      : [];
  const items = [
    ...first.items,
    ...rest.flatMap((result) => (result.status === "fulfilled" ? result.value.items : [])),
  ];
  if (first.totalCount > PAGE_SIZE * MAX_PAGES) {
    console.warn(
      `[bojo] ${year}년 ${first.totalCount}건이 수집 상한(${PAGE_SIZE * MAX_PAGES})을 초과했어요.`,
    );
  }
  return items.map(normalizeBojoItem).filter((item): item is Program => item !== null);
}

export async function fetchBojoOpen(): Promise<Program[]> {
  const key = keyForBojo();
  if (!key) {
    console.warn("[bojo] 서비스키가 없어 수집을 건너뜁니다. 기존 DB 공고는 보존됩니다.");
    return [];
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  // 1~2월에는 전년 12월에 올라온 해넘이 공고가 남아 있을 수 있다.
  const years = now.getUTCMonth() <= 1 ? [year, year - 1] : [year];
  const results = await Promise.allSettled(years.map((value) => fetchYear(key, value)));
  const programs = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failures = results.filter((result) => result.status === "rejected");
  if (programs.length === 0 && failures.length > 0) throw failures[0].reason;

  const unique = new Map(programs.map((program) => [program.id, program]));
  if (unique.size === 0) {
    console.warn("[bojo] 0건 수집 — 활용신청·서비스키·응답 필드를 확인해 주세요.");
  }
  return [...unique.values()];
}
