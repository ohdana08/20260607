import { extractJson } from "../llm/json.ts";

export interface RevisionTextSection {
  heading: string;
  content: string;
}

interface RevisionEnvelope {
  sections?: Array<{ heading?: unknown; content?: unknown }>;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanRevisionBlock(value: string): string {
  return value
    .replace(/^\s*(?::|[-–—])\s*/, "")
    .replace(/\n\s*```\s*$/g, "")
    .trim();
}

function canonicalHeading(value: string, headings: string[]): string {
  if (headings.includes(value)) return value;
  const key = (text: string) => text.replace(/^(?:\s*\d+[.)]\s*)+/, "").replace(/\s+/g, "");
  const matches = headings.filter(heading => key(heading) === key(value));
  return matches.length === 1 ? matches[0] : value;
}

export function parseRevisionOutput(
  rawText: string,
  headings: string[],
): { sections: RevisionTextSection[]; recoveredFromText: boolean } {
  if (rawText.includes("<SECTION_")) {
    if (!rawText.trimEnd().endsWith("<END_REVISION>")) return { sections: [], recoveredFromText: false };
    const sections: RevisionTextSection[] = [];
    const seen = new Set<number>();
    for (const match of rawText.matchAll(/<SECTION_(\d+)>\s*([\s\S]*?)\s*<\/SECTION_\1>/g)) {
      const index = Number(match[1]) - 1;
      if (!headings[index] || seen.has(index) || match[2].trim().length < 250) return { sections: [], recoveredFromText: false };
      seen.add(index);
      sections.push({ heading: headings[index], content: match[2].trim() });
    }
    const openingCount = (rawText.match(/<SECTION_\d+>/g) ?? []).length;
    return { sections: sections.length === openingCount ? sections : [], recoveredFromText: false };
  }
  try {
    const parsed = extractJson<RevisionEnvelope>(rawText);
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .map((item) => ({
            heading: canonicalHeading(String(item.heading ?? "").trim(), headings),
            content: String(item.content ?? "").trim(),
          }))
          .filter((item) => headings.includes(item.heading) && item.content.length > 0)
      : [];
    if (sections.length > 0) return { sections, recoveredFromText: false };
  } catch {
    // JSON을 지키지 않은 응답은 아래의 정확한 목차명 기반 복구로 이어간다.
  }

  const markers = headings
    .map((heading) => {
      const pattern = new RegExp(
        `^[ \\t]*(?:#{1,6}[ \\t]*)?(?:\\d+[.)][ \\t]*)?(?:\\*\\*)?${escapeRegex(heading)}(?:\\*\\*)?[ \\t]*(?::|[-–—])?[ \\t]*$`,
        "gmu",
      );
      const match = pattern.exec(rawText);
      return match ? { heading, start: match.index, contentStart: match.index + match[0].length } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.start - b.start);

  const sections = markers.flatMap((marker, index) => {
    const end = markers[index + 1]?.start ?? rawText.length;
    const content = cleanRevisionBlock(rawText.slice(marker.contentStart, end));
    return content.length > 0 ? [{ heading: marker.heading, content }] : [];
  });
  return { sections, recoveredFromText: sections.length > 0 };
}
