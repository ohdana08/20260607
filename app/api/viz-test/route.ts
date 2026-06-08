import { Resvg } from "@resvg/resvg-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 카나리: Vercel에서 @resvg(SVG→PNG)가 동작하는지 확인용. 검증 후 삭제 예정.
export async function GET() {
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90"><rect width="240" height="90" rx="12" fill="#2563EB"/><text x="120" y="52" fill="white" font-size="22" text-anchor="middle" font-family="sans-serif">resvg OK</text></svg>`;
    const png = new Resvg(svg).render().asPng();
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) },
      { status: 500 },
    );
  }
}
