import type { ChatMsg } from "@/lib/llm/provider";

const TRUSTED_DOMAINS = [
  "k-startup.go.kr",
  "bizinfo.go.kr",
  "nipa.kr",
  "kocca.kr",
  "smtech.go.kr",
] as const;

function isTrustedUrl(value: URL): boolean {
  if (value.protocol !== "https:") return false;
  const hostname = value.hostname.toLowerCase();
  return TRUSTED_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function firstTrustedProgramUrl(messages: ChatMsg[], fallback?: string): string | null {
  const candidates =
    [fallback ?? "", ...messages.map((message) => message.content)]
      .join("\n")
      .match(/https:\/\/[^\s<>"')\]]+/g) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate.replace(/[.,;]+$/, ""));
      if (isTrustedUrl(url)) return url.toString();
    } catch {
      // 잘못된 URL은 건너뛴다.
    }
  }
  return null;
}

export async function fetchTrustedProgramText(url: string): Promise<string | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return null;
  }
  if (!isTrustedUrl(current)) return null;

  try {
    // 자동 redirect를 쓰면 허용 도메인에서 내부망 URL로 튀는 SSRF 우회가 생길 수 있다.
    // 매 단계의 Location을 다시 검증하며 최대 3번만 따라간다.
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": "ddakjiwonfit-program-reader/1.0" },
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === 3) return null;
        const next = new URL(location, current);
        if (!isTrustedUrl(next)) return null;
        current = next;
        continue;
      }
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type") ?? "";
      if (!/text\/(html|plain)/i.test(contentType)) return null;
      const raw = (await response.text()).slice(0, 500_000);
      const text = htmlToText(raw);
      return text.length >= 80 ? text.slice(0, 14_000) : null;
    }
  } catch {
    return null;
  }
  return null;
}
