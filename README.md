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
# Supabase development tools

The Supabase CLI is installed as a pinned project dependency. Use the package scripts so a global installation is not required:

- `pnpm supabase:help` — show available commands.
- `pnpm supabase:start` — start the local development stack after Docker Desktop is running.
- `pnpm supabase:status` — display local service URLs and keys.
- `pnpm supabase:link -- --project-ref pwmshlfnijluqmitkood` — link this checkout after authenticating with Supabase.
- `pnpm supabase:migrations` — compare local and linked migration history.
- `pnpm supabase:push` — deploy pending migrations to the linked development project.

The workspace MCP configuration is scoped to project `pwmshlfnijluqmitkood`. Restart Codex, authenticate the Supabase connection when prompted, and use a development project or branch rather than production patient data.
