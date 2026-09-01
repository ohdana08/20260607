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
  key?: string;
  title: string;
  png: string;
  width: number;
  height: number;
  targetSection?: string;
  sourceNote?: string;
}

export interface PlanDocxEvidenceSource {
  id: string;
  title: string;
  publisher: string;
  checkedAt: string;
  url: string;
  claim?: string;
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

function normalizedHeading(value: string): string {
  return (value || "").replace(/[\s·:：()（）\[\]]/g, "").toLowerCase();
}

function chartMatchesSection(chart: PlanDocxChart, sectionHeading: string): boolean {
  const target = normalizedHeading(chart.targetSection || "");
  const heading = normalizedHeading(sectionHeading);
  if (!target || !heading) return false;
  return heading.includes(target) || target.includes(heading);
}

function renderChart(chart: PlanDocxChart): Paragraph[] {
  const maxWidth = 480;
  const width = Math.min(maxWidth, chart.width || maxWidth);
  const rawHeight = Math.round((width / (chart.width || maxWidth)) * (chart.height || 300));
  const height = Math.min(620, rawHeight);
  const paragraphs = [
    new Paragraph({
      spacing: { before: 180, after: 60 },
      children: [new TextRun({ text: chart.title, font: BODY_FONT, bold: true, color: DARK, size: 21 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: chart.sourceNote ? 40 : 120 },
      children: [
        new ImageRun({
          type: "png",
          data: Buffer.from(chart.png, "base64"),
          transformation: { width, height },
        }),
      ],
    }),
  ];
  if (chart.sourceNote) {
    paragraphs.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `출처·기준: ${chart.sourceNote}`,
            font: BODY_FONT,
            color: MUTED,
            size: 16,
          }),
        ],
      }),
    );
  }
  return paragraphs;
}

export async function buildPlanDocxBuffer(
  title: string | undefined,
  sections: PlanDocxSection[],
  charts: PlanDocxChart[] = [],
  evidenceSources: PlanDocxEvidenceSource[] = [],
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
        new TextRun({ text: "정부지원사업 제출용 사업계획서", font: BODY_FONT, color: MUTED, size: 24 }),
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

  const embeddedCharts = new Set<number>();
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
    charts.forEach((chart, index) => {
      if (embeddedCharts.has(index) || !chartMatchesSection(chart, section.heading)) return;
      try {
        children.push(...renderChart(chart));
        embeddedCharts.add(index);
      } catch (error) {
        console.error("[docx] inline image embed failed", chart.title, error);
      }
    });
  }

  const remainingCharts = charts.filter((_, index) => !embeddedCharts.has(index));
  if (remainingCharts.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 120 },
        children: [
          new TextRun({ text: "[붙임] 도식 자료", font: BODY_FONT, bold: true, color: BLUE }),
        ],
      }),
    );
    for (const chart of remainingCharts) {
      try {
        children.push(...renderChart(chart));
      } catch (error) {
        console.error("[docx] image embed failed", chart.title, error);
      }
    }
  }

  if (evidenceSources.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 120 },
        children: [
          new TextRun({ text: "[붙임] 근거 출처", font: BODY_FONT, bold: true, color: BLUE }),
        ],
      }),
      new Paragraph({
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: "아래 확인일은 자동 조사 또는 사용자 첨부자료를 검토한 날짜입니다. 제출 직전 원문 최신성을 다시 확인해야 합니다.",
            font: BODY_FONT,
            color: MUTED,
            size: 18,
          }),
        ],
      }),
    );
    for (const source of evidenceSources.slice(0, 24)) {
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [
            new TextRun({
              text: `[${source.id}] ${source.title}`,
              font: BODY_FONT,
              bold: true,
              color: DARK,
              size: 19,
            }),
          ],
        }),
        new Paragraph({
          spacing: { after: 30 },
          children: [
            new TextRun({
              text: `${source.publisher || "사용자 제공 자료"} · 확인일 ${source.checkedAt.slice(0, 10)}`,
              font: BODY_FONT,
              color: MUTED,
              size: 16,
            }),
          ],
        }),
      );
      if (source.claim) children.push(textParagraph(`근거 주장: ${source.claim}`));
      if (source.url) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: source.url, font: BODY_FONT, color: BLUE, size: 16 })],
          }),
        );
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
