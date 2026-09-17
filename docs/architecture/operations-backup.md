# Operations scoped offsite backup and isolated restore

Implemented on 2026-09-18. This is a logical backup of **one operations scope**, not a complete BCC Supabase project backup. App runtime and remote databases were not changed by this work.

## Status and actual evidence

The scripts and workflow are implemented. **The GitHub environment/secrets and opt-in variable have not been configured, no remote artifact was uploaded, and scheduled offsite backup is not active.** A local file copy does not establish GitHub availability, retention, download permissions or external notification delivery.

Root independently ran the local PostgreSQL 17 integration after the final subprocess environment allowlist and local TLS fixes:

```sh
OPS_BACKUP_INTEGRATION=1 OPS_BACKUP_LOCAL_DOCKER=1 node --test tests/operations-backup.test.mjs
```

- 11/11 tests passed, including the actual local PostgreSQL integration. ESLint passed on the three scripts and test file.
- Synthetic scope export excluded a second scope. A write using the read-only export connection failed.
- Encrypted file was copied to a separate local path, decrypted and verified; this transport was **local file copy only**.
- Original/restored canonical scope, allowlist and month data SHA-256: `22972f952194764396da103ac289c80d7b7dd36c7f431a78cf48c45182b93f82` (equal).
- Source revision/audit `2/2`; next authenticated CAS revision/audit `3/3`; stale CAS rejected. Anonymous RPC and authenticated private access remained blocked. State validation passed and generated databases were removed.
- `snapshotAgeMs=743`, `restoreMs=277`, `isolatedDrillMs=733`. These measurements describe one small synthetic fixture on the local machine, not a production RPO/RTO or a database size/load benchmark.
- Unit coverage includes authenticated-encryption tampering/wrong key, missing/offsite digest mismatch/stale archive, migration mismatch, scope/revision corruption, exclusive 0600 writes, no credential output, Slack rejection/failure/timeout and remote restore rejection.

## Backup contract

`.github/workflows/operations-backup.yml` runs at UTC minute 23 every six hours after explicit opt-in. One job at a time is allowed; an ongoing backup is not cancelled by a newer schedule. GitHub schedules can be delayed or dropped, so the cron interval alone is not an RPO guarantee.

1. A dedicated database reader uses certificate-verified TLS and a 10-second connection timeout. One `REPEATABLE READ READ ONLY` transaction exports the selected scope, operator allowlist and all months. Each query has a 30-second statement timeout and the subprocess a 45-second limit. There is no `LIMIT` that could silently omit months.
2. A versioned envelope contains that consistent snapshot and the exact operations migration, with its SHA-256. It includes scope capability **hashes**, UUID allowlist, revision and original audit history. It does not contain the capability secret, auth users/tokens, other scopes, other BCC tables or Storage objects.
3. Node encrypts the entire envelope with AES-256-GCM, a random 96-bit nonce and a 256-bit random key. Format magic is authenticated. Files are created exclusively with mode 0600 inside directories created mode 0700. Plaintext is held in the job process/psql pipes and never saved or uploaded. Archives over 64 MiB fail closed rather than producing a partial backup.
4. An immutable GitHub Actions artifact contains only `backup.enc` and bounded export metadata; retention is 30 days. Artifact names include both run ID and attempt. A separate download is checked against the **original local export digest**, decrypted, checked against the trusted migration and rejected if the snapshot is more than seven hours old or materially in the future. This hard failure is additional to GitHub's download digest warning.
5. Every successful backup then restores the downloaded archive into a fresh, randomly named local PostgreSQL 17 database. Migration mismatch requires checking out the corresponding trusted source revision; SQL from an unknown archive is never executed. Original/restored canonical data hashes, revision/audit, validators, permissions, next CAS and stale conflict must pass.
6. The original capability is not required for the drill: only after original/restored hash equality, a new synthetic capability hash is installed in the **disposable copy** for the CAS probe. That change never affects the source or encrypted archive. A local auth.uid() shim checks the database/JWT contract; it is not a new Google OAuth test.
7. Only after the verified-evidence artifact uploads does the backup job finish successfully. Missing exports, upload/download errors, corruption, wrong keys, restore failures or failed cleanup cause a failed job. A separate bounded Slack failure reporter records only event/run ID/phase/repository/workflow URL and has a three-second deadline; Slack HTTP or API rejection is failure. It has no durable retry queue.

`operations-backup.mjs` passes only basic process settings (PATH/HOME/locale/temp paths) plus explicitly validated libpq settings to subprocesses. It excludes encryption keys, Slack/GitHub tokens, `PGHOSTADDR`, `PGSERVICE`, inherited `PGOPTIONS` and Docker overrides. Native local restore pins the loopback address; the pinned checkout `SUPABASE_ROOT_CERT` path is set only for remote `verify-full` connections, never local `sslmode=disable`. Docker mode requires a Unix socket endpoint and supplies it explicitly. The restore CLI cannot accept a target database name: it creates and removes only its own `ops_restore_<random>` database. It cannot restore directly into Supabase or a pre-existing operational database.

## Required activation and key custody

Use GitHub environment `operations-backup`, with access restricted to the approved default branch and protected workflow changes. Grant the scheduled workflow access without a per-run approval that would silently hold automatic backups. Configure these **secrets**; never place their values in YAML, logs, issue bodies or artifacts:

