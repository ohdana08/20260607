import type { Program, Recommendation } from "./types";

// ── 버튼 4단계 추천 매칭 (2026-07-10 확정 설계, 2026-07-12 구현) ──────────
// LLM 채팅 인테이크를 대체하는 규칙 기반 매칭. LLM 호출 0회 — 즉시 응답.
//   1단계 업력, 2단계 지역 = 하드 필터 (단, '확실한 미달'만 배제)
//   3단계 지원유형 = 우선순위 (일치 공고를 앞으로; 없으면 완화해서 전부 노출)
//   4단계 분야 = 보너스 매칭 (7/2 확정: 골라도 결과가 줄지 않고 특화 공고만 위로)

export const YEARS_OPTIONS = [
  "예비창업",
  "창업초기(3년 이내)",
  "창업도약기(4~7년)",
  "7년 이상",
] as const;
// 지역(2026-07-12 개편): 주력 지역 3개는 버튼, 나머지 14개 시도는 드롭다운, 전국은 별도 버튼
export const REGION_MAIN = ["부산", "울산", "경남"] as const;
export const REGION_ETC = [
  "서울", "경기", "인천", "대구", "경북", "광주", "전남", "전북",
  "대전", "충남", "충북", "세종", "강원", "제주",
] as const;
export const NATIONWIDE = "전국(중앙부처)";
export const TYPE_OPTIONS = ["사업화", "R&D", "시설·공간", "멘토링·교육", "융자·보증"] as const;
export const SECTOR_OPTIONS = ["창업", "경영", "기술", "수출", "금융"] as const;

export interface ButtonProfile {
  years: string; // YEARS_OPTIONS 중 하나
  region: string; // REGION_OPTIONS 중 하나
  supportType: string; // TYPE_OPTIONS 중 하나
  sector?: string; // SECTOR_OPTIONS 중 하나 (선택 — 보너스 매칭)
  bizDesc?: string; // "무슨 사업 하세요?" 한 줄 (선택) — ⚠️ 정렬(랭킹) 전용, 필터 사용 금지
}

// 특수목적 공고 감지(2026-07-12) — 특정 기관 자산·인프라 활용 한정 공고
// (예: 고속도로 무형자산 = 한국도로공사 특허·데이터 활용 기업만 실익).
// 하드 필터 위반이 아니므로 제외하지 않고 relevance="low"로 하단 접힘 대상만 표시.
const SPECIAL_PURPOSE_RE =
  /고속도로|한국도로공사|철도공사|코레일|항만공사|공항공사|원자력|원전|방위산업|국방\s*기술|광해광업|농어촌공사|수자원공사|발전\s*(공기업|자회사)/;
export function isSpecialPurpose(p: Program): boolean {
  return SPECIAL_PURPOSE_RE.test(`${p.title} ${p.summary}`);
}

// 지원유형 → 공고 텍스트(지원분야+제목) 키워드.
// K-Startup supt_biz_clsfc(사업화·기술개발(R&D)·시설,공간,보육·멘토링,컨설팅,교육·융자)와
// 기업마당 대분류(금융·기술·수출·창업·경영 등)를 함께 커버한다.
const TYPE_KEYWORDS: Record<string, RegExp> = {
  사업화: /사업화|판로|내수|마케팅|바우처|스케일업|액셀러|엑셀러|상용화/,
  "R&D": /R\s*&?\s*D|기술개발|연구개발|기술혁신|실증/i,
  "시설·공간": /시설|공간|입주|보육|사무실|공장|센터\s*입주/,
  "멘토링·교육": /멘토링|컨설팅|교육|아카데미|역량\s*강화|자문/,
  "융자·보증": /융자|보증|대출|정책자금|금융\s*지원|자금\s*지원/,
};

// 분야(보너스) → 키워드. 기업마당 대분류 값과 이름이 같아 대부분 그대로 걸린다.
const SECTOR_KEYWORDS: Record<string, RegExp> = {
  창업: /창업/,
  경영: /경영|인력|노무|세무/,
  기술: /기술|R\s*&?\s*D|특허|지식재산/i,
  수출: /수출|글로벌|해외|무역/,
  금융: /금융|융자|보증|투자/,
};

function regionOk(p: Program, region: string): boolean {
  if (region.includes("전국")) return p.region.includes("전국");
  return p.region.includes(region.slice(0, 2)) || p.region.includes("전국");
}

