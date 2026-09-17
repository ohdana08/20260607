import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupError, connection, keyFromEnv, psql, readArchive, privateWrite, sha256, sqlLiteral } from './operations-backup.mjs';

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const stateDigest = (snapshot) => sha256(canonical({ scopes: snapshot.scopes, operators: snapshot.operators, months: snapshot.months }));

// This shim exists only in a newly generated local drill DB, never in Supabase.
export const LOCAL_AUTH_SHIM = `
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as
$uid$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $uid$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
`;

export function restoreSql(snapshot) {
  return `begin;
insert into ddakfit_operations_private.scopes(scope_id,secret_hash)
select scope_id,decode(secret_hash,'hex') from jsonb_to_recordset(${sqlLiteral(JSON.stringify(snapshot.scopes))}::jsonb) as r(scope_id text,secret_hash text);
insert into ddakfit_operations_private.operator_allowlist(scope_id,user_id,created_at)
select scope_id,user_id,created_at from jsonb_to_recordset(${sqlLiteral(JSON.stringify(snapshot.operators))}::jsonb) as r(scope_id text,user_id uuid,created_at timestamptz);
insert into ddakfit_operations_private.months(scope_id,month,revision,state,updated_by,updated_at)
select scope_id,month,revision,state,updated_by,updated_at from jsonb_to_recordset(${sqlLiteral(JSON.stringify(snapshot.months))}::jsonb) as r(scope_id text,month text,revision bigint,state jsonb,updated_by uuid,updated_at timestamptz);
commit;`;
}

