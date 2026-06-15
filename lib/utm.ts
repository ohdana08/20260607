// UTM 유입 추적 — 리드 source 값 산출.
// buly.kr 등 단축링크가 /?utm_... 또는 /embed?utm_... 로 보낼 수 있다.
// 랜딩(/)으로 들어와 /embed 로 이동하는 경우를 위해 sessionStorage에 보관(같은 탭 유지).

const UTM_KEY = "gp_utm_v1";
const DEFAULT_SOURCE = "threads_chatbot";

// "utm_source / utm_medium / utm_campaign" (있는 값만 ' / '로 연결)
function buildSource(params: URLSearchParams): string | null {
  const parts = [
    params.get("utm_source"),
    params.get("utm_medium"),
    params.get("utm_campaign"),
  ]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : null;
}

// 현재 URL에 UTM이 있으면 sessionStorage에 저장(이후 페이지 이동에도 유지).
export function captureUtm(): void {
  if (typeof window === "undefined") return;
  try {
    const src = buildSource(new URLSearchParams(window.location.search));
    if (src) sessionStorage.setItem(UTM_KEY, src);
  } catch {
    /* ignore */
  }
}

// 리드 저장에 쓸 source: 현재 URL UTM → sessionStorage → 기본값 순.
export function getLeadSource(): string {
  if (typeof window === "undefined") return DEFAULT_SOURCE;
  try {
    const fromUrl = buildSource(new URLSearchParams(window.location.search));
    if (fromUrl) return fromUrl;
    const stored = sessionStorage.getItem(UTM_KEY);
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_SOURCE;
}
