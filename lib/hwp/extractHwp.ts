import "server-only";

function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface HChar {
  type: number;
  value: unknown;
}

interface HDoc {
  sections?: unknown[];
}

// HWP v5의 OLE 스트림에서 문단 텍스트 레코드(HWPTAG_PARA_TEXT=67)를 직접 읽는다.
// hwp.js가 일부 정상 공고문에서 DocInfo 파싱에 실패해도 본문 텍스트는 복구할 수 있다.
async function extractHwpRecordText(buf: ArrayBuffer): Promise<string> {
  const CFB = await import("cfb");
  const pakoModule = await import("pako");
  const inflate = pakoModule.inflate ?? pakoModule.default.inflate;
  const container = CFB.read(new Uint8Array(buf), { type: "array" });
  const header = CFB.find(container, "FileHeader");
  if (!header || header.content.length < 40) throw new Error("hwp: FileHeader 없음");
  const headerBytes = Uint8Array.from(header.content);
  const compressed = (new DataView(headerBytes.buffer).getUint32(36, true) & 1) === 1;
  const sectionPaths = container.FullPaths.filter((path) => /BodyText\/Section\d+$/i.test(path)).sort(
    (a, b) => Number(a.match(/Section(\d+)$/i)?.[1] ?? 0) - Number(b.match(/Section(\d+)$/i)?.[1] ?? 0),
  );
  if (sectionPaths.length === 0) throw new Error("hwp: BodyText 섹션 없음");

  const paragraphs: string[] = [];
  for (const path of sectionPaths) {
    const entry = CFB.find(container, path);
    if (!entry) continue;
    const stored = Uint8Array.from(entry.content);
    const data = compressed ? inflate(stored, { windowBits: -15 }) : stored;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;
    while (offset + 4 <= data.byteLength) {
      const headerValue = view.getUint32(offset, true);
      const tagId = headerValue & 0x3ff;
      let size = headerValue >>> 20;
      offset += 4;
      if (size === 0xfff) {
        if (offset + 4 > data.byteLength) break;
        size = view.getUint32(offset, true);
        offset += 4;
      }
      if (offset + size > data.byteLength) break;
      if (tagId === 67) {
        const end = offset + size;
        let text = "";
        for (let pos = offset; pos + 1 < end; ) {
          const code = view.getUint16(pos, true);
          if (code === 0 || code === 10 || code === 13) {
            if (code === 10 || code === 13) text += "\n";
            pos += 2;
          } else if (code >= 1 && code <= 31) {
            pos += 16;
          } else {
            text += String.fromCharCode(code);
            pos += 2;
          }
        }
        const cleaned = text.trim();
        if (cleaned) paragraphs.push(cleaned);
      }
      offset += size;
    }
  }
  const text = tidy(paragraphs.join("\n"));
  if (text.length < 30) throw new Error("hwp: 본문 텍스트 부족");
  return text;
}

export async function extractHwpText(buf: ArrayBuffer): Promise<string> {
  try {
    return await extractHwpRecordText(buf);
  } catch {
    // 비표준 레코드 구조는 기존 hwp.js 파서로 한 번 더 시도한다.
  }
  const imported = (await import("hwp.js")) as unknown as {
    parse?: (input: Uint8Array | number[], options: { type: string }) => unknown;
    default?: { parse?: (input: Uint8Array | number[], options: { type: string }) => unknown };
  };
  const parse = imported.parse ?? imported.default?.parse;
  if (!parse) throw new Error("hwp: parser를 불러오지 못함");
  const u8 = new Uint8Array(buf);
  let doc: HDoc | null = null;
  let lastError: unknown = null;
  const attempts: Array<[Uint8Array | number[], { type: string }]> = [
    [u8, { type: "array" }],
    [Array.from(u8), { type: "array" }],
    [u8, { type: "binary" }],
  ];
  for (const [input, options] of attempts) {
    try {
      doc = parse(input, options) as HDoc;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!doc) throw lastError instanceof Error ? lastError : new Error("hwp: 파싱 실패");

  const lines: string[] = [];
  const seen = new Set<object>();
  function walk(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = value as {
      content?: unknown[];
      items?: unknown[];
      controls?: unknown[];
      shapeBuffer?: unknown[];
    };
    const isParagraph =
      Array.isArray(node.content) && Array.isArray(node.controls) && Array.isArray(node.shapeBuffer);
    if (isParagraph) {
      const line = (node.content as HChar[])
        .map((char) => {
          if (!char || char.type !== 0) return "";
          if (typeof char.value === "string") return char.value;
          if (char.value === 13) return "\n";
          if (char.value === 9) return "\t";
          return "";
        })
        .join("")
        .trim();
      if (line) lines.push(line);
      walk(node.controls);
      return;
    }
    walk(node.content);
    walk(node.items);
  }
  walk(doc.sections ?? []);
  return tidy(lines.join("\n"));
}
