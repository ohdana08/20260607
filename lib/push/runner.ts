import { matchEntryPrograms } from '../entry/match.ts';
import type { PushKind, PushPayload, PushProgram, PushStore, StoredPushSubscription } from './types.ts';
export function kstDay(now: Date) { return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10); }
export type PushSend = (subscription: StoredPushSubscription, payload: PushPayload) => Promise<void>;
export async function runPushBatch(options: {
  kind: PushKind; now: Date; store: PushStore; programs: PushProgram[]; send: PushSend;
  maxUsers?: number; budgetMs?: number; clock?: () => number;
}) {
  const { kind, now, store, programs, send } = options;
  const day = kstDay(now);
  const clock = options.clock ?? Date.now;
  const stopAt = clock() + (options.budgetMs ?? 230_000);
  const maxUsers = options.maxUsers ?? 10_000;
  const stats = { evaluated: 0, accepted: 0, skipped: 0, failed: 0, revoked: 0, partial: false };
  let after = await store.cursor(day, kind);
  while (stats.evaluated < maxUsers && clock() < stopAt) {
    const users = await store.listUsers(after, Math.min(25, maxUsers - stats.evaluated));
    if (!users.length) return stats;
    for (const userId of users) {
      if (clock() >= stopAt) { stats.partial = true; return stats; }
      const subscriptions = await store.subscriptions(userId);
      // Most recently confirmed device only: at most one delivery attempt per user/day,
      // not one per device. A failed/ambiguous attempt is never retried that day.
      const subscription = subscriptions[0];
      let candidatePrograms = programs;
      if (kind === 'daily' && subscription) {
        const lowerBound = Math.max(now.getTime() - 24 * 3_600_000, Date.parse(subscription.createdAt));
        candidatePrograms = programs.filter(program => {
          const firstSeen = Date.parse(program.firstSeenAt ?? '');
          return Number.isFinite(firstSeen) && firstSeen > lowerBound && firstSeen <= now.getTime();
        });
      }
      const matches = subscription ? matchEntryPrograms(candidatePrograms, subscription.conditions, now) : [];
      if (subscription && matches.length && await store.claim(userId, day, kind)) {
        const payload: PushPayload = {
          title: kind === 'weekly' ? '이번 주 받을 수 있는 것' : '조건에 맞는 새 공고가 있어요',
          body: `${matches.length}개 공고를 모았어요. 신청 조건은 공고문에서 확인해 주세요.`,
          url: `/discover?program=${encodeURIComponent(matches[0].id)}`,
          tag: `ddakfit-${day}`,
        };
        let outcome: 'accepted' | 'failed' | 'gone' = 'accepted';
        try { await send(subscription, payload); stats.accepted++; }
        catch (error) {
          const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : null;
          if (status === 404 || status === 410) { await store.revoke(subscription.id); stats.revoked++; outcome = 'gone'; }
          else { stats.failed++; outcome = 'failed'; }
          // Do not log web-push errors: they can contain endpoint/keys/request headers.
        }
        await store.finish(userId, day, outcome);
      } else stats.skipped++;
      stats.evaluated++;
      await store.advance(day, kind, userId);
      after = userId;
    }
  }
  stats.partial = true;
  return stats;
}
