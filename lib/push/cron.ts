import * as webpush from 'web-push';
import { pushConfig } from './config.ts';
import { createPushStore } from './store.ts';
import { readPushPrograms } from './programs.ts';
import { runPushBatch } from './runner.ts';
import { parsePushSubscription } from './validation.ts';
import type { PushKind } from './types.ts';

export async function pushCron(req: Request, kind: PushKind) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const config = pushConfig();
  if (!config.enabled || !config.vapidDetails) return Response.json({ status: 'disabled' });
  const now = new Date();
  const local = new Date(now.getTime() + 9 * 3_600_000);
  // Do not turn a manually called weekly endpoint into an extra daily campaign.
  if (kind === 'weekly' && (local.getUTCDay() !== 1 || local.getUTCHours() < 9)) return Response.json({ status: 'outside_weekly_window' });
  try {
    const programs = await readPushPrograms(now);
    const result = await runPushBatch({ kind, now, programs, store: createPushStore(), send: async (subscription, payload) => {
      const validated = parsePushSubscription(subscription);
      if (!validated) throw new Error('Invalid push subscription');
      await webpush.sendNotification(validated, JSON.stringify(payload), {
        vapidDetails: config.vapidDetails!, timeout: 5_000, TTL: 3_600, urgency: 'normal', topic: payload.tag,
      });
    } });
    // Aggregate counts only: neither credentials nor endpoint/user IDs in responses/logs.
    return Response.json({ status: result.partial ? 'partial' : 'complete', ...result });
  } catch {
    return Response.json({ error: 'Push batch unavailable; no same-day delivery retries are made.' }, { status: 503 });
  }
}
