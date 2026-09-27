# Backup and restore runbook

Status: draft. The steps below have not yet been run against the live project (`pwmshlfnijluqmitkood`). The first restore drill should be run and signed off before this runbook is relied on.

## What has to be backed up

| What | Where it lives | Covered by a database dump? |
|---|---|---|
| Patient records, staff, facilities, billing, audit log | Postgres `public`, `private` schemas | Yes |
| Sign-in accounts and MFA factors | Postgres `auth` schema (managed by Supabase) | Only if included; check `data.sql` has `auth.users` rows |
| Uploaded files (profile photos) | Supabase Storage bucket `profile-photos` | **No.** A dump has the `storage.objects` rows but not the files |
| Scheduled job `healthcarology-daily-sooner-appointment-check` | pg_cron, created by migration `20260908194500` | Recreated by the migrations |
| Edge Function code | `supabase/functions` in this repository | In git |
| Edge Function secrets (`PORTAL_ORIGIN`, DHIS2 and lab tokens named in `integration_endpoints.configuration.auth_env`) | Supabase project secrets | **No.** Keep them in the organisation's password manager |
| Database schema | `supabase/migrations` in this repository | In git, and in `schema.sql` |

## 1. Managed backups (Supabase)

Supabase takes platform backups of the database; how often, how long they are kept, and whether point-in-time recovery is available depend on the plan and add-ons. In the dashboard, check Database › Backups for the project and write down:

- the backup frequency and retention shown there,
- whether point-in-time recovery (PITR) is enabled,
- who in the organisation can start a restore.

Decide the acceptable data loss (RPO) and downtime (RTO) with clinical leadership. If the acceptable data loss is under a day, daily backups alone are not enough and PITR is needed.

Managed backups do not include Storage files, and they are held by the same provider. Keep the independent logical backup below as well.

## 2. Independent logical backup (weekly, and before every migration)

Run from this repository with the Supabase CLI (installed as a dev dependency). The connection string is the project's database URL from the dashboard (Connect › Session pooler), percent-encoded. Do not save it in the repository or in shell history.

```bash
mkdir -p backup/$(date +%Y%m%d)
npx supabase db dump --db-url "$SUPABASE_DB_URL" -f backup/$(date +%Y%m%d)/roles.sql --role-only
npx supabase db dump --db-url "$SUPABASE_DB_URL" -f backup/$(date +%Y%m%d)/schema.sql
npx supabase db dump --db-url "$SUPABASE_DB_URL" -f backup/$(date +%Y%m%d)/data.sql --use-copy --data-only
node scripts/verify-backup.mjs backup/$(date +%Y%m%d)
```

`verify-backup.mjs` fails if a file is missing or empty, if `schema.sql` lacks any table created by the migrations, or if `data.sql` has no rows for facilities, memberships, patients, encounters or the audit log. It writes `manifest.json` with SHA-256 checksums.

Then:

1. Encrypt the folder before it leaves the machine (for example a password-protected 7-Zip archive with AES-256, or `age`), with the key in the password manager, not beside the backup.
2. Store it in two places controlled by the organisation, at least one off-site, and not only on this laptop or OneDrive.
3. Download the Storage bucket `profile-photos` (dashboard › Storage, or the Storage API) into the same backup.
4. Delete old copies according to the retention period the organisation sets for medical records.

`backup/` must never be committed. It contains patient data.

## 3. Restore drill (quarterly, and after major changes)

Restore into a scratch project or a local Supabase stack, never over the live database.

```bash
npx supabase start
psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command "SET session_replication_role = replica" --file data.sql --dbname "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

`SET session_replication_role = replica` stops triggers (including the audit log's append-only trigger) from firing again while rows are reloaded.

After the restore, check and record:

- [ ] Row counts for `patients`, `encounters`, `audit_logs`, `facility_memberships` match the source at backup time.
- [ ] `select count(*) from auth.users` matches, and a test account can sign in with MFA.
- [ ] `pnpm test:db` still passes against the migrations in the restored version.
- [ ] A clinician test account sees only its own facility's patients.
- [ ] Profile photos open.
- [ ] Time taken, compared with the agreed RTO.

Record the date, who ran it, the backup used, and the results. A backup that has never been restored should be treated as unproven.

## 4. Restoring the live service

1. Declare an incident; stop clinical data entry (paper downtime forms) so no new data is lost.
2. Choose the restore point. Prefer the dashboard restore (or PITR) for the live project, since it keeps `auth` and Storage in the same project.
3. After the restore, re-set Edge Function secrets if they were lost, and redeploy the functions from the tagged commit.
4. Enter the downtime paper records back into the system and note the gap in the audit record.
5. Run the checks in section 3 on the live project.

## Tested so far

- `scripts/verify-backup.mjs` is covered by `tests/verify-backup.test.mjs` (a complete dump passes; a dump missing a table or core data fails).
- The dump and restore commands themselves have **not** been run in this environment: Docker was not running and `psql` is not installed here.
