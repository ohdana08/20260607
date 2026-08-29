// HWPX 텍스트 추출. HWP 바이너리는 Node 전용 extractHwp.ts에서 처리한다.

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return m;
      }
    })
    .replace(/&#(\d+);/g, (m, dec: string) => {
      try {
        return String.fromCodePoint(Number(dec));
      } catch {
        return m;
      }
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => XML_ENTITIES[name.toLowerCase()] ?? m);
}

function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// hwpx: 내부가 zip — Contents/section*.xml 의 <hp:t> 텍스트 노드를 순서대로 모은다.
export async function extractHwpxText(buf: ArrayBuffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort();
  if (names.length === 0) throw new Error("hwpx: section xml 없음");
  const parts: string[] = [];
  for (const n of names) {
    const xml = await zip.files[n].async("string");
    const texts = [...xml.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)].map((m) =>
      m[1]
        .replace(/<hp:lineBreak\s*\/>/gi, "\n")
        .replace(/<hp:tab\s*\/>/gi, "\t")
        .replace(/<hp:fwSpace\s*\/>/gi, "　")
        .replace(/<[^>]+>/g, ""),
    );
    // 네임스페이스가 다른 변형 파일이면 태그 전체 제거로 폴백
    const body = texts.length > 0 ? texts.join("\n") : xml.replace(/<[^>]+>/g, " ");
    parts.push(decodeXml(body));
  }
  return tidy(parts.join("\n"));
}
