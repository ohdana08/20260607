import type { EntryConditions } from '../entry/conditions.ts';
import type { Program } from '../match/types.ts';

export const PUSH_CONSENT_VERSION = '2026-11-12';
export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
export type StoredPushSubscription = PushSubscriptionInput & { id: string; userId: string; conditions: EntryConditions; createdAt: string };
export type PushProgram = Program & { firstSeenAt: string | null };
export type PushKind = 'daily' | 'weekly';
export type PushPayload = { title: string; body: string; url: string; tag: string };
export interface PushStore {
  save(userId: string, subscription: PushSubscriptionInput, conditions: EntryConditions): Promise<void>;
  status(userId: string): Promise<{ subscribed: boolean; conditions: EntryConditions | null }>;
  remove(userId: string, endpoint?: string): Promise<void>;
  listUsers(after: string | null, limit: number): Promise<string[]>;
  subscriptions(userId: string): Promise<StoredPushSubscription[]>;
  claim(userId: string, day: string, kind: PushKind): Promise<boolean>;
  finish(userId: string, day: string, outcome: 'accepted' | 'failed' | 'gone'): Promise<void>;
  revoke(id: string): Promise<void>;
  cursor(day: string, kind: PushKind): Promise<string | null>;
  advance(day: string, kind: PushKind, userId: string): Promise<void>;
}
