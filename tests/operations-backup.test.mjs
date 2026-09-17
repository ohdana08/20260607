import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connection, encryptBackup, decryptBackup, keyFromEnv, makeBackup, privateWrite, readArchive,
  snapshotSql, sqlLiteral, validateSnapshot, verifyOffsite, psql, processEnvironment, MIGRATION, ROOT, SUPABASE_ROOT_CERT } from '../scripts/operations-backup.mjs';
import { restoreDrill, restoreSql, canonical, stateDigest, LOCAL_AUTH_SHIM } from '../scripts/operations-backup-drill.mjs';
import { reportBackupFailure } from '../scripts/operations-backup-notify.mjs';

const actor = '00000000-0000-4000-8000-000000000001';
const capability = 'synthetic-backup-capability-aaaaaaaaaaaaaaaaaaaa';
function fixture() {
  const at = new Date().toISOString();
  return { snapshotAt: at, scopes: [{ scope_id: 'backup_synthetic', secret_hash: 'a'.repeat(64) }],
    operators: [{ scope_id: 'backup_synthetic', user_id: actor, created_at: at }],
    months: [{ scope_id: 'backup_synthetic', month: '2026-09', revision: 2, updated_by: actor, updated_at: at,
      state: { schemaVersion: 1, revision: 2, goal: { month: '2026-09', startDate: '2026-09-01', deadline: '2026-09-30', targetKrw: 100, plannedVideos: 1, wordPriceKrw: 1 },
        snapshots: [], videos: [], audit: [1, 2].map(revision => ({ revision, kind: 'goal', key: '2026-09', actorId: actor, at })) } }] };
}

test('AES-GCM roundtrip uses random nonces, hides plaintext and rejects every envelope component tamper', () => {
  const key = randomBytes(32); const secret = { data: 'synthetic-sensitive-marker' };
  const one = encryptBackup(secret, key); const two = encryptBackup(secret, key);
  assert.deepEqual(decryptBackup(one, key), secret); assert.notDeepEqual(one, two);
  assert.equal(one.includes(Buffer.from(secret.data)), false);
  assert.throws(() => decryptBackup(one, randomBytes(32)), /authentication/);
  for (const index of [0, 8, 20, 36, one.length - 1]) {
    const changed = Buffer.from(one); changed[index] ^= 1; assert.throws(() => decryptBackup(changed, key));
  }
});

test('encryption key must be canonical 32-byte base64; database targets require TLS and restore is local only', () => {
  const key = randomBytes(32); assert.deepEqual(keyFromEnv(key.toString('base64')), key);
  for (const input of [undefined, '', 'password', randomBytes(16).toString('base64'), key.toString('base64').trimEnd() + '\n']) assert.throws(() => keyFromEnv(input));
  assert.throws(() => connection('postgresql://user:password@db.example/postgres'), /verified_tls/);
  assert.throws(() => connection('postgresql://user:password@db.example/postgres?sslmode=require'), /verified_tls/);
  assert.equal(connection('postgresql://user:password@db.example/postgres?sslmode=verify-full').PGSSLMODE, 'verify-full');
  assert.throws(() => connection('postgresql://user:password@db.example/postgres?sslmode=verify-full', { localOnly: true }), /local_database/);
  assert.equal(connection('postgresql://drill:synthetic@127.0.0.1:5432/postgres', { localOnly: true }).PGHOST, '127.0.0.1');
  assert.equal(connection('postgresql://drill:synthetic@localhost:5432/postgres', { localOnly: true }).PGHOSTADDR, '127.0.0.1');
  assert.deepEqual(processEnvironment({ PATH: '/bin', HOME: '/test/home', LANG: 'C.UTF-8', PGHOSTADDR: '203.0.113.1', PGSERVICE: 'remote', PGOPTIONS: '-c evil=1', PGSSLROOTCERT: 'system',
    DOCKER_HOST: 'tcp://remote:2375', DOCKER_CONTEXT: 'remote', OPS_BACKUP_KEY_BASE64: 'private-key', OPS_BACKUP_DATABASE_URL: 'private-dsn',
    OPS_BACKUP_SLACK_BOT_TOKEN: 'private-token', GITHUB_TOKEN: 'private-github-token', NODE_OPTIONS: '--require=untrusted' }), { PATH: '/bin', HOME: '/test/home', LANG: 'C.UTF-8' });
});

