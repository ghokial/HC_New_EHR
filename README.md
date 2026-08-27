# Healthcarology EHR

Healthcarology EHR is a document-derived clinical platform backed by a live Supabase PostgreSQL project. It includes patient registration, worldwide country reference data, hospital departments and services, UNIN/SNAU support, clinical entities, audited role-based access, and secure user invitations.

## Live backend

- Supabase project: `healthcarology-ehr`
- Region: `us-east-1`

Only the publishable browser key is committed. The Root email, database credentials, and service-role key are not stored in this repository.

## Run locally

```powershell
pnpm install --frozen-lockfile
pnpm start
```

Open `http://127.0.0.1:4173`. Sign in through the emailed magic link. The designated Root email is configured privately in the live database and assigned the Root role by the database trigger after account creation.

## Database

SQL migrations are in `supabase/migrations`. The country seed is generated from the pinned `i18n-iso-countries` dependency by `scripts/seed-countries.mjs`. The `create-user` Edge Function checks for Root or System Administrator membership before sending an invitation and assigning a role.

See `REQUIREMENTS.md` for the source-document ledger and explicit implementation boundaries.
