import { Resvg } from "@resvg/resvg-js";
import { getKoreanFontPath } from "./font";

interface EvidenceBound {
  evidenceIds?: string[];
  sourceNote?: string;
  targetSection?: string;
}

// 독립 발표 이미지가 아니라 A4 Word 본문에 삽입하는 데이터 밀도로 제한한다.
export interface VizData {
  tamSamSom?: EvidenceBound & { tam: string; sam: string; som: string; note?: string };
  process?: EvidenceBound & { stages: string[] };
  comparison?: EvidenceBound & {
    competitorNames: [string, string];
    rows: Array<{
      criterion: string;
      ours: string;
      competitor1: string;
      competitor2: string;
      evidenceIds?: string[];
    }>;
  };
  journey?: EvidenceBound & { stages: string[] };
  funnel?: EvidenceBound & { stages: string[] };
  revenue?: EvidenceBound & { items: string[] };
  roadmap?: EvidenceBound & {
    items: Array<{ period: string; action: string; output: string; owner: string }>;
  };
}

export interface Chart {
  key: string;
  title: string;
  png: string; // base64
  width: number;
  height: number;
  targetSection?: string;
  sourceNote?: string;
}

const BLUE = "#2563EB";
const BLUE_SOFT = ["#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6"];
const INK = "#1f2937";

