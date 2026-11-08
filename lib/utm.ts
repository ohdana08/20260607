// UTM 유입 추적 — 리드 source 값 산출.
// buly.kr 등 단축링크가 /?utm_... 또는 /embed?utm_... 로 보낼 수 있다.
// 랜딩(/)으로 들어와 /embed 로 이동하는 경우를 위해 sessionStorage에 보관(같은 탭 유지).

const UTM_KEY = "gp_attribution_v2";
const DEFAULT_SOURCE = "threads_chatbot";

// "utm_source / utm_medium / utm_campaign" (있는 값만 ' / '로 연결)
export type Attribution = Partial<Record<"source" | "medium" | "campaign" | "content", string>>;
// GA identifiers: Unicode labels, domain-like media and dates are legitimate.
// Do not confuse a date with a phone number, or silently invent another channel.
export function safeCampaignValue(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const v = value.trim();
  if (!/^[\p{L}\p{N}_.-]{1,80}$/u.test(v)) return;
  const digits = v.replace(/\D/g, "");
  if (/(?:\+?82[-. ]?)?0?1[016789](?:[-. ]?\d){7,8}/.test(v)) return;
  if (digits.length >= 9 || /^\d{7}$/.test(v)) return;
  return v;
}

export function readUtm(params: URLSearchParams): Attribution {
  const result: Attribution = {};
  for (const key of ["source", "medium", "campaign", "content"] as const) {
    const value = safeCampaignValue(params.get(`utm_${key}`));
    if (value) result[key] = value;
  }
  return result;
}

// Functional attribution is not a GA payload. Preserve supplied labels separately
// from the GA filter; bounded strings only, never deserialize arbitrary fields.
function functionalUtm(params: URLSearchParams): Attribution {
  const result: Attribution = {};
  for (const key of ["source", "medium", "campaign", "content"] as const) {
    if (!params.has(`utm_${key}`)) continue;
    const value = params.get(`utm_${key}`)!;
    result[key] = value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : "";
  }
  return result;
}

function storedAttribution(): { first: Attribution; latest: Attribution } {
  try {
    const stored = JSON.parse(sessionStorage.getItem(UTM_KEY) ?? "null");
    const clean = (v: unknown) => functionalUtm(new URLSearchParams(
      Object.entries(v && typeof v === "object" ? v : {})
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [`utm_${key}`, String(value)]),
    ));
    return { first: clean(stored?.first), latest: clean(stored?.latest) };
  } catch { return { first: {}, latest: {} }; }
}

// Only this filtered projection may be sent to GA. Legacy raw source never enters it.
export function getAttribution(): { first: Attribution; latest: Attribution } {
  const stored = storedAttribution();
  const clean = (v: Attribution) => readUtm(new URLSearchParams(
    Object.entries(v).map(([key, value]) => [`utm_${key}`, String(value)]),
  ));
  return { first: clean(stored.first), latest: clean(stored.latest) };
}

// 현재 URL에 UTM이 있으면 sessionStorage에 저장(이후 페이지 이동에도 유지).
export function captureUtm(): void {
  if (typeof window === "undefined") return;
  try {
    const latest = functionalUtm(new URLSearchParams(window.location.search));
    if (!Object.keys(latest).length) return;
    const previous = storedAttribution();
    sessionStorage.setItem(UTM_KEY, JSON.stringify({
      first: Object.keys(previous.first).length ? previous.first : latest,
      latest,
    }));
  } catch {
    /* ignore */
  }
}

// 리드 저장에 쓸 source: 현재 URL UTM → sessionStorage → 기본값 순.
export function getLeadSource(): string {
  if (typeof window === "undefined") return DEFAULT_SOURCE;
  try {
    captureUtm();
    const stored = storedAttribution().latest;
    const parts = [stored.source, stored.medium, stored.campaign, stored.content].filter(Boolean);
    if (Object.keys(stored).length) return parts.join(" / ") || "unknown";
    // Read-through migration for the existing tab's functional lead source only.
    // Do not parse this free-form legacy string into GA first/latest fields.
    const legacy = sessionStorage.getItem("gp_utm_v1");
    if (legacy && legacy.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(legacy)) return legacy;
  } catch {
    /* ignore */
  }
  return DEFAULT_SOURCE;
}
