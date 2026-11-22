import { parseHTML } from "linkedom";
import { isTrustedUrl } from "@/lib/data/trustedProgramUrl";
import { documentText } from "./documents";
import type { Source } from "./types";

async function download(input: URL, limit: number) {
  let url = input;
  for (let hop = 0; hop < 4; hop++) {
    if (!isTrustedUrl(url))
      throw new Error(
        "지원하는 공식 기관의 HTTPS 상세 공고 링크를 입력해 주세요.",
      );
    const res = await fetch(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      await res.body?.cancel();
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok || !res.body)
      throw new Error("기관 사이트에서 자료를 가져오지 못했습니다.");
    const reader = res.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("파일 용량 한도를 넘었습니다.");
      }
      chunks.push(value);
    }
    return {
      url,
      bytes: Buffer.concat(chunks),
      type: res.headers.get("content-type") || "",
    };
  }
  throw new Error("기관 사이트의 이동 주소를 확인할 수 없습니다.");
}

export async function readNotice(raw: string) {
  let input: URL;
  try {
    input = new URL(raw);
  } catch {
    throw new Error("올바른 공식 공고 주소를 입력해 주세요.");
  }
  const page = await download(input, 2_000_000);
  if (!/html/i.test(page.type))
    throw new Error("첨부파일 주소 대신 공고 상세 페이지 주소를 넣어주세요.");
  const { document } = parseHTML(
    new TextDecoder(/euc-kr/i.test(page.type) ? "euc-kr" : "utf-8").decode(
      page.bytes,
    ),
  );
  document
    .querySelectorAll("script,style,header,footer,nav,noscript,template")
    .forEach((el) => el.remove());
  const content =
    document.querySelector(
      ".app_notice_details-wrap, .board_view, .view_cont, article",
    ) ||
    document.querySelector("main") ||
    document.body;
  const title = (
    content.querySelector("#scrTitle,h1,h2,.subject")?.textContent ||
    document.title
  )
    .trim()
    .slice(0, 240);
  const text = (content as HTMLElement).innerText
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim()
    .slice(0, 24000);
  if (text.length < 80)
    throw new Error(
      "공고 본문을 읽을 수 없습니다. 공식 상세 페이지인지 확인해 주세요.",
    );
  const sources: Source[] = [{ name: "공고 본문", text }],
    unread: string[] = [];
  const links = new Map<string, string>();
  for (const a of Array.from(content.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") || "";
    if (
      !/fileDownload|fileDown|download|\.(?:hwpx?|pdf|docx|txt|png|jpe?g)(?:$|[?#])/i.test(
        href,
      )
    )
      continue;
    let url: URL;
    try {
      url = new URL(href, page.url);
    } catch {
      continue;
    }
    const label =
      a.closest("li.clear")?.querySelector(".file_bg")?.textContent ||
      a.getAttribute("download") ||
      a.getAttribute("title") ||
      a.textContent ||
      "";
    const name =
      label
        .trim()
        .match(/[^\n]+?\.(?:hwpx?|pdf|docx|txt|png|jpe?g|webp)\b/i)?.[0] ||
      decodeURIComponent(url.pathname.split("/").pop() || "첨부파일");
    links.set(url.href, name.trim());
  }
  const entries = Array.from(links);
  await Promise.all(
    entries.slice(0, 8).map(async ([href, name]) => {
      try {
        const file = await download(new URL(href), 3 * 1024 * 1024);
        sources.push({
          name,
          text: await documentText(name, file.bytes, false),
        });
      } catch {
        unread.push(name);
      }
    }),
  );
  unread.push(...entries.slice(8).map(([, name]) => name));
  return { title, url: page.url.href, sources, unread };
}
