import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from "docx";

export interface PlanDocxSection {
  heading: string;
  content: string;
}

export interface PlanDocxChart {
  title: string;
  png: string;
  width: number;
  height: number;
}

export async function buildPlanDocxBuffer(
  title: string | undefined,
  sections: PlanDocxSection[],
  charts: PlanDocxChart[] = [],
): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 300 },
      children: [new TextRun({ text: title || "사업계획서", bold: true })],
    }),
  ];

  for (const s of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: s.heading, bold: true })],
      }),
    );
    const paras = (s.content || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paras.length === 0) paras.push("(내용 없음)");
    for (const p of paras) {
      children.push(
        new Paragraph({
          spacing: { after: 120, line: 360 },
          children: [new TextRun(p)],
        }),
      );
    }
  }

  if (Array.isArray(charts) && charts.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 120 },
        children: [new TextRun({ text: "[붙임] 도식 자료", bold: true })],
      }),
    );
    const MAX_W = 480;
    for (const c of charts) {
      try {
        const w = Math.min(MAX_W, c.width || MAX_W);
        const h = Math.round((w / (c.width || MAX_W)) * (c.height || 300));
        children.push(
          new Paragraph({
            spacing: { before: 180, after: 60 },
            children: [new TextRun({ text: c.title, bold: true })],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new ImageRun({
                type: "png",
                data: Buffer.from(c.png, "base64"),
                transformation: { width: w, height: h },
              }),
            ],
          }),
        );
      } catch (err) {
        console.error("[docx] image embed failed", c.title, err);
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
