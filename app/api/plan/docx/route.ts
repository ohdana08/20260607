import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { isValidCode } from "@/lib/plan/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Section {
  heading: string;
  content: string;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "요청을 읽지 못했어요." }, { status: 400 });
  }

  const { code, title, sections } = (body ?? {}) as {
    code?: string;
    title?: string;
    sections?: Section[];
  };

  if (!isValidCode(code)) {
    return Response.json({ error: "이용권 코드가 필요해요." }, { status: 402 });
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    return Response.json({ error: "내보낼 내용이 없어요." }, { status: 400 });
  }

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

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);

  const filename = encodeURIComponent(`${title || "사업계획서"}.docx`);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="plan.docx"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
    },
  });
}
