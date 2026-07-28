import { NextRequest } from "next/server";
import { COLLECTABLE_SOURCES, collectSource } from "@/lib/data/collect";
import { upsertAndDiff } from "@/lib/supabase/programs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel Cron and the one-off release check both authenticate with CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runAt = new Date();
  const results = await Promise.allSettled(
    COLLECTABLE_SOURCES.map(async (source) => upsertAndDiff(source, await collectSource(source), runAt)),
  );

  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ source: COLLECTABLE_SOURCES[index], error: String(result.reason) }]
      : [],
  );
  const summaries = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

  if (failures.length > 0) {
    console.error("[collect-programs] partial failure", failures);
  }

  return Response.json({
    ok: failures.length === 0,
    runAt: runAt.toISOString(),
    summaries,
    failures,
  });
}
