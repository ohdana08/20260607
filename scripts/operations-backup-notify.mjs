import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This job-level fallback reports upload/download/drill failures independently
// of the Vercel app. It never includes command stderr, DB rows or credentials.
export async function reportBackupFailure(env = process.env, transport = fetch) {
  const token = env.OPS_BACKUP_SLACK_BOT_TOKEN?.trim();
  const channel = env.OPS_BACKUP_SLACK_CHANNEL_ID?.trim();
  if (!token || !channel) return { event: 'operations_backup_notification', outcome: 'unconfigured' };
  const repository = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(env.GITHUB_REPOSITORY || '') ? env.GITHUB_REPOSITORY : 'unknown';
  const runId = /^\d{1,20}$/.test(env.GITHUB_RUN_ID || '') ? env.GITHUB_RUN_ID : 'unknown';
  const metadata = { event: 'operations_backup_failed', runId, phase: 'backup_or_restore_verification', repository,
    workflowUrl: repository !== 'unknown' && runId !== 'unknown' ? `https://github.com/${repository}/actions/runs/${runId}` : 'unknown' };
  const controller = new AbortController(); let timer;
  try {
    const delivery = (async () => {
      const response = await transport('https://slack.com/api/chat.postMessage', {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, text: JSON.stringify(metadata), mrkdwn: false, parse: 'none', unfurl_links: false, unfurl_media: false }),
        signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (!response.ok) return 'failed';
      const result = await response.json();
      return result?.ok === true ? 'sent' : 'failed';
    })();
    const outcome = await Promise.race([delivery, new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve('failed'); }, 3000); })]);
    return { event: 'operations_backup_notification', outcome };
  } catch { return { event: 'operations_backup_notification', outcome: 'failed' }; }
  finally { if (timer) clearTimeout(timer); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  reportBackupFailure().then(result => { console.log(JSON.stringify(result)); if (result.outcome !== 'sent') process.exitCode = 1; });
}
