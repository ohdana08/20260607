import PptxGenJS from "pptxgenjs";
import { PDFDocument } from "pdf-lib";
import { Resvg } from "@resvg/resvg-js";
import type { Chart } from "../viz/svg.ts";
import { getKoreanFontPath } from "../viz/font.ts";
import type {
  PresentationPack,
  PresentationQa,
  PresentationSlide,
  PresentationStageId,
} from "./presentation";

const PPT_H = 7.5;
const SVG_W = 1600;
const SVG_H = 900;
const COLORS = {
  ink: "18212F",
  muted: "667085",
  violet: "6D28D9",
  violetSoft: "F3E8FF",
  blue: "2563EB",
  line: "E4E7EC",
  paper: "FAFAFC",
  white: "FFFFFF",
};

function short(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, Math.max(1, limit - 1))}…` : clean;
}

function chartForSlide(slide: PresentationSlide, charts: Chart[]): Chart | null {
  const chartKeys: Partial<Record<PresentationStageId, string[]>> = {
    problem: [],
    market: ["tamsamsom"],
    solution: ["process", "journey", "concept"],
    validation: ["validation", "validationPlan"],
    competition: ["comparison"],
    business_model: ["revenue"],
    go_to_market: ["funnel", "journey"],
    roadmap_budget: ["roadmap", "executionPlan"],
  };
  const preferred = chartKeys[slide.stageId] ?? [];
  return preferred.map((key) => charts.find((chart) => chart.key === key)).find(Boolean) ?? null;
}

function containedImageBox(chart: Chart, x: number, y: number, width: number, height: number) {
  const sourceRatio = Math.max(0.01, chart.width / Math.max(1, chart.height));
  const boxRatio = width / height;
  if (sourceRatio >= boxRatio) {
    const fittedHeight = width / sourceRatio;
    return { x, y: y + (height - fittedHeight) / 2, w: width, h: fittedHeight };
  }
  const fittedWidth = height * sourceRatio;
  return { x: x + (width - fittedWidth) / 2, y, w: fittedWidth, h: height };
}

function notesForSlide(slide: PresentationSlide): string {
  const sources = slide.sourceNotes.length > 0
    ? slide.sourceNotes.map((source) => `- ${source}`).join("\n")
    : "- 외부 출처 없음 · 사용자 제공 정보/사업계획서 기반";
  return `[슬라이드 핵심 내용]\n${slide.bullets.join("\n")}\n\n[발표자 대본]\n${slide.speakerNotes}\n\n[Sources]\n${sources}`;
}

function addFooter(slide: PptxGenJS.Slide, number: number, total: number): void {
  slide.addShape("line", {
    x: 0.65,
    y: 7.05,
    w: 12.03,
    h: 0,
    line: { color: COLORS.line, width: 1 },
  });
  slide.addText("딱지원핏 · 근거 기반 발표자료", {
    x: 0.68,
    y: 7.12,
    w: 4.5,
    h: 0.18,
    fontFace: "Malgun Gothic",
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
  slide.addText(`${number} / ${total}`, {
    x: 11.65,
    y: 7.12,
    w: 1,
    h: 0.18,
    align: "right",
    fontFace: "Aptos",
    fontSize: 8,
    color: COLORS.muted,
    margin: 0,
  });
}

function addContentSlide(pptx: PptxGenJS, item: PresentationSlide, index: number, total: number, chart: Chart | null): void {
  const slide = pptx.addSlide();
  const planning = chart?.planningCards?.length ? chart.planningCards : null;
  const sideChart = chart && !planning;
  slide.background = { color: COLORS.paper };
  slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: PPT_H, fill: { color: COLORS.violet }, line: { transparency: 100 } });
  slide.addText(item.title, { x: 0.75, y: 0.55, w: 11.7, h: 0.72, fontFace: "Malgun Gothic", fontSize: 35, bold: true, color: COLORS.ink, margin: 0, fit: "shrink" });
  slide.addText(item.headline, { x: 0.75, y: 1.38, w: sideChart ? 5.65 : 11.7, h: 0.98, fontFace: "Malgun Gothic", fontSize: sideChart ? 24 : 28, bold: true, color: COLORS.violet, margin: 0, fit: "shrink" });
  if (sideChart) {
    slide.addText(item.bullets.map(bullet => `• ${bullet}`).join("\n"), { x: 0.8, y: 2.6, w: 5.65, h: 3.5, fontFace: "Malgun Gothic", fontSize: 18, color: COLORS.ink, margin: 0.06, paraSpaceAfter: 14, fit: "shrink" });
    slide.addImage({ data: `data:image/png;base64,${chart.png}`, ...containedImageBox(chart, 7.05, 1.7, 5.25, 4.7) });
  } else {
    const cards = planning ?? item.bullets.slice(0, 5).map((body, i) => ({ label: String(i + 1).padStart(2, "0"), body }));
    const gap = 0.22;
    const columns = Math.max(1, Math.min(3, cards.length));
    const rows = Math.max(1, Math.ceil(cards.length / columns));
    const compact = rows > 1;
    const width = (11.8 - gap * (columns - 1)) / columns;
    const height = (3.73 - 0.18 * (rows - 1)) / rows;
    cards.forEach((card, i) => {
      const x = 0.8 + (i % columns) * (width + gap);
      const y = 2.75 + Math.floor(i / columns) * (height + 0.18);
      slide.addShape("roundRect", { x, y, w: width, h: height, fill: { color: COLORS.white }, line: { color: COLORS.line, width: 1 } });
      slide.addShape("rect", { x: x + 0.2, y: y + (compact ? 0.12 : 0.23), w: 0.48, h: 0.06, fill: { color: COLORS.violet }, line: { transparency: 100 } });
      slide.addText(card.label, { x: x + 0.22, y: y + (compact ? 0.24 : 0.43), w: width - 0.44, h: compact ? 0.3 : planning ? 0.63 : 0.6, fontFace: "Malgun Gothic", fontSize: planning || compact ? 18 : 34, bold: true, color: COLORS.violet, margin: 0, fit: "shrink" });
      slide.addText(card.body, { x: x + 0.22, y: y + (compact ? 0.68 : 1.2), w: width - 0.44, h: height - (compact ? 0.82 : 1.46), fontFace: "Malgun Gothic", fontSize: planning ? 14 : compact ? 16 : 22, color: COLORS.ink, margin: 0, valign: "top", fit: "shrink", breakLine: false });
    });
    if (planning) slide.addText("검토안 · 현재 상태와 향후 계획을 구분한 자료이며 검증된 성과가 아닙니다.", { x: 0.8, y: 6.66, w: 11.8, h: 0.2, fontFace: "Malgun Gothic", fontSize: 9, color: COLORS.muted, margin: 0 });
  }
  addFooter(slide, index + 1, total);
  slide.addNotes(notesForSlide(item));
}

function addQaSlide(
  pptx: PptxGenJS,
  items: PresentationQa[],
  groupIndex: number,
  pageNumber: number,
  total: number,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };
  slide.addText("예상 질문과 대표자 답변", {
    x: 0.75,
    y: 0.55,
    w: 11.7,
    h: 0.55,
    fontFace: "Malgun Gothic",
    fontSize: 35,
    bold: true,
    color: COLORS.ink,
    margin: 0,
  });
  items.forEach((item, itemIndex) => {
    const y = 1.4 + itemIndex * 2.52;
    slide.addText(`Q${groupIndex * 2 + itemIndex + 1}. ${short(item.question, 70)}`, {
      x: 0.8,
      y,
      w: 11.6,
      h: 0.48,
      fontFace: "Malgun Gothic",
      fontSize: 24,
      bold: true,
      color: COLORS.violet,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(short(item.answer, 220), {
      x: 0.95,
      y: y + 0.62,
      w: 11.15,
      h: 1.22,
      fontFace: "Malgun Gothic",
      fontSize: 16,
      color: COLORS.ink,
      margin: 0.04,
      fit: "shrink",
      valign: "top",
    });
    if (item.risk) {
      slide.addText(`주의 · ${short(item.risk, 110)}`, {
        x: 0.95,
        y: y + 1.92,
        w: 11.15,
        h: 0.26,
        fontFace: "Malgun Gothic",
        fontSize: 16,
        color: "B54708",
        margin: 0,
      });
    }
  });
  const notes = items.map((item, itemIndex) => {
    const sources = item.sourceNotes.length
      ? item.sourceNotes.map((source) => `- ${source}`).join("\n")
      : "- 외부 출처 없음 · 사용자 제공 정보/사업계획서 기반";
    return `[Q${groupIndex * 2 + itemIndex + 1}] ${item.question}\n${item.answer}\n주의: ${item.risk || "없음"}\n[Sources]\n${sources}`;
  }).join("\n\n");
  slide.addNotes(notes);
  addFooter(slide, pageNumber, total);
}

export async function buildPresentationPptxBuffer(
  pack: PresentationPack,
  charts: Chart[] = [],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "딱지원핏";
  pptx.company = "BCC Consulting";
  pptx.subject = "정부지원사업 근거 기반 발표자료";
  pptx.title = pack.title;
  pptx.theme = {
    headFontFace: "Malgun Gothic",
    bodyFontFace: "Malgun Gothic",
  };

  const qaGroups: PresentationQa[][] = [];
  for (let index = 0; index < pack.qa.length; index += 2) qaGroups.push(pack.qa.slice(index, index + 2));
  const total = pack.slides.length + qaGroups.length;
  pack.slides.forEach((slide, index) => addContentSlide(pptx, slide, index, total, chartForSlide(slide, charts)));
  qaGroups.forEach((items, index) =>
    addQaSlide(pptx, items, index, pack.slides.length + index + 1, total),
  );
  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (output instanceof ArrayBuffer) return Buffer.from(new Uint8Array(output));
  return Buffer.from(String(output), "binary");
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLines(value: string, limit: number, maxLines: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > limit && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, limit - 1))}…`;
  }
  return lines;
}

