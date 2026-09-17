import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAGIC = Buffer.from('DDOPS001');
export const MAX_BYTES = 64 * 1024 * 1024;
export const MIGRATION = 'supabase/migrations/20260917124905_operations_postgres_rpc.sql';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = /^[a-z][a-z0-9_-]{0,63}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class BackupError extends Error { constructor(code) { super(code); this.name = 'BackupError'; } }
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code) => { throw new BackupError(code); };
export function sqlLiteral(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }

export function keyFromEnv(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) fail('invalid_encryption_key');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) fail('invalid_encryption_key');
  return key;
}

export function encryptBackup(payload, key) {
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > MAX_BYTES) fail('backup_size_limit');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(MAGIC);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), encrypted]);
}

export function decryptBackup(bytes, key) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 37 || bytes.length > MAX_BYTES + 36 || !bytes.subarray(0, 8).equals(MAGIC)) fail('invalid_archive');
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(8, 20));
    cipher.setAAD(MAGIC); cipher.setAuthTag(bytes.subarray(20, 36));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(36)), cipher.final()]).toString('utf8'));
  } catch { fail('archive_authentication_failed'); }
}

export function validateSnapshot(data, scope) {
  if (typeof scope !== 'string' || !SCOPE.test(scope) || !data || !Array.isArray(data.scopes) || data.scopes.length !== 1 ||
      data.scopes[0].scope_id !== scope || !/^[a-f0-9]{64}$/.test(data.scopes[0].secret_hash) ||
      !Array.isArray(data.operators) || data.operators.length < 1 || data.operators.length > 1000 ||
      !Array.isArray(data.months) || data.months.length > 1200 || !Number.isFinite(Date.parse(data.snapshotAt))) fail('invalid_snapshot');
  const users = new Set(); const months = new Set();
  for (const row of data.operators) {
    if (row.scope_id !== scope || !UUID.test(row.user_id) || users.has(row.user_id) || !Number.isFinite(Date.parse(row.created_at))) fail('invalid_operator');
    users.add(row.user_id);
  }
  for (const row of data.months) {
    if (row.scope_id !== scope || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(row.month) || months.has(row.month) ||
        !Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 1000000000001 ||
        !UUID.test(row.updated_by) || !Number.isFinite(Date.parse(row.updated_at)) ||
        row.state?.revision !== row.revision || row.state?.goal?.month !== row.month ||
        !Array.isArray(row.state?.audit) || row.state.audit.length < 1 || row.state.audit.length > 100 ||
        row.state.audit.at(-1)?.revision !== row.revision) fail('invalid_month');
    months.add(row.month);
  }
  return data;
}

export function snapshotSql(scope) {
  if (typeof scope !== 'string' || !SCOPE.test(scope)) fail('invalid_scope');
  return `begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';
select json_build_object(
 'snapshotAt', transaction_timestamp(),
 'scopes', coalesce((select json_agg(json_build_object('scope_id',scope_id,'secret_hash',encode(secret_hash,'hex')) order by scope_id) from ddakfit_operations_private.scopes where scope_id=${sqlLiteral(scope)}),'[]'::json),
 'operators', coalesce((select json_agg(a order by user_id) from ddakfit_operations_private.operator_allowlist a where scope_id=${sqlLiteral(scope)}),'[]'::json),
 'months', coalesce((select json_agg(m order by month) from ddakfit_operations_private.months m where scope_id=${sqlLiteral(scope)}),'[]'::json));
commit;`;
}

export function connection(value, { localOnly = false } = {}) {
  let url; try { url = new URL(value); } catch { fail('invalid_database_config'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)) fail('invalid_database_config');
  if (localOnly && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) fail('restore_requires_local_database');
  if (!localOnly && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.searchParams.get('sslmode') !== 'verify-full') fail('remote_database_requires_verified_tls');
  return { PGHOST: url.hostname.replace(/^\[|\]$/g, ''), PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1),
    ...(localOnly ? { PGHOSTADDR: url.hostname === '[::1]' ? '::1' : '127.0.0.1' } : {}),
    PGSSLMODE: localOnly || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? 'disable' : 'verify-full' };
}

export function processEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => ['PATH', 'HOME', 'LANG', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'WINDIR'].includes(key) || /^LC_[A-Z_]+$/.test(key)));
}
let dockerHost;
async function localDockerHost() {
  if (dockerHost) return dockerHost;
  try {
    const result = await exec('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], {
      env: processEnvironment(), encoding: 'utf8', timeout: 10_000, maxBuffer: 4096 });
    const value = JSON.parse(result.stdout.trim());
    if (typeof value !== 'string' || !value.startsWith('unix:///') || value.includes('\n')) fail('docker_restore_requires_local_socket');
    dockerHost = value; return value;
  } catch { fail('docker_restore_requires_local_socket'); }
}

