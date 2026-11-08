import { Redis } from '@upstash/redis';
import { getGoogleUser } from '@/lib/auth/googleUser';
import { createCheckoutContext } from '@/lib/analytics/checkoutContext';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if (process.env.GA4_PURCHASE_MODE !== 'server_exclusive') {
    return Response.json({ error: 'disabled' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const user = await getGoogleUser(req);
    if (!user) return Response.json({ error: 'login_required' }, { status: 401 });
    const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return Response.json({ error: 'unavailable' }, { status: 503 });
    return await createCheckoutContext(req, user, new Redis({ url, token }));
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
