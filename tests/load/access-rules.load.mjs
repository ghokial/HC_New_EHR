// Load test of the access rules (row-level security) at realistic volume.
// Builds a synthetic dataset in PGlite with every migration applied, then times the
// queries the staff app actually runs, as a signed-in clinician with MFA, and prints
// the query plans. PGlite is single-process WebAssembly Postgres: absolute timings are
// slower than a Supabase server, but relative costs and plans are representative.
//   node tests/load/access-rules.load.mjs [patientsPerFacility=2500] [facilities=20]
import { createDatabase, helpers } from "../db/harness.mjs";

const perFacility = Number(process.argv[2] || 2500), facilityCount = Number(process.argv[3] || 20);
const encountersPerPatient = 3, runs = 5;
const log = (...a) => console.log(...a);
const started = performance.now();

const db = await createDatabase();
const h = helpers(db);
log(`Migrations applied in ${((performance.now() - started) / 1000).toFixed(1)} s`);

// Staff: one owner, one physician, one HIM officer per facility.
const facilities = [], staff = {};
for (let i = 0; i < facilityCount; i++) {
  const owner = await h.user(`owner${i}@load.test`);
  const fid = await h.facility(`load-${i}`, owner);
  const physician = await h.user(`md${i}@load.test`), him = await h.user(`him${i}@load.test`);
  await h.member(fid, physician, "physician"); await h.member(fid, him, "him");
  await h.q(`insert into public.facility_memberships(facility_id,user_id,role_id,is_owner) values($1,$2,(select id from public.roles where role_code='sysadmin'),true) on conflict do nothing`, [fid, owner]);
  await h.q(`insert into public.active_facility_context(user_id,facility_id) values($1,$2) on conflict(user_id) do nothing`, [owner, fid]);
  facilities.push(fid); staff[fid] = { owner, physician, him };
}

// Patients and encounters, loaded as the database owner with triggers on (the UNIN,
// triage queue and audit triggers fire as they would in production), except the triage
// guard on encounters, which needs a triage record first.
let t = performance.now();
await db.query(`insert into public.patients(first_name,last_name,date_of_birth,sex,facility_id,created_at)
  select 'P'||g, (array['Mbala','Kabila','Ilunga','Tshibanda','Mukendi','Kasongo','Lukusa','Ngoy','Banza','Mwamba'])[1+g%10]||(g%97),
         date '1950-01-01' + (g*37%25000), (array['Female','Male'])[1+g%2], f.id, timestamptz '2025-01-01' + (g%600)*interval '1 day'
  from unnest($1::uuid[]) with ordinality f(id,n), generate_series(1,$2::int) g`, [facilities, perFacility]);
const patientCount = (await h.one(`select count(*)::int n from public.patients`)).n;
log(`Loaded ${patientCount} patients in ${((performance.now() - t) / 1000).toFixed(1)} s`);

t = performance.now();
await db.exec(`alter table public.encounters disable trigger enforce_triage_before_encounter`);
await db.query(`insert into public.encounters(patient_id,encounter_type,start_at,status)
  select p.id, (array['Outpatient','Emergency','Outpatient','Inpatient'])[1+k%4], p.created_at + k*interval '30 days', 'closed'
  from public.patients p, generate_series(1,$1::int) k`, [encountersPerPatient]);
await db.exec(`alter table public.encounters enable trigger enforce_triage_before_encounter`);
const encounterCount = (await h.one(`select count(*)::int n from public.encounters`)).n;
const auditCount = (await h.one(`select count(*)::int n from public.audit_logs`)).n;
log(`Loaded ${encounterCount} encounters in ${((performance.now() - t) / 1000).toFixed(1)} s; audit log now holds ${auditCount} rows`);
await db.exec(`analyze`);

const fid = facilities[0], { owner, physician, him } = staff[fid];
const somePatient = (await h.one(`select id from public.patients where facility_id=$1 order by id limit 1`, [fid])).id;
const otherPatient = (await h.one(`select id from public.patients where facility_id=$1 order by id limit 1`, [facilities[1]])).id;