// Never put credentials, SQL, server stderr or raw output in a diagnostic.
export async function psql(sql, { url, docker = false, database, readOnly = false, localOnly = false } = {}) {
  let command = 'psql'; let args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const pg = docker ? { PGDATABASE: database || 'postgres' } : connection(url, { localOnly });
  if (database) pg.PGDATABASE = database;
  if (!/^[A-Za-z0-9_-]+$/.test(pg.PGDATABASE)) fail('invalid_database_config');
  const options = `-c statement_timeout=30000 -c lock_timeout=1000 -c standard_conforming_strings=on -c default_transaction_read_only=${readOnly ? 'on' : 'off'}`;
  if (docker) {
    command = 'docker'; args = ['--host', await localDockerHost(), 'compose', '-f', 'infra/scale/compose.yml', 'exec', '-T', '-e', `PGOPTIONS=${options}`, 'postgres', 'psql', ...args];
    args.push('-U', 'scale_lab', '-d', pg.PGDATABASE);
  }
  try {
    const child = exec(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: MAX_BYTES, timeout: 45_000,
      env: { ...processEnvironment(), ...pg, PGOPTIONS: options, PGCONNECT_TIMEOUT: '10',
        ...(pg.PGSSLMODE === 'verify-full' ? { PGSSLROOTCERT: 'system' } : {}),
        PGPASSFILE: '/dev/null', PGSERVICE: '', PGSERVICEFILE: '/dev/null' } });
    child.child.stdin.on('error', () => {}); child.child.stdin.end(sql);
    return (await child).stdout.trim();
  } catch { fail('database_query_failed'); }
}

export async function makeBackup({ scope, key, query, now = () => new Date() }) {
  const started = performance.now();
  let snapshot; try { snapshot = JSON.parse(await query(snapshotSql(scope))); } catch { fail('snapshot_read_failed'); }
  validateSnapshot(snapshot, scope);
  const migrationSql = await readFile(resolve(ROOT, MIGRATION), 'utf8');
  const payload = { format: 1, backupId: randomUUID(), scope, snapshot,
    migration: { path: MIGRATION, sha256: sha256(migrationSql), sql: migrationSql } };
  const archive = encryptBackup(payload, key);
  return { archive, report: { event: 'operations_backup', backupId: payload.backupId, phase: 'encrypted_locally',
    snapshotAt: snapshot.snapshotAt, completedAt: now().toISOString(), archiveSha256: sha256(archive),
    encryptedBytes: archive.length, monthCount: snapshot.months.length, operatorCount: snapshot.operators.length,
    exportEncryptMs: Math.round(performance.now() - started), offsiteVerified: false } };
}

export async function readArchive(path, key) {
  if ((await stat(path)).size > MAX_BYTES + 36) fail('backup_size_limit');
  const bytes = await readFile(path); const payload = decryptBackup(bytes, key);
  if (payload?.format !== 1 || !UUID.test(payload.backupId) || payload.migration?.path !== MIGRATION) fail('invalid_archive_contract');
  validateSnapshot(payload.snapshot, payload.scope);
  const trusted = await readFile(resolve(ROOT, MIGRATION), 'utf8');
  if (sha256(trusted) !== payload.migration.sha256 || sha256(payload.migration.sql) !== payload.migration.sha256) fail('migration_version_mismatch');
  return { bytes, payload };
}

export async function verifyOffsite({ archivePath, reportPath, key, maxAgeMs = 7 * 3600_000, now = Date.now() }) {
  const { bytes, payload } = await readArchive(archivePath, key);
  const previous = JSON.parse(await readFile(reportPath, 'utf8'));
  if (sha256(bytes) !== previous.archiveSha256 || payload.backupId !== previous.backupId) fail('offsite_digest_mismatch');
  const age = now - Date.parse(payload.snapshot.snapshotAt);
  if (!Number.isFinite(age) || age < -60_000 || age > maxAgeMs) fail('backup_outside_rpo_window');
  return { ...previous, phase: 'offsite_download_verified', offsiteVerified: true,
    verifiedAt: new Date(now).toISOString(), snapshotAgeMs: Math.max(0, age), rpoTargetMs: 6 * 3600_000, maxAgeMs };
}

export async function privateWrite(path, value) {
  await mkdir(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { mode: 0o600, flag: 'wx' });
}

async function main() {
  const [action, archivePath, reportPath] = process.argv.slice(2);
  if (!archivePath || !reportPath || !['create', 'verify'].includes(action)) fail('usage_create_or_verify_archive_report');
  const key = keyFromEnv(process.env.OPS_BACKUP_KEY_BASE64);
  if (action === 'create') {
    const { archive, report } = await makeBackup({ scope: process.env.OPS_BACKUP_SCOPE,
      key, query: (sql) => psql(sql, { url: process.env.OPS_BACKUP_DATABASE_URL, readOnly: true }) });
    await privateWrite(archivePath, archive); await privateWrite(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } else {
    const report = await verifyOffsite({ archivePath, reportPath, key });
    const output = process.env.OPS_BACKUP_VERIFIED_REPORT;
    if (!output) fail('missing_verified_report_path');
    await privateWrite(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(JSON.stringify({ event: 'operations_backup', outcome: 'failed', code: error instanceof BackupError ? error.message : 'backup_failed' })); process.exitCode = 1; });
}
