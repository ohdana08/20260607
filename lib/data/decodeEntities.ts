// HTML 엔티티 디코딩 — 공고 제목·본문에 &apos; &#39; 등이 그대로 노출되던 버그 수정(2026-07-12).
// 정부 API 응답에 이중 인코딩(&amp;apos;)도 섞여 있어 두 번 통과시킨다.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  times: "×",
};

function decodeOnce(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return _;
      }
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

export function decodeEntities(s: string | undefined): string {
  if (!s) return "";
  return decodeOnce(decodeOnce(s));
}