test('snapshot is scope-complete, internally consistent and not quietly truncated', () => {
  assert.equal(validateSnapshot(fixture(), 'backup_synthetic').months.length, 1);
  for (const mutate of [x => { x.scopes = []; }, x => { x.operators[0].scope_id = 'other'; }, x => { x.months[0].scope_id = 'other'; },
    x => { x.months[0].revision = 1; }, x => { x.months.push(structuredClone(x.months[0])); },
    x => { x.months[0].state.audit.at(-1).revision = 1; }, x => { x.operators = []; }]) {
    const data = fixture(); mutate(data); assert.throws(() => validateSnapshot(data, 'backup_synthetic'));
  }
  assert.match(snapshotSql('backup_synthetic'), /repeatable read read only/);
  assert.equal((snapshotSql('backup_synthetic').match(/where scope_id='backup_synthetic'/g) || []).length, 3);
  assert.doesNotMatch(snapshotSql('backup_synthetic'), /\blimit\b/i);
  assert.throws(() => snapshotSql("x'; delete from months; --"));
  assert.throws(() => snapshotSql(undefined));
});

test('actual psql subprocess receives neither unrelated secrets nor local sslrootcert=system', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ops-backup-child-env-'));
  const saved = { PATH: process.env.PATH, OPS_BACKUP_KEY_BASE64: process.env.OPS_BACKUP_KEY_BASE64,
    OPS_BACKUP_SLACK_BOT_TOKEN: process.env.OPS_BACKUP_SLACK_BOT_TOKEN, PGHOSTADDR: process.env.PGHOSTADDR, PGSSLROOTCERT: process.env.PGSSLROOTCERT };
  try {
    await writeFile(join(dir, 'psql'), '#!/bin/sh\n/usr/bin/env\n', { mode: 0o700, flag: 'wx' });
    process.env.PATH = dir + ':' + saved.PATH;
    process.env.OPS_BACKUP_KEY_BASE64 = 'synthetic-secret-key'; process.env.OPS_BACKUP_SLACK_BOT_TOKEN = 'synthetic-secret-token';
    process.env.PGHOSTADDR = '203.0.113.1'; process.env.PGSSLROOTCERT = 'system';
    const local = await psql('select 1;', { url: 'postgresql://drill:synthetic@localhost:5432/postgres', localOnly: true });
    assert.match(local, /^PGHOSTADDR=127\.0\.0\.1$/m); assert.match(local, /^PGSSLMODE=disable$/m);
    assert.doesNotMatch(local, /PGSSLROOTCERT=|OPS_BACKUP_|synthetic-secret/);
    const remote = await psql('select 1;', { url: 'postgresql://reader:synthetic@db.example/postgres?sslmode=verify-full', readOnly: true });
    assert.match(remote, new RegExp(`^PGSSLROOTCERT=${SUPABASE_ROOT_CERT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.match(remote, /^PGSSLMODE=verify-full$/m);
    assert.doesNotMatch(remote, /^PGSERVICE=/m); assert.match(remote, /^PGSERVICEFILE=\/dev\/null$/m);
    assert.doesNotMatch(remote, /PGHOSTADDR=|OPS_BACKUP_|synthetic-secret/);
    assert.match(remote, /default_transaction_read_only=on/);
  } finally {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});

test('SQL literals cannot escape JSON data and canonical digests are key-order independent', () => {
  assert.equal(sqlLiteral("x');drop schema public;--"), "'x'');drop schema public;--'");
  assert.equal(canonical({ z: 2, a: [1] }), canonical({ a: [1], z: 2 }));
  assert.match(restoreSql(fixture()), /jsonb_to_recordset/);
  const one = fixture(); const two = structuredClone(one); two.months[0].revision = 3;
  assert.notEqual(stateDigest(one), stateDigest(two));
});

test('offsite verification requires matching archive, decryption, migration, freshness and 0600 files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ops-backup-unit-')); const key = randomBytes(32);
  try {
    const { archive, report } = await makeBackup({ scope: 'backup_synthetic', key, query: async () => JSON.stringify(fixture()) });
    const source = join(dir, 'source.enc'); const copied = join(dir, 'download.enc'); const reportPath = join(dir, 'report.json');
    await privateWrite(source, archive); await privateWrite(reportPath, JSON.stringify(report)); await copyFile(source, copied);
    assert.equal((await stat(source)).mode & 0o777, 0o600);
    assert.equal(report.offsiteVerified, false);
    const verified = await verifyOffsite({ archivePath: copied, reportPath, key });
    assert.equal(verified.offsiteVerified, true); assert.ok(verified.snapshotAgeMs >= 0);
    await assert.rejects(verifyOffsite({ archivePath: copied, reportPath, key, now: Date.now() + 8 * 3600_000 }), /rpo_window/);
    await assert.rejects(verifyOffsite({ archivePath: copied, reportPath, key, now: Date.now() - 120_000 }), /rpo_window/);
    await assert.rejects(verifyOffsite({ archivePath: join(dir, 'missing'), reportPath, key }));
    await writeFile(reportPath, JSON.stringify({ ...report, archiveSha256: '0'.repeat(64) }));
    await assert.rejects(verifyOffsite({ archivePath: copied, reportPath, key }), /digest_mismatch/);
    const { payload } = await readArchive(source, key); payload.migration.sql += '\n-- altered';
    await writeFile(copied, encryptBackup(payload, key));
    await assert.rejects(readArchive(copied, key), /migration_version_mismatch/);
    await assert.rejects(privateWrite(source, archive), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('untrusted DB error text and credentials are not logged by CLI', () => {
  const secret = 'never-print-this-private-value';
  let caught;
  try { execFileSync(process.execPath, ['scripts/operations-backup.mjs', 'create', '/unused.enc', '/unused.json'], {
    cwd: ROOT, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, OPS_BACKUP_KEY_BASE64: secret, OPS_BACKUP_DATABASE_URL: secret } }); }
  catch (error) { caught = error; }
  assert.equal(caught.status, 1); assert.doesNotMatch(caught.stderr + caught.stdout, new RegExp(secret));
  assert.deepEqual(JSON.parse(caught.stderr), { event: 'operations_backup', outcome: 'failed', code: 'invalid_encryption_key' });
});

test('failure reporter transmits bounded metadata and treats API rejection/body failure as failure', async () => {
  const env = { OPS_BACKUP_SLACK_BOT_TOKEN: 'synthetic-private-token', OPS_BACKUP_SLACK_CHANNEL_ID: 'synthetic-channel', GITHUB_REPOSITORY: 'org/repo', GITHUB_RUN_ID: '123' };
  let calls = 0;
  const sent = await reportBackupFailure(env, async (url, options) => {
    calls++; assert.equal(url, 'https://slack.com/api/chat.postMessage');
    const body = JSON.parse(options.body); const metadata = JSON.parse(body.text);
    assert.deepEqual(metadata, { event: 'operations_backup_failed', runId: '123', phase: 'backup_or_restore_verification', repository: 'org/repo', workflowUrl: 'https://github.com/org/repo/actions/runs/123' });
    assert.equal(body.text.includes(env.OPS_BACKUP_SLACK_BOT_TOKEN), false); assert.equal(body.text.includes(env.OPS_BACKUP_SLACK_CHANNEL_ID), false);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  assert.equal(sent.outcome, 'sent'); assert.equal(calls, 1);
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ ok: false }) }, { ok: true, json: async () => { throw Error('secret'); } }]) {
    assert.equal((await reportBackupFailure(env, async () => response)).outcome, 'failed');
  }
  assert.equal((await reportBackupFailure({}, async () => { throw Error('must not call'); })).outcome, 'unconfigured');
});

test('failure reporter bounds a transport that ignores abort', async () => {
  const started = performance.now(); let signal;
  const result = await reportBackupFailure({ OPS_BACKUP_SLACK_BOT_TOKEN: 'synthetic', OPS_BACKUP_SLACK_CHANNEL_ID: 'synthetic' }, async (_url, opts) => { signal = opts.signal; return new Promise(() => {}); });
  assert.equal(result.outcome, 'failed'); assert.equal(signal.aborted, true); assert.ok(performance.now() - started < 4000);
});

test('remote restore is rejected before archive access or any SQL', async () => {
  await assert.rejects(restoreDrill({ archivePath: '/does-not-exist', key: randomBytes(32), url: 'postgresql://user:synthetic@production.example/postgres?sslmode=verify-full' }), /local_database/);
});

test('local PG17 integration: scoped read-only export → encryption/download → fresh restore/hash/permissions/CAS', {
  skip: process.env.OPS_BACKUP_INTEGRATION !== '1', timeout: 90_000
}, async () => {
  const docker = process.env.OPS_BACKUP_LOCAL_DOCKER === '1';
  const url = process.env.OPS_RESTORE_LOCAL_DATABASE_URL;
  if (!docker) connection(url, { localOnly: true });
  const database = 'ops_backup_src_' + randomUUID().replaceAll('-', '');
  const admin = sql => psql(sql, { docker, url, database: 'postgres', localOnly: true });
  const query = sql => psql(sql, { docker, url, database, localOnly: true });
  const dir = await mkdtemp(join(tmpdir(), 'ops-backup-integration-')); let created = false;
  try {
    await admin(`create database ${database};`); created = true;
    await query(LOCAL_AUTH_SHIM + await readFile(resolve(ROOT, MIGRATION), 'utf8'));
    const data = fixture();
    await query(restoreSql(data));
    await query(`insert into ddakfit_operations_private.scopes values('other_scope',sha256(convert_to(${sqlLiteral(capability)},'UTF8')));`);
    await assert.rejects(psql("insert into ddakfit_operations_private.scopes values('forbidden_write',sha256('x'::bytea));", { docker, url, database, readOnly: true, localOnly: true }), /database_query_failed/);
    const key = randomBytes(32);
    const { archive, report } = await makeBackup({ scope: 'backup_synthetic', key,
      query: sql => psql(sql, { docker, url, database, readOnly: true, localOnly: true }) });
    assert.equal(report.monthCount, 1); assert.equal(report.operatorCount, 1);
    const archivePath = join(dir, 'backup.enc'); const downloaded = join(dir, 'downloaded.enc'); const reportPath = join(dir, 'export.json');
    await privateWrite(archivePath, archive); await privateWrite(reportPath, JSON.stringify(report)); await copyFile(archivePath, downloaded);
    assert.equal((await verifyOffsite({ archivePath: downloaded, reportPath, key })).offsiteVerified, true);
    const result = await restoreDrill({ archivePath: downloaded, key, docker, url });
    assert.equal(result.sourceStateSha256, result.restoredStateSha256);
    assert.deepEqual(result.sourceRevisions, [2]); assert.deepEqual(result.sourceAuditCounts, [2]);
    assert.equal(result.nextRevision, 3); assert.equal(result.nextAuditCount, 3); assert.equal(result.staleConflict, true);
    assert.equal(result.anonRpcBlocked, true); assert.equal(result.authenticatedPrivateBlocked, true);
    assert.equal(result.disposableDatabaseRemoved, true); assert.equal(result.productionRestored, false);
    console.log(JSON.stringify({ ...result, transport: 'local_file_copy_only_not_github', syntheticOnly: true }));
  } finally { if (created) await admin(`drop database ${database};`); await rm(dir, { recursive: true, force: true }); }
});