function svgText(lines: string[], x: number, y: number, size: number, color: string, weight = 400, gap = 1.25): string {
  return `<text x="${x}" y="${y}" fill="#${color}" font-size="${size}" font-weight="${weight}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : Math.round(size * gap)}">${esc(line)}</tspan>`).join("")}</text>`;
}

function slideSvg(slide: PresentationSlide, number: number, total: number, chart: Chart | null): string {
  const planning = chart?.planningCards?.length ? chart.planningCards : null;
  const sideChart = chart && !planning;
  let content = "";
  if (sideChart) {
    const bullets = slide.bullets.slice(0, 5).flatMap(bullet => wrapLines(`• ${bullet}`, 24, 3));
    content = `${svgText(bullets, 105, 360, 26, COLORS.ink, 500, 1.45)}<image href="data:image/png;base64,${chart.png}" x="850" y="200" width="620" height="550" preserveAspectRatio="xMidYMid meet"/>`;
  } else {
    const cards = planning ?? slide.bullets.slice(0, 5).map((body, i) => ({ label: String(i + 1).padStart(2, "0"), body }));
    const columns = Math.max(1, Math.min(3, cards.length));
    const rows = Math.max(1, Math.ceil(cards.length / columns));
    const compact = rows > 1;
    const gap = 28, width = (1410 - gap * (columns - 1)) / columns;
    const height = (460 - 20 * (rows - 1)) / rows;
    content = cards.map((card, i) => {
      const x = 95 + (i % columns) * (width + gap);
      const y = 320 + Math.floor(i / columns) * (height + 20);
      const labels = wrapLines(card.label, Math.floor((width - 52) / (planning ? 25 : 40)), 5);
      const bodyY = compact ? y + 80 : planning ? y + 88 + labels.length * 31 : y + 155;
      const bodySize = planning ? 23 : compact ? 24 : 31;
      const bodyLines = wrapLines(card.body, Math.floor((width - 52) / bodySize), 30);
      const fittedSize = Math.min(bodySize, (y + height - 35 - bodyY) / Math.max(1, bodyLines.length) / 1.3);
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="20" fill="#FFFFFF" stroke="#${COLORS.line}"/><rect x="${x + 26}" y="${y + (compact ? 16 : 29)}" width="58" height="7" fill="#${COLORS.violet}"/>${svgText(labels, x + 26, y + (compact ? 46 : 86), planning ? 25 : compact ? 26 : 40, COLORS.violet, 700)}${svgText(bodyLines, x + 26, bodyY, fittedSize, COLORS.ink, 500, 1.3)}`;
    }).join("");
    if (planning) content += svgText(["검토안 · 현재 상태와 향후 계획을 구분한 자료이며 검증된 성과가 아닙니다."], 95, 810, 16, COLORS.muted);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" font-family="Pretendard"><rect width="1600" height="900" fill="#${COLORS.paper}"/><rect width="22" height="900" fill="#${COLORS.violet}"/>${svgText(wrapLines(slide.title, 34, 1), 95, 92, 44, COLORS.ink, 800)}${svgText(wrapLines(slide.headline, sideChart ? 19 : 35, 3), 95, 188, sideChart ? 34 : 40, COLORS.violet, 800)}${content}<line x1="95" y1="842" x2="1505" y2="842" stroke="#${COLORS.line}"/><text x="95" y="872" fill="#${COLORS.muted}" font-size="14">딱지원핏 · 근거 기반 발표자료</text><text x="1505" y="872" text-anchor="end" fill="#${COLORS.muted}" font-size="14">${number} / ${total}</text></svg>`;
}