| Secret | Purpose |
|---|---|
| `OPS_BACKUP_DATABASE_URL` | Dedicated reader DSN, supported direct/session-pooler connection, `sslmode=verify-full` |
| `OPS_BACKUP_SCOPE` | The exact approved production operations scope |
| `OPS_BACKUP_KEY_BASE64` | Canonical base64 of a cryptographically random 32-byte key |
| `OPS_BACKUP_SLACK_BOT_TOKEN` | Approved BCC bot credential for the failure reporter |
| `OPS_BACKUP_SLACK_CHANNEL_ID` | Approved private receiver |

Set repository variable `OPS_BACKUP_ENABLED=true` only after the reader, key custody, artifact budget/retention, failure destination and independent freshness monitor are ready. A skipped job is not a verified backup, even if the surrounding workflow reports success.

The database reader must have only CONNECT, USAGE on `ddakfit_operations_private`, SELECT on the three tables, and role-specific RLS SELECT policies constrained to the approved `scope_id`. It needs no app RPC EXECUTE, INSERT/UPDATE/DELETE, role creation or BYPASSRLS. The source export always starts a read-only transaction as a second boundary. Test that reader sees the approved scope, cannot see another scope and cannot write before activation. Use the server/session pooler hostname that passes certificate hostname verification; do not downgrade TLS to make a failed connection pass.

The hosted Supabase pooler is verified with Supabase's public `prod-ca-2021` root at `infra/supabase/prod-ca-2021.crt` (PEM file SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`; X.509 SHA-256 fingerprint `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`; expiry 2031-04-26). The backup script passes that exact checkout path through `PGSSLROOTCERT` only for remote `verify-full` connections; the operating-system CA bundle alone does not validate this pooler certificate. Rotate the pinned CA and re-run the live TLS drill before its expiry or whenever Supabase announces a database CA change.

Keep the encryption key in an independent password manager/offline recovery escrow, with a named recovery owner and access test. A GitHub-only key is not sufficient disaster recovery. Retain old keys at least as long as every artifact encrypted with them; exercise old-key recovery before rotation/removal. Separately escrow the production capability/configuration and Google Auth dependencies: this scope archive is not an Auth/project backup. Do not place plaintext backup keys alongside the encrypted offsite artifact.

GitHub's free allowance, storage quota and spending controls must be checked before activation. This work did not purchase capacity or change billing. Thirty-day retention is requested, not verified remotely; repository/organization retention settings must permit it. At four archives per day, expected steady state is about 120 encrypted snapshots plus small evidence artifacts. GitHub account/repository deletion and simultaneous loss of key custody remain disaster risks; a separately controlled second storage destination can be added if that risk is unacceptable.

## RPO, RTO and missing-run detection

- Proposed scope RPO target: six hours; alert when the newest **verified backup** is older than seven hours. A successfully exported but unuploaded or unrestorable file does not count. `snapshotAt` comes from the database transaction, not the last changed row's timestamp.
- The workflow records snapshot age after re-download and during drill. It does not claim that a newly created backup proves the previous six hours met RPO.
- The independent monitor must inspect this exact workflow on the approved branch, require a successful `backup` job and successful final `Store verified RPO and isolated RTO evidence` step (or the corresponding verified artifact), and reject skipped/cancelled/failed runs. Use snapshot time when available or conservatively `run_started_at`, not a late `updated_at` that could hide old data. Check artifact expiry/availability, not only run success. The app/host monitor must itself be outside this GitHub schedule so a missing run can be detected.
- Proposed isolated database drill target: 15 minutes. `restoreMs` includes migration/data restore and digest comparison; `isolatedDrillMs` includes download-file decrypt/validation, database creation and correctness probes, but excludes remote artifact retrieval, human response, production cutover and cleanup. Full service RTO is explicitly unmeasured. The workflow timeout is 15 minutes and cleanup must succeed before the report declares success.
- The independent freshness monitor and actual Slack receipt for a backup failure still require deployed verification. The app's previous 503 Slack test does not by itself prove this Actions reporter or missing-run detector works.

## Recovery runbook

1. Identify an immutable verified artifact/run preceding the incident and obtain the corresponding trusted code/migration and escrowed key. Verify the artifact's SHA and key before any operational action. Download into a restricted private directory and use the drill CLI against a fresh local PG17 instance.
2. Run `node scripts/operations-backup-drill.mjs /private/path/backup.enc /private/path/drill-report.json` with `OPS_BACKUP_KEY_BASE64` and a loopback-only `OPS_RESTORE_LOCAL_DATABASE_URL`, or the explicitly local Docker mode. No production DSN is accepted.
3. Require matching canonical hashes, all restored revision/audit values, validators/private permissions, next CAS, stale conflict, and cleanup success. Record actual recovery duration and the source snapshot time; data loss is measured from snapshot time to incident, not from file download time.
4. An actual production recovery is a separate reviewed action: stop writes, preserve the failed state for diagnosis, restore into a new isolated scope/database, validate credentials/access and switch deliberately. Avoid reusing a previously observed revision after rollback (ABA); a new scope/capability or a monotonic recovery epoch is safer than restoring an old revision into the live scope. Reauthenticate/refresh clients, then repeat read/save/stale and alert checks before reopening writes.
5. Never run this drill by restoring the entire shared BCC Supabase project: that would affect its other applications and Auth. This implementation intentionally has no in-place production restore command.

## Sources

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups): Free projects need regular logical exports and offsite custody; project-wide restore has downtime and does not include Storage objects.
- [GitHub workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data): retention, re-download and digest behavior. Actions commit pins were resolved from the official actions repositories on 2026-09-18.
- [GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): scheduling/default-branch limitations; an independent missing-run check is necessary.
