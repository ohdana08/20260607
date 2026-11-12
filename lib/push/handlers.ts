import { getGoogleUser, GoogleAuthDependencyError } from '../auth/googleUser.ts';
import { parseEntryConditions } from '../entry/conditions.ts';
import { PUSH_CONSENT_VERSION, type PushStore } from './types.ts';
import { parsePushSubscription, validPushEndpoint } from './validation.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
type Dependencies = { store: () => PushStore; enabled: () => boolean; authenticate?: typeof getGoogleUser };

// Dependency injection keeps tests offline; production always uses verified Google identity.
export function subscriptionHandlers(deps: Dependencies) {
  async function handle(req: Request, method: 'GET' | 'POST' | 'DELETE') {
    try {
      const user = await (deps.authenticate ?? getGoogleUser)(req, { dependencyErrors: true });
      if (!user) return json({ error: 'Google 로그인 후 이용해 주세요.' }, 401);
      if (method === 'GET') return json(await deps.store().status(user.id));
      const origin = req.headers.get('origin');
      if (origin && origin !== new URL(req.url).origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
      if (method === 'POST' && !deps.enabled()) return json({ error: '알림 서비스를 준비하고 있어요.' }, 503);
      if (!req.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON 요청이 필요합니다.' }, 415);
      // Read with a hard byte bound, including chunked bodies without Content-Length.
      const reader = req.body?.getReader();
      let raw = ''; let bytes = 0;
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 8192) { await reader.cancel(); return json({ error: '요청이 너무 큽니다.' }, 413); }
          raw += decoder.decode(value, { stream: true });
        }
      }
      let input: unknown;
      try { input = JSON.parse(raw + decoder.decode()); } catch { return json({ error: '요청 형식을 확인해 주세요.' }, 400); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: '요청 형식을 확인해 주세요.' }, 400);
      const body = input as Record<string, unknown>;
      if (method === 'DELETE') {
        if (body.endpoint !== undefined && !validPushEndpoint(body.endpoint)) return json({ error: '구독 주소를 확인해 주세요.' }, 400);
        await deps.store().remove(user.id, body.endpoint as string | undefined);
        return json({ subscribed: false });
      }
      const subscription = parsePushSubscription(body.subscription);
      const conditions = parseEntryConditions(body.conditions);
      if (!subscription || !conditions || body.consent !== true || body.consentVersion !== PUSH_CONSENT_VERSION) return json({ error: '조건과 알림 동의를 확인해 주세요.' }, 400);
      await deps.store().save(user.id, subscription, conditions);
      return json({ subscribed: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'endpoint_owned') return json({ error: '이 브라우저의 기존 알림을 해지한 뒤 다시 시도해 주세요.' }, 409);
      if (error && typeof error === 'object' && 'code' in error && error.code === 'limit') return json({ error: '기존 기기 알림을 해지한 뒤 다시 시도해 주세요.' }, 409);
      return json({ error: error instanceof GoogleAuthDependencyError ? '로그인 확인이 지연되고 있어요. 다시 시도해 주세요.' : '알림 설정을 저장하지 못했어요. 다시 시도해 주세요.' }, 503);
    }
  }
  return { GET: (req: Request) => handle(req, 'GET'), POST: (req: Request) => handle(req, 'POST'), DELETE: (req: Request) => handle(req, 'DELETE') };
}
