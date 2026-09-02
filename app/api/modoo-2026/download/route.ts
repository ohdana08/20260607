import {
  MODU_2026_NOTICE_HWPX_URL,
  MODU_2026_NOTICE_PDF_URL,
  normalizeModooDraftResult,
} from "@/lib/campaigns/modoo2026";
import {
  buildModooDraftDocxBuffer,
  buildModooWorksheetDocxBuffer,
} from "@/lib/campaigns/modoo2026-docx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const OFFICIAL_FILES = {
  "notice-pdf": {
    url: MODU_2026_NOTICE_PDF_URL,
    filename: "2026_모두의창업_2차_공고문.pdf",
    contentType: "application/pdf",
  },
  "notice-hwpx": {
    url: MODU_2026_NOTICE_HWPX_URL,
    filename: "2026_모두의창업_2차_공고문.hwpx",
    contentType: "application/vnd.hancom.hwpx",
  },
} as const;

function downloadResponse(data: BodyInit, filename: string, contentType: string): Response {
  const encoded = encodeURIComponent(filename);
  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const file = new URL(request.url).searchParams.get("file");
  if (file === "worksheet-docx") {
    const buffer = await buildModooWorksheetDocxBuffer();
    return downloadResponse(
      new Uint8Array(buffer),
      "모두의창업_딱지원핏_아이디어정리질문지.docx",
      DOCX_TYPE,
    );
  }

  const resource = OFFICIAL_FILES[file as keyof typeof OFFICIAL_FILES];
  if (!resource) return Response.json({ error: "다운로드 파일을 찾지 못했어요." }, { status: 404 });

  try {
    const upstream = await fetch(resource.url, {
      cache: "no-store",
      headers: {
        Referer: "https://www.mss.go.kr/",
        "User-Agent": "Mozilla/5.0 (compatible; Ddakfit/1.0)",
      },
    });
    if (!upstream.ok) throw new Error(`official download ${upstream.status}`);
    const fileBuffer = await upstream.arrayBuffer();
    if (fileBuffer.byteLength < 1_000) throw new Error("official download was empty");
    return downloadResponse(new Uint8Array(fileBuffer), resource.filename, resource.contentType);
  } catch (error) {
    console.error("[/api/modoo-2026/download] official download failed", error);
    return Response.json(
      {
        error: "공식 파일 연결이 잠시 원활하지 않아요. 공식 공고 페이지에서 내려받아 주세요.",
        officialUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?bcIdx=1070586&cbIdx=310&parentSeq=1070586",
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "지원서 초안을 읽지 못했어요." }, { status: 400 });
  }
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>).draft : null;
  const draft = normalizeModooDraftResult(source);
  if (!draft) return Response.json({ error: "지원서 초안 형식이 올바르지 않아요." }, { status: 400 });
  const buffer = await buildModooDraftDocxBuffer(draft);
  return downloadResponse(
    new Uint8Array(buffer),
    "모두의창업_딱지원핏_작성재료정리본.docx",
    DOCX_TYPE,
  );
}