function qaSvg(items: PresentationQa[], groupIndex: number, number: number, total: number): string {
  const blocks = items.map((item, itemIndex) => {
    const y = 180 + itemIndex * 320;
    return `${svgText(wrapLines(`Q${groupIndex * 2 + itemIndex + 1}. ${item.question}`, 62, 2), 100, y, 30, COLORS.violet, 800)}${svgText(wrapLines(item.answer, 82, 5), 120, y + 100, 23, COLORS.ink, 500, 1.4)}${item.risk ? svgText(wrapLines(`주의 · ${item.risk}`, 94, 2), 120, y + 240, 17, "B54708", 600) : ""}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" font-family="Pretendard"><rect width="1600" height="900" fill="#${COLORS.paper}"/>${svgText(["예상 질문과 대표자 답변"], 95, 92, 44, COLORS.ink, 800)}${blocks}<line x1="95" y1="842" x2="1505" y2="842" stroke="#${COLORS.line}"/><text x="95" y="872" fill="#${COLORS.muted}" font-size="14">딱지원핏 · Q&amp;A 부록</text><text x="1505" y="872" text-anchor="end" fill="#${COLORS.muted}" font-size="14">${number} / ${total}</text></svg>`;
}

async function svgToPng(svg: string, fontPath: string): Promise<Uint8Array> {
  return new Resvg(svg, {
    font: { fontFiles: [fontPath], defaultFontFamily: "Pretendard", loadSystemFonts: false },
    background: "white",
  }).render().asPng();
}

export async function buildPresentationPdfBuffer(
  pack: PresentationPack,
  charts: Chart[] = [],
): Promise<Buffer> {
  const fontPath = await getKoreanFontPath();
  const pdf = await PDFDocument.create();
  const qaGroups: PresentationQa[][] = [];
  for (let index = 0; index < pack.qa.length; index += 2) qaGroups.push(pack.qa.slice(index, index + 2));
  const total = pack.slides.length + qaGroups.length;
  const svgs = [
    ...pack.slides.map((slide, index) => slideSvg(slide, index + 1, total, chartForSlide(slide, charts))),
    ...qaGroups.map((items, index) => qaSvg(items, index, pack.slides.length + index + 1, total)),
  ];
  for (const svg of svgs) {
    const image = await pdf.embedPng(await svgToPng(svg, fontPath));
    const page = pdf.addPage([960, 540]);
    page.drawImage(image, { x: 0, y: 0, width: 960, height: 540 });
  }
  pdf.setTitle(pack.title);
  pdf.setAuthor("딱지원핏");
  pdf.setSubject("정부지원사업 근거 기반 발표자료");
  return Buffer.from(await pdf.save());
}