function esc(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function short(s: string, length: number): string {
  const value = (s ?? "").trim();
  return value.length > length ? `${value.slice(0, Math.max(1, length - 1))}…` : value;
}

function wrap(svgInner: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Pretendard"><rect width="${w}" height="${h}" fill="white"/>${svgInner}</svg>`;
}

function footer(note: string | undefined, w: number, y: number): string {
  if (!note) return "";
  return `<line x1="20" y1="${y - 18}" x2="${w - 20}" y2="${y - 18}" stroke="#e5e7eb"/><text x="20" y="${y}" fill="#6b7280" font-size="10">출처·기준: ${esc(short(note, 104))}</text>`;
}

function svgTamSamSom(d: NonNullable<VizData["tamSamSom"]>): { svg: string; w: number; h: number } {
  const w = 540, h = 380;
  const cx = 180, cy = 190;
  const circles = [
    { r: 145, fill: BLUE_SOFT[0], label: "TAM (전체 시장)", val: d.tam },
    { r: 100, fill: BLUE_SOFT[2], label: "SAM (유효 시장)", val: d.sam },
    { r: 56, fill: BLUE, label: "SOM (목표 시장)", val: d.som },
  ];
  let s = "";
  for (const circle of circles) s += `<circle cx="${cx}" cy="${cy}" r="${circle.r}" fill="${circle.fill}"/>`;
  s += `<text x="${cx}" y="${cy + 4}" fill="white" font-size="13" text-anchor="middle" font-weight="700">SOM</text>`;
  let ly = 58;
  for (const circle of circles) {
    s += `<rect x="365" y="${ly - 12}" width="14" height="14" rx="3" fill="${circle.fill}"/>`;
    s += `<text x="387" y="${ly}" fill="${INK}" font-size="13" font-weight="700">${esc(circle.label)}</text>`;
    s += `<text x="387" y="${ly + 20}" fill="${BLUE}" font-size="13">${esc(short(circle.val || "-", 22))}</text>`;
    ly += 64;
  }
  s += footer(d.sourceNote || d.note, w, h - 16);
  return { svg: wrap(s, w, h), w, h };
}

function svgFlow(stages: string[], label: string, sourceNote?: string): { svg: string; w: number; h: number } {
  const items = stages.slice(0, 6);
  const w = 660, h = sourceNote ? 180 : 145;
  const bw = 90;
  const gap = (w - 40 - items.length * bw) / Math.max(1, items.length - 1);
  let s = `<text x="20" y="28" fill="${INK}" font-size="15" font-weight="700">${esc(label)}</text>`;
  items.forEach((stage, index) => {
    const x = 20 + index * (bw + gap);
    s += `<rect x="${x}" y="50" width="${bw}" height="58" rx="8" fill="${index === items.length - 1 ? BLUE : BLUE_SOFT[0]}" stroke="${BLUE}"/>`;
    s += `<text x="${x + bw / 2}" y="75" fill="${index === items.length - 1 ? "white" : INK}" font-size="12" text-anchor="middle" font-weight="600">${esc(short(stage, 12))}</text>`;
    s += `<text x="${x + bw / 2}" y="95" fill="${index === items.length - 1 ? "white" : "#4b5563"}" font-size="10" text-anchor="middle">${index + 1}단계</text>`;
    if (index < items.length - 1) {
      s += `<text x="${x + bw + gap / 2}" y="84" fill="${BLUE}" font-size="18" text-anchor="middle">→</text>`;
    }
  });
  s += footer(sourceNote, w, h - 16);
  return { svg: wrap(s, w, h), w, h };
}

function svgFunnel(stages: string[], sourceNote?: string): { svg: string; w: number; h: number } {
  const items = stages.slice(0, 5);
  const w = 460, h = 80 + items.length * 56 + (sourceNote ? 32 : 0);
  let s = "";
  const topW = 380, botW = 140, cx = w / 2;
  items.forEach((stage, index) => {
    const t = index / Math.max(1, items.length);
    const t2 = (index + 1) / Math.max(1, items.length);
    const wTop = topW + (botW - topW) * t;
    const wBot = topW + (botW - topW) * t2;
    const y = 24 + index * 56;
    const fill = BLUE_SOFT[Math.min(index, BLUE_SOFT.length - 1)];
    s += `<polygon points="${cx - wTop / 2},${y} ${cx + wTop / 2},${y} ${cx + wBot / 2},${y + 48} ${cx - wBot / 2},${y + 48}" fill="${fill}"/>`;
    s += `<text x="${cx}" y="${y + 30}" fill="${INK}" font-size="13" text-anchor="middle" font-weight="600">${esc(short(stage, 30))}</text>`;
  });
  s += footer(sourceNote, w, h - 16);
  return { svg: wrap(s, w, h), w, h };
}

function svgRevenue(items: string[], sourceNote?: string): { svg: string; w: number; h: number } {
  const list = items.slice(0, 4);
  const w = 560, bh = 46, gap = 12;
  const h = 68 + list.length * (bh + gap) + (sourceNote ? 32 : 0);
  let s = `<text x="20" y="34" fill="${INK}" font-size="15" font-weight="700">수익이 생기는 구조</text>`;
  list.forEach((item, index) => {
    const y = 50 + index * (bh + gap);
    s += `<rect x="20" y="${y}" width="${w - 40}" height="${bh}" rx="9" fill="${BLUE_SOFT[0]}" stroke="${BLUE}"/>`;
    s += `<circle cx="44" cy="${y + bh / 2}" r="10" fill="${BLUE}"/>`;
    s += `<text x="44" y="${y + bh / 2 + 4}" fill="white" font-size="12" text-anchor="middle">${index + 1}</text>`;
    s += `<text x="66" y="${y + bh / 2 + 5}" fill="${INK}" font-size="13">${esc(short(item, 58))}</text>`;
  });
  s += footer(sourceNote, w, h - 16);
  return { svg: wrap(s, w, h), w, h };
}

function svgComparison(d: NonNullable<VizData["comparison"]>): { svg: string; w: number; h: number } {
  const rows = d.rows.slice(0, 5);
  const w = 720, rowH = 58, top = 52, h = top + (rows.length + 1) * rowH + (d.sourceNote ? 34 : 12);
  const xs = [20, 160, 340, 520, 700];
  const headers = ["비교 기준", "우리 사업", d.competitorNames[0], d.competitorNames[1]];
  let s = `<text x="20" y="30" fill="${INK}" font-size="15" font-weight="700">핵심 경쟁 비교</text>`;
  headers.forEach((header, index) => {
    const width = xs[index + 1] - xs[index];
    s += `<rect x="${xs[index]}" y="${top}" width="${width}" height="${rowH}" fill="${index === 1 ? BLUE : "#e5e7eb"}" stroke="white"/>`;
    s += `<text x="${xs[index] + width / 2}" y="${top + 34}" fill="${index === 1 ? "white" : INK}" font-size="12" text-anchor="middle" font-weight="700">${esc(short(header, 17))}</text>`;
  });
  rows.forEach((row, rowIndex) => {
    const values = [row.criterion, row.ours, row.competitor1, row.competitor2];
    values.forEach((value, colIndex) => {
      const x = xs[colIndex], y = top + (rowIndex + 1) * rowH, width = xs[colIndex + 1] - x;
      s += `<rect x="${x}" y="${y}" width="${width}" height="${rowH}" fill="${colIndex === 1 ? BLUE_SOFT[0] : rowIndex % 2 ? "#f9fafb" : "white"}" stroke="#d1d5db"/>`;
      s += `<text x="${x + width / 2}" y="${y + 34}" fill="${INK}" font-size="11" text-anchor="middle" font-weight="${colIndex < 2 ? 600 : 400}">${esc(short(value, 22))}</text>`;
    });
  });
  s += footer(d.sourceNote, w, h - 14);
  return { svg: wrap(s, w, h), w, h };
}

function svgRoadmap(d: NonNullable<VizData["roadmap"]>): { svg: string; w: number; h: number } {
  const items = d.items.slice(0, 6);
  const w = 700, rowH = 58, h = 56 + items.length * rowH + (d.sourceNote ? 36 : 14);
  let s = `<text x="20" y="30" fill="${INK}" font-size="15" font-weight="700">실행 로드맵</text>`;
  items.forEach((item, index) => {
    const y = 48 + index * rowH;
    s += `<rect x="20" y="${y}" width="105" height="44" rx="8" fill="${index === 0 ? BLUE : BLUE_SOFT[0]}"/>`;
    s += `<text x="72" y="${y + 27}" fill="${index === 0 ? "white" : INK}" font-size="12" text-anchor="middle" font-weight="700">${esc(short(item.period, 13))}</text>`;
    s += `<line x1="125" y1="${y + 22}" x2="145" y2="${y + 22}" stroke="${BLUE}" stroke-width="2"/>`;
    s += `<rect x="145" y="${y}" width="535" height="44" rx="8" fill="#f9fafb" stroke="#d1d5db"/>`;
    s += `<text x="162" y="${y + 18}" fill="${INK}" font-size="11" font-weight="700">${esc(short(item.action, 36))}</text>`;
    s += `<text x="162" y="${y + 34}" fill="#4b5563" font-size="10">산출물 ${esc(short(item.output, 32))} · 담당 ${esc(short(item.owner, 16))}</text>`;
  });
  s += footer(d.sourceNote, w, h - 14);
  return { svg: wrap(s, w, h), w, h };
}

async function toPng(svg: string): Promise<string> {
  const fontPath = await getKoreanFontPath();
  const png = new Resvg(svg, {
    font: { fontFiles: [fontPath], defaultFontFamily: "Pretendard", loadSystemFonts: false },
    background: "white",
  }).render().asPng();
  return Buffer.from(png).toString("base64");
}

// 후보는 최대 6종이다. 데이터·근거가 충분해 실제로 생성된 것만 반환한다.
export async function buildCharts(data: VizData): Promise<Chart[]> {
  const specs: Array<{
    key: string;
    title: string;
    built: { svg: string; w: number; h: number };
    meta: EvidenceBound;
  }> = [];
  if (data.tamSamSom?.tam && data.tamSamSom?.sam && data.tamSamSom?.som && data.tamSamSom.evidenceIds?.length) {
    specs.push({ key: "tamsamsom", title: "시장 규모 (TAM·SAM·SOM)", built: svgTamSamSom(data.tamSamSom), meta: data.tamSamSom });
  }
  if (data.process?.stages?.length && (data.process.evidenceIds?.length || data.process.sourceNote)) {
    specs.push({ key: "process", title: "사업 운영 프로세스", built: svgFlow(data.process.stages, "사업 운영 프로세스", data.process.sourceNote), meta: data.process });
  }
  if (data.comparison?.rows?.length && data.comparison.rows.every((row) => row.evidenceIds?.length)) {
    specs.push({ key: "comparison", title: "경쟁우위 비교", built: svgComparison(data.comparison), meta: data.comparison });
  }
  if (data.journey?.stages?.length && (data.journey.evidenceIds?.length || data.journey.sourceNote)) {
    specs.push({ key: "journey", title: "고객 여정", built: svgFlow(data.journey.stages, "고객 여정", data.journey.sourceNote), meta: data.journey });
  }
  if (data.revenue?.items?.length && (data.revenue.evidenceIds?.length || data.revenue.sourceNote)) {
    specs.push({ key: "revenue", title: "수익모델", built: svgRevenue(data.revenue.items, data.revenue.sourceNote), meta: data.revenue });
  }
  if (data.roadmap?.items?.length && data.roadmap.evidenceIds?.length && data.roadmap.sourceNote) {
    specs.push({ key: "roadmap", title: "실행 로드맵", built: svgRoadmap(data.roadmap), meta: data.roadmap });
  }
  // 기존 저장 데이터의 funnel은 호환만 유지하며 6종 후보를 초과하지 않는다.
  if (specs.length < 6 && data.funnel?.stages?.length && (data.funnel.evidenceIds?.length || data.funnel.sourceNote)) {
    specs.push({ key: "funnel", title: "마케팅 퍼널", built: svgFunnel(data.funnel.stages, data.funnel.sourceNote), meta: data.funnel });
  }

  const charts: Chart[] = [];
  for (const spec of specs.slice(0, 6)) {
    try {
      charts.push({
        key: spec.key,
        title: spec.title,
        png: await toPng(spec.built.svg),
        width: spec.built.w,
        height: spec.built.h,
        targetSection: spec.meta.targetSection,
        sourceNote: spec.meta.sourceNote,
      });
    } catch (error) {
      console.error("[viz] render failed", spec.key, error);
    }
  }
  return charts;
}
