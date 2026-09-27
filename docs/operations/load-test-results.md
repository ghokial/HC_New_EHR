# Load test: access rules at realistic volume

Run with `pnpm test:load` (script: `tests/load/access-rules.load.mjs [patientsPerFacility] [facilities]`).

The script applies every migration to an in-memory Postgres (PGlite 0.3.16), loads synthetic patients and encounters with the production triggers running (identifier assignment, triage queue, audit log), then times the queries the staff screens actually send. Each query runs 5 times as a signed-in clinician (or HIM officer, or facility administrator) with MFA, so every access rule applies. It also checks that another facility's chart returns no rows.

PGlite is single-process WebAssembly Postgres. Its absolute times are slower than a Supabase server, so the numbers show how cost grows with data, not the exact times users will see. Machine: AMD Ryzen 5 7520U, 15 GB RAM, Node 24.19.0, run on 27 September 2026.

## Finding

Before this change, list screens slowed in proportion to facility size. Each access rule called a helper function (`private.can_read_patient_record`, `has_facility_role`, `is_facility_member`, `is_active_facility`) with that row's patient or facility, once per row, and those functions cannot be inlined. At 1,000 patients and 3,000 encounters per facility, the encounter list took 12 seconds and the audit log page 4 seconds. Both would grow further with volume. Supabase stops a signed-in user's query after a statement timeout (check `show statement_timeout;` as the `authenticated` role), so these screens would have started failing, not just slowing.

Migration `20260928100000_policy_per_statement_checks.sql` rewrites each rule into an equivalent form that works out the user's facilities once per query and checks each row against that list. It also adds an index for the audit log's newest-first order. Tests:

- `tests/db/policy-rewrite-equivalence.test.mjs` reads every table as 12 different users (both facility owners, a physician, a nurse, billing, HIM, a patient, a proxy, a clinician in two facilities, a former employee, the platform root, and an outsider), each with and without MFA. The rows each user can see are identical before and after the migration.
- The same file checks that no table's rules loop back on themselves for select, insert, update or delete.
- All 72 database tests pass.

## Results

5 facilities, 5,015 patients, 15,045 encounters, 20,075 audit rows; then 20 facilities, 50,060 patients, 150,180 encounters, 200,300 audit rows. Times are the median of 5 runs, in milliseconds.

| Screen query (source) | Before, 5,000 patients | After, 5,000 patients | After, 50,000 patients |
|---|---:|---:|---:|
| Patient list, ordered by name (`live.js:210`) | 957.5 | 36.4 | 36.7 |
| Recent patients (`portal-features.js:271`) | 884.6 | 17.7 | 15.9 |
| Patient count (`live.js:313`) | 889.3 | 11.8 | 13.4 |
| Name search | 880.3 | 13.1 | 18.2 |
| Open a chart: one patient's encounters | 20.5 | 19.9 | 19.5 |
| Another facility's chart (0 rows, as required) | 16.3 | 16.4 | 19.1 |
| Encounter list, latest 100 (`live.js:278`) | 12,332.5 | 50.5 | 76.7 |
| Today's encounter count (`live.js:310`) | 1,338.8 | 30.0 | 36.9 |
| Audit log page (`live.js:293`) | 4,056.3 | 10.0 | 9.1 |
| Audit log page for one facility | 141.5 | 11.8 | 10.2 |
| Facility report, one month | 18.2 | 17.0 | 45.0 |
| Facility report, one year | 25.4 | 27.5 | 120.2 |

After the change, screen times barely move between 5,000 and 50,000 patients. The yearly facility report grows with the facility's volume because it counts every event in the year. That is expected for a report.

## Open issue found (not fixed here)

The patient list (`live.js:210`) and the patient picker when starting an encounter (`live.js:43`) load every patient at the facility, with no limit. The API returns at most 1,000 rows (`max_rows = 1000` in `supabase/config.toml`), so at a facility with more than 1,000 patients, everyone after the first 1,000 alphabetically silently disappears from both lists. The fix is a server-side search box with paging instead of loading the whole list.

## Not covered

- Concurrency (many users at once) and network latency. That needs a staging Supabase project and a tool such as k6 against the REST API. Do not run it against the live project.
- Write paths (registration, orders) at volume. These are single-row operations and were not timed here.