// ── 타지역 제한 사전 감지 (2026-07-12 QA #1) ────────────────────────────
// region 필드가 '전국'으로 등록됐지만 제목·대상에 "제주 서귀포 소재/한정"처럼
// 다른 지역 제한이 명시된 공고 — 사용자 지역과 확실히 충돌하면 추천 전에 제외한다.
// 원칙: 필터는 추천 전에 돌고, 설명은 통과한 것에만 붙는다.
const SIDO_ALL = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
];
// 시도명 없이 시군구명만 적는 공고 대비 최소 매핑 (발견 시 추가)
const SUBREGION_TO_SIDO: Record<string, string> = {
  서귀포: "제주",
  판교: "경기",
  창원: "경남",
  전주: "전북",
  청주: "충북",
  천안: "충남",
  춘천: "강원",
  포항: "경북",
};
const RESTRICT_RE = "(에\\s*)?.{0,10}(소재|거주|주소지|사업장|관내|한정|시민|도민|주민|이전\\s*(예정|필수))";
export function regionConflict(p: Program, userSido: string | null): boolean {
  if (!userSido) return false;
  const hay = `${p.title} ${p.target}`;
  if (hay.includes(userSido) || hay.includes("전국")) return false; // 사용자 지역 언급·전국이면 충돌 아님
  const candidates: [string, string][] = [
    ...SIDO_ALL.filter((s) => s !== userSido).map((s): [string, string] => [s, s]),
    ...Object.entries(SUBREGION_TO_SIDO).filter(([, sido]) => sido !== userSido),
  ];
  for (const [name] of candidates) {
    if (new RegExp(`${name}${RESTRICT_RE}`).test(hay)) return true;
  }
  return false;
}

// ── 공고 유형 분류 (2026-07-12 QA #2) — 자금지원형 / 시설·공간형 / 교육·행사형 ──
export type ProgramKind = "funding" | "facility" | "event" | "other";
export type ApplicationKind = "business-plan" | "simple-application" | "reservation" | "unknown";
export interface ApplicationClassification {
  applicationKind: ApplicationKind;
  requiresBusinessPlan: boolean | null;
  applicationKindReason: string;
}
const EVENT_RE =
  /교육|행사|세미나|밋업|네트워킹|교류회|포럼|데모데이|경진|공모전|아카데미|특강|캠프|박람회|설명회|워크숍|컨퍼런스|페스티벌|멘토링|컨설팅/;
const FACILITY_RE = /입주|시설|공간|보육|사무실|공장|센터\s*입주|오피스/;
const FUNDING_RE =
  /자금|지원금|바우처|사업화\s*지원|R\s*&?\s*D|기술개발|융자|보증|출연금|상금|투자\s*유치|비용\s*지원|개발\s*지원/i;
export function classifyKind(p: Program): ProgramKind {
  const hay = `${p.supportField} ${p.title}`;
  if (FUNDING_RE.test(hay) && !EVENT_RE.test(p.title)) return "funding";
  if (FACILITY_RE.test(hay)) return "facility";
  if (EVENT_RE.test(hay)) return "event";
  if (FUNDING_RE.test(`${p.summary}`)) return "funding";
  return "other";
}

// 유료 초안 대상 판정은 "지원유형"이 아니라 실제 제출서류 신호로 보수적으로 판단한다.
// 애매한 공고는 unknown으로 두고 무료 공고 분석에서 원문·양식을 확인한 뒤에만 결제를 연다.
const BUSINESS_PLAN_RE =
  /사업\s*계획서|사업\s*수행\s*계획서|수행\s*계획서|사업\s*제안서|사업화\s*계획|발표\s*평가/;
const RESERVATION_RE =
  /(장비|시설|회의실|공간|스튜디오|테스트베드)\s*(예약|대관|이용|사용|대여|임차)/;
const SIMPLE_APPLICATION_RE =
  /(교육생|수강생|참가자|참여자)\s*(모집|신청)|(?:설명회|세미나|특강|포럼|박람회|컨퍼런스|워크숍)\s*(?:참가|참여)?\s*(?:신청|모집)/;

