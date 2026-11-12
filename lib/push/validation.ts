import { ECDH } from 'node:crypto';
import type { PushSubscriptionInput } from './types.ts';

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname === '/') return false;
    const host = url.hostname;
    return host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
      /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host) ||
      host === 'web.push.apple.com' || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  } catch { return false; }
}

function decode(value: unknown, length: number): Buffer | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const result = Buffer.from(value, 'base64url');
  return result.length === length && result.toString('base64url') === value ? result : null;
}
export function parsePushSubscription(input: unknown): PushSubscriptionInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!validPushEndpoint(value.endpoint) || !value.keys || typeof value.keys !== 'object') return null;
  const keys = value.keys as Record<string, unknown>;
  const publicKey = decode(keys.p256dh, 65);
  if (!publicKey || publicKey[0] !== 4 || !decode(keys.auth, 16)) return null;
  try { ECDH.convertKey(publicKey, 'prime256v1'); } catch { return null; }
  return { endpoint: value.endpoint, keys: { p256dh: keys.p256dh as string, auth: keys.auth as string } };
}