export async function restoreDrill({ archivePath, key, url, docker = false, now = Date.now }) {
  const started = performance.now();
  // A caller cannot choose a restore target. A fresh local DB is created for
  // every attempt; neither DROP nor INSERT can target an operational database.
  if (!docker) connection(url, { localOnly: true });
  const database = 'ops_restore_' + randomUUID().replaceAll('-', '');
  const admin = (sql) => psql(sql, { url, docker, database: 'postgres', localOnly: true });
  const query = (sql) => psql(sql, { url, docker, database, localOnly: true });
  const { payload } = await readArchive(archivePath, key);
  let created = false;
  let result;
  try {
    await admin(`create database ${database};`); created = true;
    const restoreStarted = performance.now();
    await query(LOCAL_AUTH_SHIM + payload.migration.sql);
    await query(restoreSql(payload.snapshot));
    const { snapshotSql } = await import('./operations-backup.mjs');
    const restored = JSON.parse(await query(snapshotSql(payload.scope)));
    // Normalize timestamptz serialization independently of session timezone.
    const normalize = (snapshot) => ({ ...snapshot,
      operators: snapshot.operators.map(r => ({ ...r, created_at: new Date(r.created_at).toISOString() })),
      months: snapshot.months.map(r => ({ ...r, updated_at: new Date(r.updated_at).toISOString() })) });
    const sourceDigest = stateDigest(normalize(payload.snapshot));
    const restoredDigest = stateDigest(normalize(restored));
    if (sourceDigest !== restoredDigest) throw new BackupError('restored_state_mismatch');
    const restoreMs = Math.round(performance.now() - restoreStarted);
    const permissions = JSON.parse(await query(`select json_build_object(
      'anonRpcBlocked',not has_function_privilege('anon','public.ddakfit_operations_read(text,text,text)','EXECUTE'),
      'authenticatedPrivateBlocked',not has_schema_privilege('authenticated','ddakfit_operations_private','USAGE') and not has_table_privilege('authenticated','ddakfit_operations_private.months','SELECT'),
      'stateValid',not exists(select 1 from ddakfit_operations_private.months where ddakfit_operations_private.valid_state(month,revision,state) is not true));`));
    if (Object.values(permissions).some(v => v !== true)) throw new BackupError('restore_permission_or_state_failed');

    // Rotate the capability only in this disposable copy AFTER digest equality.
    // The backup contains a hash, never the original capability secret.
    const capability = randomBytes(32).toString('base64url');
    const actor = payload.snapshot.operators[0].user_id;
    const previous = restored.months[0];
    const month = previous?.month || '2020-01';
    const expected = previous?.revision || 0;
    const next = previous ? structuredClone(previous.state) : {
      schemaVersion: 1, revision: 0, goal: { month, startDate: month + '-01', deadline: month + '-31', targetKrw: 1, plannedVideos: 1, wordPriceKrw: 1 }, snapshots: [], videos: [], audit: [] };
    next.revision = expected + 1;
    next.audit = [{ revision: expected + 1, kind: 'goal', key: month, actorId: actor, at: new Date(now()).toISOString() }];
    await query(`update ddakfit_operations_private.scopes set secret_hash=sha256(convert_to(${sqlLiteral(capability)},'UTF8')) where scope_id=${sqlLiteral(payload.scope)};`);
    const call = `public.ddakfit_operations_compare_and_set(${sqlLiteral(payload.scope)},${sqlLiteral(capability)},${sqlLiteral(month)},${expected},${sqlLiteral(JSON.stringify(next))}::jsonb)`;
    const cas = JSON.parse(await query(`begin; set local role authenticated;
      set local request.jwt.claim.sub = ${sqlLiteral(actor)};
      select json_build_object('nextRevision',(result->>'revision')::bigint,'auditCount',jsonb_array_length(result->'audit'),'actorMatches',result#>>'{audit,-1,actorId}'=${sqlLiteral(actor)}) from (select ${call} result) written;
      commit;`));
    const stale = await query(`begin; set local role authenticated;
      set local request.jwt.claim.sub = ${sqlLiteral(actor)};
      select ${call} is null; commit;`);
    if (cas.nextRevision !== expected + 1 || cas.actorMatches !== true || cas.auditCount !== Math.min(100, (previous?.state.audit.length || 0) + 1) || stale !== 't') throw new BackupError('restore_cas_failed');
    result = { event: 'operations_backup_drill', backupId: payload.backupId, outcome: 'passed',
      sourceStateSha256: sourceDigest, restoredStateSha256: restoredDigest, monthCount: restored.months.length,
      sourceRevisions: restored.months.map(r => r.revision), sourceAuditCounts: restored.months.map(r => r.state.audit.length),
      nextRevision: cas.nextRevision, nextAuditCount: cas.auditCount, staleConflict: true, ...permissions,
      capabilityRotatedInDisposableCopyOnly: true, snapshotAt: payload.snapshot.snapshotAt,
      snapshotAgeMs: Math.max(0, now() - Date.parse(payload.snapshot.snapshotAt)), restoreMs,
      isolatedDrillMs: Math.round(performance.now() - started), rtoTargetMs: 15 * 60_000,
      rtoMetForThisFixture: performance.now() - started <= 15 * 60_000, fullServiceRtoMeasured: false,
      productionRestored: false, completedAt: new Date(now()).toISOString() };
    if (!result.rtoMetForThisFixture) throw new BackupError('restore_rto_exceeded');
  } finally {
    // Only the generated DB created above is removed. Refuse to claim a clean
    // successful drill if cleanup fails, and keep SQL/passwords out of logs.
    if (created) await admin(`drop database ${database};`);
  }
  return { ...result, disposableDatabaseRemoved: true };
}

async function main() {
  const [archivePath, reportPath] = process.argv.slice(2);
  if (!archivePath || !reportPath) throw new BackupError('usage_archive_report');
  const report = await restoreDrill({ archivePath, key: keyFromEnv(process.env.OPS_BACKUP_KEY_BASE64),
    url: process.env.OPS_RESTORE_LOCAL_DATABASE_URL, docker: process.env.OPS_BACKUP_LOCAL_DOCKER === '1' });
  await privateWrite(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ event: 'operations_backup_drill', outcome: 'failed', code: error instanceof BackupError ? error.message : 'drill_failed' })); process.exitCode = 1; });
}
