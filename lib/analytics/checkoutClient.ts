import { analyticsAllowed, measurementIds } from '../ga';

type HeadersProvider = () => Promise<Record<string, string>>;
type Ids = { client_id: string; session_id: string };
type Options = { http?: typeof fetch; getIds?: () => Promise<Ids | null>; timeoutMs?: number };

async function analyticsIds(): Promise<Ids | null> {
  const gtag = (window as Window & { gtag?: (...args: unknown[]) => void }).gtag;
  const id = measurementIds()[0];
  if (!gtag || !id) return null;
  const get = (name: string) => new Promise<unknown>(resolve => gtag('get', id, name, resolve));
  const [client, session] = await Promise.all([get('client_id'), get('session_id')]);
  return { client_id: String(client ?? ''), session_id: String(session ?? '') };
}

export async function attributedCheckoutUrl(original: string, getHeaders: HeadersProvider, options: Options = {}): Promise<string> {
  if (process.env.NEXT_PUBLIC_GA4_PURCHASE_MODE !== 'server_exclusive' || !analyticsAllowed()) return original;
  let destination: URL;
  try { destination = new URL(original); } catch { return original; }
  if (destination.protocol !== 'https:' || !['groble.im', 'www.groble.im'].includes(destination.hostname) || !/^\/payment\/[A-Za-z0-9_-]+$/.test(destination.pathname) || destination.searchParams.has('ref')) return original;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    const auth = await getHeaders();
    if (!auth.Authorization || controller.signal.aborted) return original;
    const ids = await (options.getIds ?? analyticsIds)();
    if (controller.signal.aborted || !ids || !/^\d{1,20}\.\d{1,20}$/.test(ids.client_id) || !/^[1-9]\d{0,12}$/.test(ids.session_id)) return original;
    const response = await (options.http ?? fetch)('/api/analytics/checkout', {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: ids.client_id, session_id: ids.session_id }), signal: controller.signal,
    });
    if (!response.ok || controller.signal.aborted) return original;
    const data = await response.json();
    if (controller.signal.aborted || typeof data.reference !== 'string' || !/^ddak_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.reference)) return original;
    destination.searchParams.set('ref', data.reference);
    return destination.toString();
  };
  try {
    return await Promise.race([work(), new Promise<string>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(original); }, options.timeoutMs ?? 1000);
    })]);
  } catch { return original; }
  finally { clearTimeout(timer); controller.abort(); }
}

interface CheckoutClick {
  currentTarget: { href: string; target: string };
  defaultPrevented?: boolean; button?: number;
  metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean;
  preventDefault(): void;
}

// Reserve the tab during the real user gesture, not after asynchronous auth.
// A denied popup or modified click keeps the anchor's original navigation.
export async function openAttributedCheckout(event: CheckoutClick, getHeaders: HeadersProvider, options: Options = {}): Promise<void> {
  if (process.env.NEXT_PUBLIC_GA4_PURCHASE_MODE !== 'server_exclusive' || !analyticsAllowed() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button !== undefined && event.button !== 0)) return;
  const original = event.currentTarget.href;
  let destination: URL;
  try { destination = new URL(original); } catch { return; }
  if (destination.protocol !== 'https:' || !['groble.im', 'www.groble.im'].includes(destination.hostname) || !/^\/payment\/[A-Za-z0-9_-]+$/.test(destination.pathname) || event.currentTarget.target !== '_blank') return;
  const tab = window.open('about:blank', '_blank');
  if (!tab) return;
  tab.opener = null;
  event.preventDefault();
  const url = await attributedCheckoutUrl(original, getHeaders, options);
  if (!tab.closed) tab.location.replace(url);
}
