import { Resvg } from "@resvg/resvg-js";
import { getKoreanFontPath } from "./font";

// LLM이 대화에서 추출하는 도식 데이터.
export interface VizData {
  tamSamSom?: { tam: string; sam: string; som: string; note?: string };
  journey?: { stages: string[] };
  funnel?: { stages: string[] };
  revenue?: { items: string[] };
}

export interface Chart {
  key: string;
  title: string;
  png: string; // base64
  width: number;
  height: number;
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

function wrap(svgInner: string, w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Pretendard"><rect width="${w}" height="${h}" fill="white"/>${svgInner}</svg>`;
}

// ── TAM-SAM-SOM 동심원 ──
function svgTamSamSom(d: NonNullable<VizData["tamSamSom"]>): { svg: string; w: number; h: number } {
  const w = 540, h = 380;
  const cx = 180, cy = 200;
  const circles = [
    { r: 150, fill: BLUE_SOFT[0], label: "TAM (전체 시장)", val: d.tam, ly: 70 },
    { r: 105, fill: BLUE_SOFT[2], label: "SAM (유효 시장)", val: d.sam, ly: 150 },
    { r: 60, fill: BLUE, label: "SOM (목표 시장)", val: d.som, ly: 210, white: true },
  ];
  let s = "";
  for (const c of circles) s += `<circle cx="${cx}" cy="${cy}" r="${c.r}" fill="${c.fill}"/>`;
  s += `<text x="${cx}" y="${cy + 4}" fill="white" font-size="13" text-anchor="middle" font-weight="700">SOM</text>`;
  // 우측 범례
  let ly = 60;
  for (const c of circles) {
    s += `<rect x="370" y="${ly - 12}" width="14" height="14" rx="3" fill="${c.fill}"/>`;
    s += `<text x="392" y="${ly}" fill="${INK}" font-size="13" font-weight="700">${esc(c.label)}</text>`;
    s += `<text x="392" y="${ly + 20}" fill="${BLUE}" font-size="14">${esc(c.val || "-")}</text>`;
    ly += 64;
  }
  if (d.note) s += `<text x="20" y="${h - 16}" fill="#9ca3af" font-size="11">※ ${esc(d.note)} (추정치)</text>`;
  return { svg: wrap(s, w, h), w, h };
}

// ── 고객 여정맵 (가로 단계) ──
function svgJourney(stages: string[]): { svg: string; w: number; h: number } {
  const items = stages.slice(0, 6);
  const w = Math.max(420, items.length * 150), h = 130;
  const bw = 120, gap = (w - items.length * bw) / (items.length + 1);
  let s = "";
  items.forEach((st, i) => {
    const x = gap + i * (bw + gap);
    s += `<rect x="${x}" y="40" width="${bw}" height="50" rx="10" fill="${BLUE_SOFT[1]}"/>`;
    s += `<text x="${x + bw / 2}" y="70" fill="${INK}" font-size="14" text-anchor="middle" font-weight="600">${esc(st)}</text>`;
    if (i < items.length - 1) {
      const ax = x + bw + gap / 2;
      s += `<text x="${ax}" y="71" fill="${BLUE}" font-size="20" text-anchor="middle">→</text>`;
    }
  });
  return { svg: wrap(s, w, h), w, h };
}

// ── 마케팅 퍼널 ──
function svgFunnel(stages: string[]): { svg: string; w: number; h: number } {
  const items = stages.slice(0, 5);
  const w = 460, h = 60 + items.length * 56;
  let s = "";
  const topW = 380, botW = 140, cx = w / 2;
  items.forEach((st, i) => {
    const t = i / Math.max(1, items.length);
    const t2 = (i + 1) / Math.max(1, items.length);
    const wTop = topW + (botW - topW) * t;
    const wBot = topW + (botW - topW) * t2;
    const y = 30 + i * 56;
    const fill = BLUE_SOFT[Math.min(i, BLUE_SOFT.length - 1)];
    s += `<polygon points="${cx - wTop / 2},${y} ${cx + wTop / 2},${y} ${cx + wBot / 2},${y + 48} ${cx - wBot / 2},${y + 48}" fill="${fill}"/>`;
    s += `<text x="${cx}" y="${y + 30}" fill="${INK}" font-size="14" text-anchor="middle" font-weight="600">${esc(st)}</text>`;
  });
  return { svg: wrap(s, w, h), w, h };
}

// ── 수익모델 (수익원 박스) ──
function svgRevenue(items: string[]): { svg: string; w: number; h: number } {
  const list = items.slice(0, 4);
  const w = 500;
  const bh = 46, gap = 12;
  const H = 60 + list.length * (bh + gap);
  let s = `<text x="20" y="34" fill="${INK}" font-size="15" font-weight="700">수익이 생기는 방법</text>`;
  list.forEach((it, i) => {
    const y = 50 + i * (bh + gap);
    s += `<rect x="20" y="${y}" width="${w - 40}" height="${bh}" rx="10" fill="${BLUE_SOFT[0]}" stroke="${BLUE}" stroke-width="1"/>`;
    s += `<circle cx="44" cy="${y + bh / 2}" r="10" fill="${BLUE}"/>`;
    s += `<text x="44" y="${y + bh / 2 + 4}" fill="white" font-size="12" text-anchor="middle">${i + 1}</text>`;
    s += `<text x="66" y="${y + bh / 2 + 5}" fill="${INK}" font-size="14">${esc(it)}</text>`;
  });
  return { svg: wrap(s, w, H), w, h: H };
}

async function toPng(svg: string): Promise<string> {
  const fontPath = await getKoreanFontPath();
  const png = new Resvg(svg, {
    font: { fontFiles: [fontPath], defaultFontFamily: "Pretendard", loadSystemFonts: false },
    background: "white",
  })
    .render()
    .asPng();
  return Buffer.from(png).toString("base64");
}

// VizData → 렌더된 차트 배열 (데이터 있는 것만).
export async function buildCharts(data: VizData): Promise<Chart[]> {
  const specs: { key: string; title: string; built: { svg: string; w: number; h: number } }[] = [];
  if (data.tamSamSom?.tam || data.tamSamSom?.som)
    specs.push({ key: "tamsamsom", title: "시장 규모 (TAM·SAM·SOM)", built: svgTamSamSom(data.tamSamSom) });
  if (data.journey?.stages?.length)
    specs.push({ key: "journey", title: "고객 여정 맵", built: svgJourney(data.journey.stages) });
  if (data.funnel?.stages?.length)
    specs.push({ key: "funnel", title: "마케팅 퍼널", built: svgFunnel(data.funnel.stages) });
  if (data.revenue?.items?.length)
    specs.push({ key: "revenue", title: "수익모델", built: svgRevenue(data.revenue.items) });

  const charts: Chart[] = [];
  for (const sp of specs) {
    try {
      charts.push({
        key: sp.key,
        title: sp.title,
        png: await toPng(sp.built.svg),
        width: sp.built.w,
        height: sp.built.h,
      });
    } catch (err) {
      console.error("[viz] render failed", sp.key, err);
    }
  }
  return charts;
}
