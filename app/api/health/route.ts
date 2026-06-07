// Liveness probe. Kept dependency-free so it works before any external
// service (DB, LLM, public APIs) is wired up.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "gov-plan",
    phase: 0,
    time: new Date().toISOString(),
  });
}
