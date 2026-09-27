// Facility reports and DHIS2 dataValueSet generation.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";
import { reportCsv } from "../../reporting.js";

let h, ids = {};
const report = (userId, from = "2026-09-01", to = "2026-09-30") => h.as(userId, "aal2", () => h.q(`select public.facility_report($1,$2::date,$3::date) as r`, [ids.f1, from, to])).then(r => r.rows[0].r);

before(async () => {
  h = helpers(await createDatabase());
  ids.owner = await h.user("o@f1.test"); ids.nurse = await h.user("n@f1.test"); ids.exec = await h.user("e@f1.test"); ids.owner2 = await h.user("o@f2.test");
  ids.f1 = await h.facility("f-one", ids.owner); ids.f2 = await h.facility("f-two", ids.owner2);
  await h.member(ids.f1, ids.nurse, "nurse"); await h.member(ids.f1, ids.exec, "executive");
  await h.q(`insert into public.facility_memberships(facility_id,user_id,role_id,is_owner) values($1,$2,(select id from public.roles where role_code='sysadmin'),true) on conflict do nothing`, [ids.f1, ids.owner]);
  for (const day of ["2026-09-03", "2026-09-10", "2026-10-02"]) await h.q(`insert into public.patients(first_name,last_name,facility_id,created_at) values('R','P',$1,$2::timestamptz)`, [ids.f1, day]);
  await h.q(`insert into public.patients(first_name,last_name,facility_id,created_at) values('Other','Fac',$1,'2026-09-05')`, [ids.f2]);
  const p = (await h.one(`select id from public.patients where facility_id=$1 order by id limit 1`, [ids.f1])).id;
  await h.q(`alter table public.encounters disable trigger enforce_triage_before_encounter`);
  await h.q(`insert into public.encounters(patient_id,encounter_type,start_at,status) values($1,'Outpatient','2026-09-04','closed'),($1,'Emergency','2026-09-12','closed'),($1,'Outpatient','2026-10-01','closed')`, [p]);
  await h.q(`alter table public.encounters enable trigger enforce_triage_before_encounter`);
});

test("reports are aggregates for the chosen period and facility, visible only to management roles", async () => {
  const r = await report(ids.exec);
  assert.equal(r.new_patients, 2, "only September registrations at this facility");
  assert.equal(r.outpatient_encounters, 2); assert.deepEqual(r.encounters_by_type, { Outpatient: 1, Emergency: 1 });
  assert.equal(r.inpatient_admissions, 0);
  await assert.rejects(report(ids.nurse), /Only facility administrators, executives/);
  await assert.rejects(h.as(ids.owner2, "aal2", () => h.q(`select public.facility_report($1,'2026-09-01','2026-09-30')`, [ids.f1])), /Only facility administrators/);
  await assert.rejects(report(ids.exec, "2026-01-01", "2027-06-01"), /at most one year/);
  assert.ok(!JSON.stringify(r).includes('"first_name"'), "no patient-level data");
});

test("the CSV export contains every metric row", async () => {
  const csv = reportCsv(await report(ids.exec));
  assert.match(csv, /"New patients registered","2"/); assert.match(csv, /"Encounters: Emergency","1"/);
});

test("DHIS2: only mapped metrics are sent, with the facility's own identifiers, and only by administrators", async () => {
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`select public.dhis2_data_value_set($1,'202609')`, [ids.f1])), /organisation unit first/);
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`insert into public.facility_dhis2_settings(facility_id,org_unit_uid) values($1,'bad')`, [ids.f1])), /check constraint/);
  await h.as(ids.owner, "aal2", () => h.q(`insert into public.facility_dhis2_settings(facility_id,org_unit_uid,data_set_uid) values($1,'OrgUnit0001','DataSet0001')`, [ids.f1]));
  await h.as(ids.owner, "aal2", () => h.q(`insert into public.dhis2_data_element_mappings(facility_id,metric_code,data_element_uid) values($1,'new_patients','DataElem001'),($1,'outpatient_encounters','DataElem002')`, [ids.f1]));
  const set = (await h.as(ids.owner, "aal2", () => h.q(`select public.dhis2_data_value_set($1,'202609') as s`, [ids.f1]))).rows[0].s;
  assert.equal(set.period, "202609"); assert.equal(set.orgUnit, "OrgUnit0001"); assert.equal(set.dataSet, "DataSet0001");
  assert.deepEqual(set.dataValues.map(v => [v.dataElement, v.value]).sort(), [["DataElem001", "2"], ["DataElem002", "2"]]);
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`select public.dhis2_data_value_set($1,'2026-09')`, [ids.f1])), /YYYYMM/);
  await assert.rejects(h.as(ids.exec, "aal2", () => h.q(`select public.dhis2_data_value_set($1,'202609')`, [ids.f1])), /Only facility administrators/);
  assert.equal((await h.as(ids.owner2, "aal2", () => h.q(`select * from public.dhis2_data_element_mappings`))).rows.length, 0);
});

test("exports are recorded, including DHIS2", async () => {
  await h.as(ids.exec, "aal2", () => h.q(`insert into public.data_export_audit(facility_id,exported_by,export_type,module) values($1,$2,'CSV','facility_report')`, [ids.f1, ids.exec]));
  await h.as(ids.owner, "aal2", () => h.q(`insert into public.data_export_audit(facility_id,exported_by,export_type,module) values($1,$2,'DHIS2','facility_report')`, [ids.f1, ids.owner]));
  assert.equal((await h.one(`select count(*)::int as n from public.data_export_audit where facility_id=$1`, [ids.f1])).n, 2);
});
