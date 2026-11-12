import { pushConfig } from '@/lib/push/config';
import { PUSH_CONSENT_VERSION } from '@/lib/push/types';
export const dynamic = 'force-dynamic';
export function GET() {
  const { enabled, publicKey } = pushConfig();
  return Response.json({ enabled, publicKey, consentVersion: PUSH_CONSENT_VERSION }, { headers: { 'Cache-Control': 'no-store' } });
}