export function classifyApplicationKind(p: Program): ApplicationClassification {
  if (p.requiresBusinessPlan === true) {
    return {
      applicationKind: "business-plan",
      requiresBusinessPlan: true,
      applicationKindReason: p.applicationKindReason || "공고 분석에서 사업계획서 제출을 확인함",
    };
  }
  if (p.requiresBusinessPlan === false) {
    const applicationKind =
      p.applicationKind === "reservation" ? "reservation" : "simple-application";
    return {
      applicationKind,
      requiresBusinessPlan: false,
      applicationKindReason: p.applicationKindReason || "공고 분석에서 간단 신청 유형으로 확인함",
    };
  }

  const hay = `${p.title} ${p.summary} ${p.target} ${p.supportField}`;
  if (BUSINESS_PLAN_RE.test(hay)) {
    return {
      applicationKind: "business-plan",
      requiresBusinessPlan: true,
      applicationKindReason: "공고 정보에 사업계획서·수행계획서 제출 신호가 있음",
    };
  }
  if (RESERVATION_RE.test(hay)) {
    return {
      applicationKind: "reservation",
      requiresBusinessPlan: false,
      applicationKindReason: "장비·시설 예약 또는 이용 신청 유형",
    };
  }
  if (SIMPLE_APPLICATION_RE.test(hay)) {
    return {
      applicationKind: "simple-application",
      requiresBusinessPlan: false,
      applicationKindReason: "교육·행사 참가를 위한 간단 신청 유형",
    };
  }
  return {
    applicationKind: "unknown",
    requiresBusinessPlan: null,
    applicationKindReason: "공고 원문 또는 제출양식에서 사업계획서 필요 여부 확인 필요",
  };
}

// 지원 금액 추출 — 카드별 개별 근거용 (없으면 null, 문구 생략)
export function extractAmount(p: Program): string | null {
  const m = `${p.title} ${p.summary}`.match(
    /(최대|한도)?\s*([0-9][0-9,.]*)\s*(억|천만|백만|만)\s*원/,
  );
  if (!m) return null;
  return `${m[1] ? m[1] + " " : ""}${m[2]}${m[3]}원`.trim();
}

// 업력 판정 — target 원문에서 확실한 미달만 배제, 명시적 일치는 match, 나머지는 unknown.
// K-Startup target에는 "업력: 예비창업자,1년미만,3년미만…" 형태의 목록이 들어온다.
type YearsJudge = "match" | "unknown" | "exclude";
export function judgeYears(p: Program, years: string): YearsJudge {
  const t = p.target;
  const has예비 = /예비/.test(t);
  // "예비창업자"만 대상(기창업 표현이 전혀 없음)인 공고
  const 예비전용 = /예비\s*창업/.test(t) && !/(년|기창업|재창업|초기|도약|창업\s*기업)/.test(t);
  const uppers = [...t.matchAll(/(\d+)\s*년\s*(미만|이내|이하)/g)].map((m) => Number(m[1]));
  const lowers = [...t.matchAll(/(\d+)\s*년\s*(이상|초과)/g)].map((m) => Number(m[1]));
  const maxUpper = uppers.length ? Math.max(...uppers) : null; // 가장 관대한 업력 상한
  const minLower = lowers.length ? Math.min(...lowers) : null; // 가장 관대한 업력 하한

  if (years.startsWith("예비")) {
    if (minLower !== null && !has예비 && uppers.length === 0) return "exclude"; // "N년 이상"만 요구
    if (has예비) return "match";
    return "unknown";
  }
  if (years.includes("3년 이내")) {
    if (예비전용) return "exclude";
    if (minLower !== null && minLower > 3 && maxUpper === null) return "exclude";
    if (maxUpper !== null && maxUpper >= 1) return "match"; // 1·2·3·5·7년미만 등 어떤 상한이든 초기 포함
    if (/초기/.test(t)) return "match";
    return "unknown";
  }
  if (years.includes("4~7년")) {
    if (예비전용) return "exclude";
    if (maxUpper !== null && maxUpper <= 3 && minLower === null) return "exclude"; // 상한 3년 → 4년차 불가
    if (minLower !== null && minLower > 7 && maxUpper === null) return "exclude";
    if ((maxUpper !== null && maxUpper >= 5) || /도약/.test(t)) return "match";
    return "unknown";
  }
  // 7년 이상
  if (예비전용) return "exclude";
  if (maxUpper !== null && maxUpper <= 7 && minLower === null) return "exclude"; // 상한 7년 이하 → 불가
  if (minLower !== null && minLower <= 7) return "match"; // "N년 이상"(N≤7) 요구 충족
  if (maxUpper !== null && maxUpper > 7) return "match";
  return "unknown";
}

