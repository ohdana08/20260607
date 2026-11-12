import { pushCron } from '@/lib/push/cron';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export function GET(req: Request) { return pushCron(req, 'daily'); }
