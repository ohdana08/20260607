// 한글(HWP/HWPX) 텍스트 추출 — 브라우저에서 실행 (워드의 mammoth와 같은 패턴, 2026-07-12)
// 정부 공고·양식은 대부분 한글 파일이라, 업로드를 받자마자 여기서 텍스트를 뽑아 대화에 싣는다.
// 추출 실패는 throw → 호출부(convertFiles)가 3단 폴백 안내(PDF 저장/캡처/링크)를 띄운다.

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
    const texts = [...xml.matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)].map((m) => m[1]);
    // 네임스페이스가 다른 변형 파일이면 태그 전체 제거로 폴백
    const body = texts.length > 0 ? texts.join("\n") : xml.replace(/<[^>]+>/g, " ");
    parts.push(decodeXml(body));
  }
  return tidy(parts.join("\n"));
}

// 구형 hwp(v5 바이너리): hwp.js 로 파싱 시도. 문서 구조가 특이하면 throw → 폴백.
interface HChar {
  type: number; // 0 = 일반 문자
  value: unknown;
}
interface HPara {
  content?: HChar[];
}
interface HSection {
  content?: HPara[];
}
interface HDoc {
  sections?: HSection[];
}

export async function extractHwpText(buf: ArrayBuffer): Promise<string> {
  const mod = await import("hwp.js");
  const u8 = new Uint8Array(buf);
  let doc: HDoc;
  try {
    doc = mod.parse(u8, { type: "binary" }) as unknown as HDoc;
  } catch {
    doc = mod.parse(u8 as unknown as number[], { type: "array" }) as unknown as HDoc;
  }
  const lines: string[] = [];
  for (const sec of doc.sections ?? []) {
    for (const para of sec.content ?? []) {
      const line = (para.content ?? [])
        .filter((c) => c && c.type === 0 && typeof c.value === "string")
        .map((c) => c.value as string)
        .join("");
      if (line.trim()) lines.push(line);
    }
  }
  return tidy(lines.join("\n"));
}
