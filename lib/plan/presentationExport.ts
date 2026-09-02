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
    market: ["tamsamsom"],
    solution: ["process", "journey"],
    competition: ["comparison"],
    business_model: ["revenue"],
    go_to_market: ["funnel", "journey"],
    roadmap_budget: ["roadmap"],
  };
  const preferred = chartKeys[slide.stageId] ?? [];
  return preferred.map((key) => charts.find((chart) => chart.key === key)).find(Boolean) ?? null;
}

function notesForSlide(slide: PresentationSlide): string {
  const sources = slide.sourceNotes.length > 0
    ? slide.sourceNotes.map((source) => `- ${source}`).join("\n")
    : "- 외부 출처 없음 · 사용자 제공 정보/사업계획서 기반";
  return `[발표자 대본]\n${slide.speakerNotes}\n\n[Sources]\n${sources}`;
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

function addContentSlide(
  pptx: PptxGenJS,
  item: PresentationSlide,
  index: number,
  total: number,
  chart: Chart | null,
): void {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };
  slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: PPT_H, fill: { color: COLORS.violet }, line: { transparency: 100 } });
  slide.addText(short(item.title, 52), {
    x: 0.75,
    y: 0.55,
    w: 11.7,
    h: 0.55,
    fontFace: "Malgun Gothic",
    fontSize: 26,
    bold: true,
    color: COLORS.ink,
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  slide.addText(short(item.headline, 92), {
    x: 0.75,
    y: 1.2,
    w: chart ? 6.1 : 11.4,
    h: 1.05,
    fontFace: "Malgun Gothic",
    fontSize: chart ? 20 : 23,
    bold: true,
    color: COLORS.violet,
    margin: 0,
    valign: "middle",
    fit: "shrink",
  });
  const bullets = item.bullets.slice(0, 5).map((bullet) => `• ${short(bullet, 86)}`).join("\n");
  slide.addText(bullets, {
    x: 0.8,
    y: 2.42,
    w: chart ? 5.65 : 10.9,
    h: 3.85,
    fontFace: "Malgun Gothic",
    fontSize: 18,
    color: COLORS.ink,
    breakLine: false,
    margin: 0.08,
    paraSpaceAfter: 14,
    valign: "top",
    fit: "shrink",
  });
  if (chart) {
    slide.addShape("roundRect", {
      x: 6.75,
      y: 1.32,
      w: 5.85,
      h: 4.95,
      rectRadius: 0.06,
      fill: { color: COLORS.white },
      line: { color: COLORS.line, width: 1 },
    });
    slide.addImage({
      data: `data:image/png;base64,${chart.png}`,
      x: 7.05,
      y: 1.7,
      w: 5.25,
      h: 4.2,
      transparency: 0,
    });
  } else {
    slide.addShape("roundRect", {
      x: 0.8,
      y: 6.38,
      w: 11.7,
      h: 0.42,
      fill: { color: COLORS.violetSoft },
      line: { transparency: 100 },
    });
    slide.addText(short(item.visualBrief || "발표자의 실제 경험과 근거를 중심으로 설명", 110), {
      x: 1.05,
      y: 6.48,
      w: 11.2,
      h: 0.17,
      fontFace: "Malgun Gothic",
      fontSize: 9,
      color: COLORS.violet,
      margin: 0,
      align: "center",
    });
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
    fontSize: 26,
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
      fontSize: 18,
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
      fontSize: 14,
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
        fontSize: 9,
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
  const title = wrapLines(slide.title, 34, 1);
  const headline = wrapLines(slide.headline, chart ? 36 : 54, 2);
  const bullets = slide.bullets.slice(0, 5).flatMap((bullet) => wrapLines(`• ${bullet}`, chart ? 42 : 68, 2));
  const chartSvg = chart
    ? `<rect x="810" y="150" width="700" height="590" rx="22" fill="#FFFFFF" stroke="#${COLORS.line}"/><image href="data:image/png;base64,${chart.png}" x="850" y="200" width="620" height="500" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="95" y="755" width="1410" height="52" rx="18" fill="#${COLORS.violetSoft}"/>${svgText(wrapLines(slide.visualBrief || "발표자의 실제 경험과 근거를 중심으로 설명", 82, 1), 150, 788, 18, COLORS.violet, 600)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}" font-family="Pretendard"><rect width="1600" height="900" fill="#${COLORS.paper}"/><rect width="22" height="900" fill="#${COLORS.violet}"/>${svgText(title, 95, 92, 44, COLORS.ink, 800)}${svgText(headline, 95, 188, chart ? 34 : 40, COLORS.violet, 800)}${svgText(bullets, 105, 360, 26, COLORS.ink, 500, 1.45)}${chartSvg}<line x1="95" y1="842" x2="1505" y2="842" stroke="#${COLORS.line}"/><text x="95" y="872" fill="#${COLORS.muted}" font-size="14">딱지원핏 · 근거 기반 발표자료</text><text x="1505" y="872" text-anchor="end" fill="#${COLORS.muted}" font-size="14">${number} / ${total}</text></svg>`;
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
