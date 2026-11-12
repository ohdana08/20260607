import { createAdminClient } from "@/lib/supabase/admin";
import type { Program } from "@/lib/match/types";
import type { EntryConditions } from "./conditions";
import type { EntryCard } from "./types";
import { entryDate, matchEntryPrograms, safeEntryUrl } from "./match";
import { sourceEntrySummary } from "./summary";

export async function entryCards(programs: Program[]): Promise<EntryCard[]> {
  const summaries = new Map<string, { description: string; source_url: string; source_summary: string; source_target: string }>();
  if (programs.length && process.env.ENTRY_SUMMARY_ENABLED === "true") {
    const { data, error } = await createAdminClient().from("program_entry_summaries")
      .select("program_id,description,source_url,source_summary,source_target").eq("status", "ready").in("program_id", programs.map((p) => p.id));
    if (!error) for (const row of data ?? []) summaries.set(row.program_id, row);
    // A missing migration or failed summary never blocks free source-based cards.
  }
  return programs.map((p) => {
    const original = sourceEntrySummary(p);
    const cached = summaries.get(p.id);
    const description = cached && cached.source_url === p.url && cached.source_summary === p.summary && cached.source_target === p.target ? cached.description : original.description;
    return { id: p.id, title: p.title, ...original, description, url: p.url,
      previewUrl: `/embed?start=direct&noticeUrl=${encodeURIComponent(p.url)}` };
  });
}
export async function getEntryCatalog(now = new Date()): Promise<Program[]> {
  const db = createAdminClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const programs: Program[] = [];
  const pageSize = 1000;
  const signal = AbortSignal.timeout(15000);
  // Stable pages avoid the existing capped read path: do not quietly report a
  // partial catalogue as a complete match count. Timeouts fail visibly instead.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("programs")
      .select("id,source,title,summary,target,support_field,region,apply_end,url,form_url")
      .is("closed_at", null).or(`apply_end.is.null,apply_end.gte.${today}`)
      .order("id", { ascending: true }).range(offset, offset + pageSize - 1).abortSignal(signal);
    if (error) throw new Error("entry_catalog_unavailable");
    for (const row of data ?? []) programs.push({ id: row.id, source: row.source, title: row.title, summary: row.summary, target: row.target, supportField: row.support_field, region: row.region, applyEnd: row.apply_end, url: row.url, formUrl: row.form_url });
    if (!data || data.length < pageSize) return programs;
  }
}
export async function getEntryResults(conditions: EntryConditions, now = new Date()) {
  // Direct persisted catalogue read only: never fetchOpenPrograms/sample fallback.
  const eligible = matchEntryPrograms(await getEntryCatalog(now), conditions, now);
  return { results: await entryCards(eligible.slice(0, 3)), total: eligible.length };
}
export async function getEntryProgram(id: string, now = new Date()): Promise<EntryCard | null> {
  // Query the exact notice so a notification remains useful beyond the first page.
  const { data, error } = await createAdminClient().from("programs")
    .select("id,source,title,summary,target,support_field,region,apply_end,url,form_url")
    .eq("id", id).is("closed_at", null).maybeSingle();
  if (error) throw new Error("entry_catalog_unavailable");
  if (!data || data.source === "sample" || /^sample[-:]/i.test(data.id) || !safeEntryUrl(data.url)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
  const deadline = entryDate(data.apply_end);
  if ((data.apply_end && !deadline) || (deadline && deadline < today) || (!deadline && !/상시|수시|예산\s*소진/.test(`${data.title} ${data.summary}`))) return null;
  const p: Program = { id: data.id, source: data.source, title: data.title, summary: data.summary, target: data.target, supportField: data.support_field, region: data.region, applyEnd: data.apply_end, url: data.url, formUrl: data.form_url };
  return (await entryCards([p]))[0];
}
