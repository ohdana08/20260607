import { createAdminClient } from '../supabase/admin.ts';
import type { PushProgram } from './types.ts';

// Existing collection storage only: no live source fetch, sample fallback or LLM.
// first_seen_at must exist and remain immutable (deployment preflight requirement).
export async function readPushPrograms(now: Date): Promise<PushProgram[]> {
  const db = createAdminClient();
  const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result: PushProgram[] = [];
  let after: string | null = null;
  for (let page = 0; page < 100; page++) {
    let query = db.from('programs').select('id,source,title,summary,target,support_field,region,apply_end,url,form_url,first_seen_at')
      .is('closed_at', null).or(`apply_end.is.null,apply_end.gte.${today}`).order('id').limit(500);
    if (after) query = query.gt('id', after);
    const { data, error } = await query.abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error('Push catalog unavailable');
    for (const row of data ?? []) {
      if (row.source === 'sample' || String(row.id).startsWith('sample-')) continue;
      result.push({ id: row.id, source: row.source, title: row.title, summary: row.summary, target: row.target,
        supportField: row.support_field, region: row.region, applyEnd: row.apply_end ?? null, url: row.url,
        formUrl: row.form_url ?? null, firstSeenAt: row.first_seen_at ?? null });
    }
    if (!data || data.length < 500) return result;
    after = data[data.length - 1].id;
  }
  // Never quietly send a partial catalogue as if all matching notices were considered.
  throw new Error('Push catalog exceeds configured bound');
}