// The staff app's queries (live.js and portal-features.js), as PostgREST would run them:
// PostgREST caps responses at api.max_rows = 1000 (supabase/config.toml).
const cases = [
  ["Patient list, ordered by name (live.js:210)", physician, `select id,first_name,middle_name,last_name,mrn,date_of_birth,sex,snau,life_status from public.patients where facility_id=$1 order by last_name limit 1000`, [fid]],
  ["Recent patients (portal-features.js:271)", owner, `select id,first_name,last_name,date_of_birth,snau,mrn,created_at from public.patients where facility_id=$1 order by created_at desc limit 100`, [fid]],
  ["Patient count (live.js:313)", physician, `select count(*) from public.patients where facility_id=$1`, [fid]],
  ["Name search", physician, `select id,first_name,last_name from public.patients where facility_id=$1 and last_name ilike 'Kasongo1%' order by last_name limit 50`, [fid]],
  ["Open a chart: encounters for one patient", physician, `select * from public.encounters where patient_id=$1 order by start_at desc`, [somePatient]],
  ["Other facility's chart (must return 0 rows)", physician, `select * from public.encounters where patient_id=$1`, [otherPatient]],
  ["Encounter list, latest 100 (live.js:278)", physician, `select e.id,e.encounter_type,e.start_at,e.status,p.first_name,p.last_name from public.encounters e join public.patients p on p.id=e.patient_id where p.facility_id=$1 order by e.start_at desc limit 100`, [fid]],
  ["Today's encounter count (live.js:310)", physician, `select count(*) from public.encounters e join public.patients p on p.id=e.patient_id where p.facility_id=$1 and e.start_at>=now()-interval '1 day'`, [fid]],
  ["Audit log page (live.js:293)", him, `select id,occurred_at,action_type,table_name,record_id,patient_id from public.audit_logs order by occurred_at desc limit 200`, []],
  ["Audit log page filtered to the facility", him, `select id,occurred_at,action_type,table_name,record_id,patient_id from public.audit_logs where facility_id=$1 order by occurred_at desc limit 200`, [fid]],
  ["Facility report, one month", owner, `select public.facility_report($1,'2025-06-01','2025-06-30')`, [fid]],
  ["Facility report, one year", owner, `select public.facility_report($1,'2025-01-01','2025-12-31')`, [fid]],
];

const results = [];
for (const [name, user, sql, params] of cases) {
  const times = [];
  let rows = 0;
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    const r = await h.as(user, "aal2", () => db.query(sql, params));
    times.push(performance.now() - s); rows = r.rows.length;
  }
  times.sort((a, b) => a - b);
  const plan = (await h.as(user, "aal2", () => db.query(`explain ${sql}`, params))).rows.map(r => r["QUERY PLAN"]);
  results.push({ name, rows, median: times[Math.floor(runs / 2)], max: times[runs - 1], seqScans: plan.filter(l => /Seq Scan/.test(l)).map(l => l.trim().replace(/\s+\(cost.*$/, "")), plan });
}

log(`\nDataset: ${facilityCount} facilities, ${patientCount} patients, ${encounterCount} encounters, ${auditCount} audit rows. Median of ${runs} runs, as a clinician with MFA.\n`);
log(`| Query | Rows | Median ms | Max ms | Sequential scans |`);
log(`|---|---:|---:|---:|---|`);
for (const r of results) log(`| ${r.name} | ${r.rows} | ${r.median.toFixed(1)} | ${r.max.toFixed(1)} | ${r.seqScans.join("; ") || "none"} |`);
if (process.env.PLANS) for (const r of results) log(`\n### ${r.name}\n${r.plan.join("\n")}`);
const leaked = results.find(r => r.name.startsWith("Other facility"));
if (leaked.rows) { console.error("Access rule failure: another facility's chart was readable"); process.exit(1); }
log(`\nTotal run time ${((performance.now() - started) / 1000).toFixed(0)} s`);
