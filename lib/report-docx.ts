import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

// 진단 보고서 텍스트(줄바꿈 포함 평문) → .docx base64.
// 이메일에 Word 첨부로 보내기 위해 서버에서 생성한다.
export async function buildReportDocxBase64(
  title: string,
  fullReportText: string,
): Promise<string> {
  const lines = fullReportText.split("\n");
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: title, bold: true })],
    }),
    new Paragraph({ text: "" }),
  ];

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }
    // 📋/✅/⚠️/💡 로 시작하는 줄은 소제목처럼 굵게
    const isHeading = /^(📋|✅|⚠️|💡|■|##)/.test(line);
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: line.replace(/^#+\s*/, ""), bold: isHeading })],
      }),
    );
  }

  const doc = new Document({ sections: [{ children: paragraphs }] });
  const buf = await Packer.toBuffer(doc);
  return Buffer.from(buf).toString("base64");
}
