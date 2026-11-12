import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as webpush from 'web-push';
import { pushConfig } from '../lib/push/config.ts';
import { parsePushSubscription, validPushEndpoint } from '../lib/push/validation.ts';
import { subscriptionHandlers } from '../lib/push/handlers.ts';
import { runPushBatch, kstDay } from '../lib/push/runner.ts';
import { GoogleAuthDependencyError } from '../lib/auth/googleUser.ts';
import type { PushStore, StoredPushSubscription, PushKind, PushSubscriptionInput, PushProgram } from '../lib/push/types.ts';
import type { EntryConditions } from '../lib/entry/conditions.ts';
const conditions: EntryConditions = { age: '30_39', region: '부산', business: 'under_3', industry: 'tech' };
// Ephemeral test-only encryption keys stay in memory and are never logged or written.
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const subscription: PushSubscriptionInput = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-only', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
class MemoryStore implements PushStore {
  rows: StoredPushSubscription[] = [];
  claims = new Set<string>(); cursors = new Map<string, string>(); outcomes: string[] = [];
  async save(userId: string, value: PushSubscriptionInput, c: EntryConditions) {
    const existing = this.rows.find(row => row.endpoint === value.endpoint);
    if (existing && existing.userId !== userId) throw { code: 'endpoint_owned' };
    this.rows = this.rows.filter(row => row.endpoint !== value.endpoint);
    this.rows.unshift({ ...value, userId, id: `${userId}-${value.endpoint}`, conditions: c, createdAt: '2026-11-01T00:00:00Z' });
  }
  async status(userId: string) { const row = this.rows.find(r => r.userId === userId); return { subscribed: Boolean(row), conditions: row?.conditions ?? null }; }
  async remove(userId: string, endpoint?: string) { this.rows = this.rows.filter(r => r.userId !== userId || (endpoint !== undefined && r.endpoint !== endpoint)); }
  async listUsers(after: string | null, limit: number) { return [...new Set(this.rows.map(r => r.userId))].sort().filter(id => !after || id > after).slice(0, limit); }
  async subscriptions(userId: string) { return this.rows.filter(r => r.userId === userId); }
  async claim(userId: string, day: string) { const key = `${userId}:${day}`; if (this.claims.has(key)) return false; this.claims.add(key); return true; }
  async finish(_userId: string, _day: string, outcome: string) { this.outcomes.push(outcome); }
  async revoke(id: string) { this.rows = this.rows.filter(row => row.id !== id); }
  async cursor(day: string, kind: PushKind) { return this.cursors.get(`${day}:${kind}`) ?? null; }
  async advance(day: string, kind: PushKind, userId: string) { const key = `${day}:${kind}`; this.cursors.set(key, [userId, this.cursors.get(key) ?? ''].sort().at(-1)!); }
}
const now = new Date('2026-11-16T03:00:00Z');
const program: PushProgram = { id: 'bizinfo:one', source: 'bizinfo', title: '기업 지원사업', summary: '', target: '중소기업', supportField: '', region: '전국', applyEnd: '2026-12-01', url: 'https://www.bizinfo.go.kr/notice/one', formUrl: null, firstSeenAt: '2026-11-16T01:00:00Z' };
const request = (method: string, body?: unknown) => new Request('https://ddakfit.example/api/push/subscription', { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
function api(store: MemoryStore, user = 'alice', enabled = true) { return subscriptionHandlers({ store: () => store, enabled: () => enabled, authenticate: async () => ({ id: user, email: 'ignored@example.test', isAdmin: false }) }); }
const optIn = { subscription, conditions, consent: true, consentVersion: '2026-11-12' };

test('endpoint SSRF, credentials, suffix spoofing and crypto key validation', () => {
  assert.ok(parsePushSubscription(subscription));
  for (const endpoint of ['http://fcm.googleapis.com/path', 'https://127.0.0.1/path', 'https://fcm.googleapis.com.evil.test/path', 'https://evil.test@fcm.googleapis.com/path', 'https://fcm.googleapis.com:444/path', 'https://web.push.apple.com/path#secret']) assert.equal(validPushEndpoint(endpoint), false);
  assert.equal(validPushEndpoint('https://web.push.apple.com/token'), true);
  assert.equal(validPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/token'), true);
  assert.equal(parsePushSubscription({ ...subscription, keys: { ...subscription.keys, p256dh: 'B'.repeat(87) } }), null);
});
test('authenticated save/status/delete and ownership remain scoped to verified identity', async () => {
  const store = new MemoryStore(); const alice = api(store); const bob = api(store, 'bob');
  assert.equal((await alice.POST(request('POST', { ...optIn, userId: 'bob', email: 'do-not-store@example.test' }))).status, 200);
  assert.equal(store.rows[0].userId, 'alice'); assert.equal('email' in store.rows[0], false);
  assert.deepEqual(await (await alice.GET(request('GET'))).json(), { subscribed: true, conditions });
  assert.equal((await bob.POST(request('POST', optIn))).status, 409);
  await bob.DELETE(request('DELETE', { endpoint: subscription.endpoint })); assert.equal(store.rows.length, 1);
  await alice.DELETE(request('DELETE', {})); assert.equal(store.rows.length, 0);
});
test('missing consent, disabled mode, foreign origin, malformed and oversize bodies do not persist', async () => {
  const store = new MemoryStore(); const handler = api(store);
  assert.equal((await handler.POST(request('POST', { ...optIn, consent: false }))).status, 400);
  assert.equal((await api(store, 'alice', false).POST(request('POST', optIn))).status, 503);
  const foreign = request('POST', optIn); foreign.headers.set('Origin', 'https://evil.test');
  assert.equal((await handler.POST(foreign)).status, 403);
  assert.equal((await handler.POST(request('POST', { data: 'a'.repeat(9000) }))).status, 413);
  assert.equal(store.rows.length, 0);
});
test('auth failures fail closed and dependency error yields 503 without store access', async () => {
  const deps = { store: () => { throw new Error('must never create store'); }, enabled: () => true };
  assert.equal((await subscriptionHandlers({ ...deps, authenticate: async () => null }).GET(request('GET'))).status, 401);
  assert.equal((await subscriptionHandlers({ ...deps, authenticate: async () => { throw new GoogleAuthDependencyError('network'); } }).POST(request('POST', optIn))).status, 503);
});
test('daily includes only newly first-seen matching real open notices, weekly can include older', async () => {
  const store = new MemoryStore(); await store.save('alice', subscription, conditions); let count = 0;
  const programs = [ { ...program, id: 'old', firstSeenAt: '2026-10-01T00:00:00Z' }, { ...program, id: 'sample-1', source: 'sample' as const }, { ...program, id: 'closed', applyEnd: '2026-11-15' }, { ...program, id: 'future', firstSeenAt: '2026-11-20T00:00:00Z' } ];
  assert.equal((await runPushBatch({ kind: 'daily', now, store, programs, send: async () => { count++; } })).accepted, 0);
  await runPushBatch({ kind: 'weekly', now, store, programs: [programs[0]], send: async () => { count++; } }); assert.equal(count, 1);
});
test('racing daily/weekly, duplicate devices and retries allow one user/day attempt', async () => {
  const store = new MemoryStore(); await store.save('alice', subscription, conditions);
  await store.save('alice', { ...subscription, endpoint: `${subscription.endpoint}-2` }, conditions); let count = 0;
  const send = async () => { count++; await Promise.resolve(); };
  await Promise.all(['daily', 'weekly', 'daily'].map(kind => runPushBatch({ kind: kind as PushKind, now, store, programs: [program], send })));
  assert.equal(count, 1); assert.equal(store.claims.size, 1); assert.equal(kstDay(new Date('2026-11-15T15:00:00Z')), '2026-11-16');
});
test('failed/ambiguous sends do not retry, 404/410 revoke and no endpoint in payload', async () => {
  for (const statusCode of [404, 410, 503]) {
    const store = new MemoryStore(); await store.save('alice', subscription, conditions); let count = 0;
    const send = async (_sub: StoredPushSubscription, payload: unknown) => { count++; assert.equal(JSON.stringify(payload).includes(subscription.endpoint), false); throw { statusCode }; };
    await runPushBatch({ kind: 'daily', now, store, programs: [program], send });
    await runPushBatch({ kind: 'weekly', now, store, programs: [program], send });
    assert.equal(count, 1); assert.equal(store.rows.length, statusCode === 503 ? 1 : 0);
  }
});
test('bounded pages resume via durable campaign cursor without duplicate delivery', async () => {
  const store = new MemoryStore(); for (const user of ['a', 'b', 'c']) await store.save(user, { ...subscription, endpoint: `${subscription.endpoint}-${user}` }, conditions);
  let count = 0; const options = { kind: 'daily' as const, now, store, programs: [program], send: async () => { count++; }, maxUsers: 2 };
  assert.equal((await runPushBatch(options)).partial, true);
  assert.equal((await runPushBatch(options)).partial, false); assert.equal(count, 3);
});
test('migration is private, service-only, atomic across daily and weekly and ownership-safe', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202611120001_entry_push.sql', import.meta.url), 'utf8');
  assert.match(sql, /primary key \(user_id, day\)/); assert.match(sql, /where ddakfit_entry_push_private.subscriptions.user_id=excluded.user_id/);
  assert.equal((sql.match(/enable row level security/g) ?? []).length, 3);
  assert.equal((sql.match(/revoke all on function public.entry_push_/g) ?? []).length, 10);
  assert.equal((sql.match(/grant execute on function public.entry_push_.*to service_role/g) ?? []).length, 10);
});

test('VAPID keys are ephemeral in memory and standard web-push encrypts without network', () => {
  const vapid = webpush.generateVAPIDKeys();
  const fields = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_ENABLED'] as const;
  const before = Object.fromEntries(fields.map(field => [field, process.env[field]]));
  try {
    Object.assign(process.env, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.test', PUSH_ENABLED: 'false' });
    assert.equal(pushConfig().enabled, false);
    process.env.PUSH_ENABLED = 'true';
    assert.equal(pushConfig().enabled, true);
    const details = webpush.generateRequestDetails(subscription, JSON.stringify({ title: '테스트', body: '로컬 암호화 검증', url: '/discover' }), {
      vapidDetails: pushConfig().vapidDetails!, TTL: 3600,
    });
    assert.equal(details.method, 'POST');
    assert.equal(Boolean(details.body && Buffer.isBuffer(details.body)), true);
    assert.equal(Boolean(details.headers.Authorization), true);
    assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  } finally {
    for (const field of fields) {
      if (before[field] === undefined) delete process.env[field]; else process.env[field] = before[field];
    }
  }
});
