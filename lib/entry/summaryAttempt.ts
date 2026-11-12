import type { Program } from "../match/types.ts";
import { sourceEntrySummary, validateEntrySummary } from "./summary.ts";

export interface SummaryAttemptStore {
  claim(program: Program): Promise<boolean>;
  finish(program: Program, summary: ReturnType<typeof sourceEntrySummary>, failed: boolean): Promise<void>;
}
/** Dependency-injected core for deterministic no-network concurrency/failure tests. */
export async function summarizeEntryOnce(program: Program, store: SummaryAttemptStore, generate: (program: Program) => Promise<unknown>): Promise<boolean> {
  if (!(await store.claim(program))) return false;
  let summary = sourceEntrySummary(program), failed = false;
  try { summary = validateEntrySummary(program, await generate(program)); } catch { failed = true; }
  await store.finish(program, summary, failed);
  return true;
}
