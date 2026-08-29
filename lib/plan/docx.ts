import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

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

const BLUE = "1D4ED8";
const DARK = "18181B";
const MUTED = "52525B";
const AMBER = "92400E";
const RED = "B91C1C";
const BODY_FONT = "Malgun Gothic";

function textParagraph(text: string, bullet = false): Paragraph {
  const missing = text.includes("[보완 필요");
  const proof = text.includes("[증빙 필요");
  return new Paragraph({
    ...(bullet ? { bullet: { level: 0 } } : {}),
    spacing: { after: 100, line: 330 },
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        color: missing ? RED : proof ? AMBER : DARK,
        bold: missing || proof,
        size: 20,
      }),
    ],
  });
}

function tableCell(text: string, header = false): TableCell {
  return new TableCell({
    shading: header ? { fill: "EAF1FF" } : undefined,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            font: BODY_FONT,
            bold: header,
            color: header ? BLUE : DARK,
            size: 19,
          }),
        ],
      }),
    ],
  });
}

function twoColumnTable(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [tableCell(label, true), tableCell(value)],
        }),
    ),
  });
}

// "항목명: 내용" 연속 블록은 DOCX에서 실제 2열 표로 바꿔 긴 산문만 이어지는 결과를 막는다.
function renderContent(content: string): Array<Paragraph | Table> {
  const lines = (content || "").split(/\n/).map((line) => line.trim());
  if (lines.every((line) => !line)) return [textParagraph("(내용 없음)")];

  const out: Array<Paragraph | Table> = [];
  let keyValueRows: Array<[string, string]> = [];
  const flushTable = () => {
    if (keyValueRows.length >= 2) out.push(twoColumnTable(keyValueRows));
    else {
      for (const [label, value] of keyValueRows) {
        out.push(textParagraph(`${label}: ${value}`));
      }
    }
    keyValueRows = [];
  };

  for (const raw of lines) {
    if (!raw) {
      flushTable();
      continue;
    }
    const match = raw.match(/^([^:：\n]{1,28})[:：]\s*(.+)$/);
    if (match && !raw.startsWith("[")) {
      keyValueRows.push([match[1].trim(), match[2].trim()]);
      continue;
    }
    flushTable();
    const bullet = /^[-·•]\s*/.test(raw);
    out.push(textParagraph(raw.replace(/^[-·•]\s*/, ""), bullet));
  }
  flushTable();
  return out;
}

function countToken(content: string, token: string): number {
  return content.split(token).length - 1;
}

function reviewTable(sections: PlanDocxSection[]): Table {
  const rows = sections.map((section) => {
    const missing = countToken(section.content, "[보완 필요");
    const proof = countToken(section.content, "[증빙 필요");
    const status = missing > 0 ? "보완 필요" : proof > 0 ? "증빙 확인 필요" : "사용자 최종 확인";
    return new TableRow({
      children: [
        tableCell(section.heading),
        tableCell(status),
        tableCell(String(missing)),
        tableCell(String(proof)),
      ],
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          tableCell("공식 항목", true),
          tableCell("검토 상태", true),
          tableCell("보완", true),
          tableCell("증빙", true),
        ],
      }),
      ...rows,
    ],
  });
}

export async function buildPlanDocxBuffer(
  title: string | undefined,
  sections: PlanDocxSection[],
  charts: PlanDocxChart[] = [],
): Promise<Buffer> {
  const docTitle = title || "사업계획서";
  const generatedDate = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "long",
  }).format(new Date());
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 300 },
      children: [
        new TextRun({ text: docTitle, font: BODY_FONT, bold: true, color: DARK, size: 42 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [
        new TextRun({ text: "정부지원사업 제출용 초안", font: BODY_FONT, color: MUTED, size: 24 }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `생성일 ${generatedDate}`, font: BODY_FONT, color: MUTED, size: 20 }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: "제출 전 검토표", font: BODY_FONT, bold: true, color: BLUE }),
      ],
    }),
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: "[보완 필요]는 아직 정보가 없는 항목, [증빙 필요]는 사실을 뒷받침할 자료가 필요한 항목입니다. 제출 전 모든 표시와 공식 양식의 분량·첨부서류를 확인해 주세요.",
          font: BODY_FONT,
          color: MUTED,
          size: 19,
        }),
      ],
    }),
    reviewTable(sections),
  ];

  for (const section of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 140 },
        children: [
          new TextRun({ text: section.heading, font: BODY_FONT, bold: true, color: BLUE }),
        ],
      }),
      ...renderContent(section.content),
    );
  }

  if (Array.isArray(charts) && charts.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 120 },
        children: [
          new TextRun({ text: "[붙임] 도식 자료", font: BODY_FONT, bold: true, color: BLUE }),
        ],
      }),
    );
    const maxWidth = 480;
    for (const chart of charts) {
      try {
        const width = Math.min(maxWidth, chart.width || maxWidth);
        const height = Math.round((width / (chart.width || maxWidth)) * (chart.height || 300));
        children.push(
          new Paragraph({
            spacing: { before: 180, after: 60 },
            children: [new TextRun({ text: chart.title, font: BODY_FONT, bold: true })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [
              new ImageRun({
                type: "png",
                data: Buffer.from(chart.png, "base64"),
                transformation: { width, height },
              }),
            ],
          }),
        );
      } catch (error) {
        console.error("[docx] image embed failed", chart.title, error);
      }
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: BODY_FONT, size: 20, color: DARK },
          paragraph: { spacing: { line: 330 } },
        },
        heading1: { run: { font: BODY_FONT, size: 30, bold: true, color: BLUE } },
        title: { run: { font: BODY_FONT, size: 42, bold: true, color: DARK } },
      },
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
