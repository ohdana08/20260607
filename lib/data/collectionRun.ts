import { randomUUID } from "node:crypto";
import { COLLECTABLE_SOURCES, collectSource } from "./collect";
import { upsertAndDiff } from "@/lib/supabase/programs";
import { collectionErrorFields } from "./collectionError";

// Shared by cron and CLI so both expose the same collect/persist failure boundary.
// The public cron response retains { ok, runAt, summaries, failures } and HTTP 200.
export async function runCollection(runAt = new Date()) {
  const runId = randomUUID();
  const started = Date.now();
  const log = (event: string, fields: Record<string, unknown>, failed = false) => {
    const line = JSON.stringify({ component: "collect-programs", event, runId, runAt: runAt.toISOString(), ...fields });
    if (failed) console.error(line);
    else console.log(line);
  };
  log("collection_started", { sourceCount: COLLECTABLE_SOURCES.length });
  const results = await Promise.allSettled(COLLECTABLE_SOURCES.map(async (source) => {
    let stage: "collect" | "persist" = "collect";
    const sourceStarted = Date.now();
    log("collection_source_started", { source, stage });
    try {
      const items = await collectSource(source);
      stage = "persist";
      log("collection_source_persisting", { source, stage, collected: items.length, durationMs: Date.now() - sourceStarted });
      const summary = await upsertAndDiff(source, items, runAt);
      log("collection_source_finished", {
        source, outcome: items.length ? "success" : "empty", durationMs: Date.now() - sourceStarted,
        seen: summary.seen, new: summary.new, closed: summary.closed, deadlineChanged: summary.deadlineChanged,
      });
      return summary;
    } catch (error) {
      log("collection_source_failed", { source, stage, durationMs: Date.now() - sourceStarted, ...collectionErrorFields(error) }, true);
      throw error;
    }
  }));
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [{ source: COLLECTABLE_SOURCES[index], error: String(result.reason) }] : []);
  const summaries = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  log("collection_finished", { outcome: failures.length ? "partial_failure" : "success", durationMs: Date.now() - started, failureCount: failures.length });
  return { ok: failures.length === 0, runAt: runAt.toISOString(), summaries, failures };
}