function byDeadline(a: Program, b: Program): number {
  return (a.applyEnd ?? "9999-99-99").localeCompare(b.applyEnd ?? "9999-99-99");
}

// 특수 자격요건 감지 — 겉 조건이 맞아도 이 키워드가 있으면 '확인 필요'로 강등 + ⚠️ 배지
const SPECIAL_REQS: { re: RegExp; label: (matched: string) => string }[] = [
  { re: /재창업|재기|폐업/, label: () => "폐업 후 재창업자 대상" },
  { re: /투자유치|투자실적|투자를 받은/, label: () => "투자유치 실적 필요" },
  { re: /사회적기업|협동조합|마을기업|자활기업|소셜벤처/, label: () => "사회적경제기업 대상" },
  { re: /여성\s*한정|청년\s*한정|장애인/, label: (m) => `대상 제한 있음 (${m.replace(/\s+/g, "")})` },
];
export function findCautions(p: Program): string[] {
  const hay = `${p.title} ${p.summary} ${p.target}`;
  const out: string[] = [];
  for (const s of SPECIAL_REQS) {
    const m = hay.match(s.re);
    if (m) out.push(s.label(m[0]));
  }
  return out;
}

// 업력 선택지 → 대조형 짧은 라벨
function yearsShort(years: string): string {
  if (years.startsWith("예비")) return "예비창업";
  if (years.includes("3년 이내")) return "창업 3년 이내";
  if (years.includes("4~7")) return "창업 4~7년";
  return "업력 7년 이상";
}

export interface ButtonMatchResult {
  recommendations: Recommendation[];
  relaxed: boolean; // 지원유형 일치가 0건이라 유형 조건을 완화해 보여주는 상태
  total: number; // 지역·업력 통과 총 건수
}

