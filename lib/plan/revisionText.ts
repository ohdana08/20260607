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

export function parseRevisionOutput(
  rawText: string,
  headings: string[],
): { sections: RevisionTextSection[]; recoveredFromText: boolean } {
  try {
    const parsed = extractJson<RevisionEnvelope>(rawText);
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections
          .map((item) => ({
            heading: String(item.heading ?? "").trim(),
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
