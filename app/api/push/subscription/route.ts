import { subscriptionHandlers } from '@/lib/push/handlers';
import { createPushStore } from '@/lib/push/store';
import { pushConfig } from '@/lib/push/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handlers = subscriptionHandlers({ store: createPushStore, enabled: () => pushConfig().enabled });
export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
