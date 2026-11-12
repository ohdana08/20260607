import { createAdminClient } from '../supabase/admin.ts';
import { parseEntryConditions } from '../entry/conditions.ts';
import type { EntryConditions } from '../entry/conditions.ts';
import { parsePushSubscription } from './validation.ts';
import type { PushStore, StoredPushSubscription, PushSubscriptionInput, PushKind } from './types.ts';

export class PushStorageError extends Error {
  constructor(readonly code: 'unavailable' | 'endpoint_owned' | 'limit') { super('Push storage unavailable'); }
}
export function createPushStore(): PushStore {
  const db = createAdminClient();
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await db.rpc(name, args).abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new PushStorageError(error.message === 'endpoint_owned' ? 'endpoint_owned' : error.message === 'subscription_limit' ? 'limit' : 'unavailable');
    return data;
  }
  return {
    async save(userId: string, subscription: PushSubscriptionInput, conditions: EntryConditions) {
      await rpc('entry_push_save', { p_user_id: userId, p_endpoint: subscription.endpoint, p_keys: subscription.keys, p_conditions: conditions });
    },
    async status(userId: string) {
      const rows = await rpc('entry_push_status', { p_user_id: userId });
      const conditions = rows?.[0] ? parseEntryConditions(rows[0].conditions) : null;
      return { subscribed: Boolean(conditions), conditions };
    },
    async remove(userId: string, endpoint?: string) { await rpc('entry_push_remove', { p_user_id: userId, p_endpoint: endpoint ?? null }); },
    async listUsers(after: string | null, limit: number) {
      const rows = await rpc('entry_push_users', { p_after: after, p_limit: limit });
      return (rows ?? []).map((row: { user_id: string }) => row.user_id);
    },
    async subscriptions(userId: string): Promise<StoredPushSubscription[]> {
      const rows = await rpc('entry_push_subscriptions', { p_user_id: userId });
      const result: StoredPushSubscription[] = [];
      for (const row of rows ?? []) {
        const subscription = parsePushSubscription({ endpoint: row.endpoint, keys: row.keys });
        const conditions = parseEntryConditions(row.conditions);
        if (subscription && conditions) result.push({ ...subscription, conditions, id: row.id, userId, createdAt: row.created_at });
      }
      return result;
    },
    async claim(userId: string, day: string, kind: PushKind) { return await rpc('entry_push_claim', { p_user_id: userId, p_day: day, p_kind: kind }) === true; },
    async finish(userId, day, outcome) { await rpc('entry_push_finish', { p_user_id: userId, p_day: day, p_outcome: outcome }); },
    async revoke(id) { await rpc('entry_push_revoke', { p_id: id }); },
    async cursor(day, kind) { return await rpc('entry_push_cursor', { p_day: day, p_kind: kind }) as string | null; },
    async advance(day, kind, userId) { await rpc('entry_push_advance', { p_day: day, p_kind: kind, p_user_id: userId }); },
  };
}
