import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import {
  MODU_2026_DEADLINE_LABEL,
  MODU_DRAFT_SECTIONS,
  MODU_WORKSHEET_PROMPTS,
  type ModooDraftResult,
} from "@/lib/campaigns/modoo2026";

const FONT = "Malgun Gothic";
const BLUE = "1D4ED8";
const DARK = "18181B";
const MUTED = "52525B";
const RED = "B91C1C";

function body(text: string, options?: { bold?: boolean; color?: string; bullet?: boolean }): Paragraph {
  return new Paragraph({
    ...(options?.bullet ? { bullet: { level: 0 } } : {}),
    spacing: { after: 120, line: 340 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: 21,
        bold: options?.bold,
        color: options?.color ?? DARK,
      }),
    ],
  });
}

function title(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({
    heading: level,
    spacing: { before: level === HeadingLevel.HEADING_1 ? 0 : 260, after: 120 },
    children: [
      new TextRun({
        text,
        font: FONT,
        bold: true,
        color: level === HeadingLevel.HEADING_1 ? BLUE : DARK,
      }),
    ],
  });
}

function baseNotice(): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: "딱지원핏 작성 자료 · 공식 제출 서식 아님",
          font: FONT,
          bold: true,
          color: RED,
          size: 20,
        }),
      ],
    }),
    body(`공식 접수 마감: ${MODU_2026_DEADLINE_LABEL}`, { bold: true }),
    body(
      "모두의창업 공식 지원서는 전용 플랫폼에서 온라인으로 작성합니다. 이 Word 파일은 내용을 미리 정리하고 옮겨 적기 위한 작업용 자료입니다.",
      { color: MUTED },
    ),
  ];
}

export async function buildModooWorksheetDocxBuffer(): Promise<Buffer> {
  const children: Paragraph[] = [
    title("2026 모두의창업 딱지원핏 사실 정리 질문지", HeadingLevel.HEADING_1),
    ...baseNotice(),
    body(
      "공식 지원서 문항을 복제한 자료가 아닙니다. 고객 장면과 확인 가능한 근거를 먼저 정리하기 위한 딱지원핏 자체 질문지입니다.",
      { bold: true, color: BLUE },
    ),
  ];
  for (const prompt of MODU_WORKSHEET_PROMPTS) {
    children.push(title(prompt, HeadingLevel.HEADING_2));
    children.push(body("________________________________________________________________"));
    children.push(body("________________________________________________________________"));
    children.push(body("확인할 자료·출처: _______________________________________________", { color: MUTED }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export async function buildModooDraftDocxBuffer(draft: ModooDraftResult): Promise<Buffer> {
  const children: Paragraph[] = [
    title("2026 모두의창업 딱지원핏 작성 재료 정리본", HeadingLevel.HEADING_1),
    ...baseNotice(),
    body(
      "공식 문항과 일대일로 대응하는 문서가 아닙니다. 공식 플랫폼의 최신 입력 화면을 확인한 뒤 필요한 재료를 나눠 옮겨주세요.",
      { bold: true, color: BLUE },
    ),
  ];
  for (const section of MODU_DRAFT_SECTIONS) {
    children.push(title(section.label, HeadingLevel.HEADING_2));
    children.push(body(draft.answers[section.key]));
  }
  children.push(title("제출 전 보완할 사실", HeadingLevel.HEADING_2));
  if (draft.missingFacts.length === 0) children.push(body("추가로 표시된 보완 항목이 없습니다."));
  else draft.missingFacts.forEach((item) => children.push(body(item, { bullet: true, color: RED })));

  children.push(title("최종 확인", HeadingLevel.HEADING_2));
  if (draft.finalChecks.length === 0) {
    children.push(body("공식 플랫폼의 최신 질문과 글자 수를 확인해 옮겨 적어주세요.", { bullet: true }));
  } else {
    draft.finalChecks.forEach((item) => children.push(body(item, { bullet: true })));
  }
  children.push(
    body("선정 여부를 보장하지 않습니다. 대표자가 사실·숫자·자격 조건을 최종 확인해야 합니다.", {
      bold: true,
      color: RED,
    }),
  );
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