export function matchByButtons(programs: Program[], profile: ButtonProfile): ButtonMatchResult {
  const typeRe = TYPE_KEYWORDS[profile.supportType];
  const sectorRe = profile.sector ? SECTOR_KEYWORDS[profile.sector] : null;
  const userSido = profile.region.includes("전국") ? null : profile.region.slice(0, 2);
  // 사용자 목표 유형 — 자금 계열이면 자금지원형을 상단에, 교육·행사형은 뒤로 (QA #2)
  const goalKind: ProgramKind =
    profile.supportType === "시설·공간"
      ? "facility"
      : profile.supportType === "멘토링·교육"
        ? "event"
        : "funding";
  const kindRank = (k: ProgramKind): number => {
    if (k === goalKind) return 0;
    if (k === "event") return 3; // 목표가 교육이 아니면 교육·행사는 항상 뒤
    return k === "other" ? 2 : 1;
  };

  const scored = programs
    .map((p) => {
      if (!regionOk(p, profile.region)) return null; // 핵심 조건(지역) 불일치 → 리스트 제외
      if (regionConflict(p, userSido)) return null; // 타지역 소재·거주 제한 명시 → 리스트 제외 (QA #1)
      const yearsJudge = judgeYears(p, profile.years);
      if (yearsJudge === "exclude") return null; // 핵심 조건(업력) 불일치 → 리스트 제외
      const hay = `${p.supportField} ${p.title}`;
      const typeHit = typeRe ? typeRe.test(hay) : false;
      const sectorHit = sectorRe ? sectorRe.test(hay) : false;
      const cautions = findCautions(p);
      const kind = classifyKind(p);
      // 특수목적(정렬 전용 — 제외 금지): 특정 기관 자산 활용 한정 공고는 하단 접힘 대상
      const special = isSpecialPurpose(p);
      // 조건 충족(QA #4): 프로필로 확정 가능한 지역(필터 통과)·업력이 충족이고 특수요건이 없으면 충족.
      // 유형 불일치는 '미달'이 아니므로 판정에서 제외 — 정렬로만 반영한다.
      const eligible = yearsJudge === "match" && cautions.length === 0;
      const checkReason = eligible
        ? undefined
        : cautions.length > 0
          ? cautions[0]
          : "업력 조건이 공고에 명시되지 않아 원문 확인 필요";
      return { p, typeHit, sectorHit, yearsJudge, cautions, eligible, kind, checkReason, special };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => {
      // 1차: 목표 유형 우선(교육·행사는 뒤) · 2차: 특수목적 강등 · 3차: 지역 소재 가점(2026-07-14 P2)
      // · 4차: 조건 충족 · 5차: 분야 특화 · 6차: 마감순
      if (kindRank(a.kind) !== kindRank(b.kind)) return kindRank(a.kind) - kindRank(b.kind);
      if (a.special !== b.special) return a.special ? 1 : -1;
      if (userSido) {
        const la = a.p.region.includes(userSido);
        const lb = b.p.region.includes(userSido);
        if (la !== lb) return la ? -1 : 1;
      }
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (a.sectorHit !== b.sectorHit) return a.sectorHit ? -1 : 1;
      return byDeadline(a.p, b.p);
    });

  const relaxed = scored.length > 0 && !scored.some((s) => s.typeHit);

  // 노출 보장 (2026-07-14) — 두 가지를 30건 안에 강제로 자리 보장한다:
  //   ① 지역 소재: 풀이 커지면 유형 우선 정렬만으로는 소수의 지역 공고가 상위 30 밖으로
  //      밀려 "지역을 골랐는데 지역 공고 0건" 증상이 재발한다(프리뷰 실측).
  //   ② 신규 소스(NIPA·KOCCA·SMTECH, 2026-07-14 5소스 확장): 이 3소스는 목록 페이지에
  //      지원대상 원문이 없어(불명) yearsJudge가 대부분 'unknown'이 되고, 지원대상이
  //      명시된 K-Startup·기업마당 공고보다 정렬에서 밀린다 — 유형 불일치를 배제하지
  //      않는 원칙과 같은 이유로, 소스 자체가 안 보이는 것도 막는다.
  // 두 보장을 먼저 전부 모은 뒤 한 번에 병합한다(순차 적용 시 뒤 단계가 앞 단계의
  // 보장 항목을 밀어낼 수 있어 — 반드시 단일 병합).
  const MAX_RECS = 30;
  // 기존 K-Startup·기업마당 쏠림을 줄이고, 새로 붙인 4개 소스도 후보에 노출한다.
  const NEW_SOURCES: Program["source"][] = ["bojo", "nipa", "kocca", "smtech"];
  const NEW_SOURCE_GUARANTEE = 3;
  let selected = scored.slice(0, MAX_RECS);
  const forced = new Set<(typeof scored)[number]>();
  const queueForced = (candidates: typeof scored) => {
    for (const s of candidates) if (!selected.includes(s)) forced.add(s);
  };
  if (userSido) queueForced(scored.filter((s) => s.p.region.includes(userSido)).slice(0, 8));
  for (const src of NEW_SOURCES) queueForced(scored.filter((s) => s.p.source === src).slice(0, NEW_SOURCE_GUARANTEE));
  if (forced.size > 0) {
    const kept = new Set([...selected.slice(0, Math.max(0, MAX_RECS - forced.size)), ...forced]);
    selected = scored.filter((s) => kept.has(s)); // 원래 정렬 순서로 복원
  }

  const recommendations: Recommendation[] = selected.map((s) => {
    // 조건 원문 덤프 대신 '사용자 조건 대조형' 표시 (✓ 일치 / ⚠️ 주의) — 카드별 실제 근거 (QA #3)
    const conditions: string[] = [];
    if (userSido) conditions.push(s.p.region.includes(userSido) ? `✓ ${userSido} 소재 대상` : "✓ 전국 공고");
    else conditions.push("✓ 전국");
    if (s.yearsJudge === "match") conditions.push(`✓ ${yearsShort(profile.years)} 충족`);
    if (s.typeHit) conditions.push(`✓ ${profile.supportType}`);
    const amount = s.kind === "funding" ? extractAmount(s.p) : null;
    if (amount) conditions.push(`💰 ${amount}`);
    if (s.sectorHit && profile.sector) conditions.push(`✓ ${profile.sector} 분야`);
    for (const c of s.cautions) conditions.push(`⚠️ ${c}`);
    const application = classifyApplicationKind(s.p);
    const program = { ...s.p, ...application };
    return {
      program,
      whatItIs: "",
      fitReason: conditions.join(" · "),
      eligibility: s.eligible ? "조건 충족" : "확인 필요",
      conditions,
      kind: s.kind,
      checkReason: s.checkReason,
      applicationKind: application.applicationKind,
      requiresBusinessPlan: application.requiresBusinessPlan,
      ...(s.special ? { relevance: "low" as const } : {}),
    };
  });

  return { recommendations, relaxed, total: scored.length };
}
