// Consent-based record exchange between facilities.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";

let h, ids = {};
const rows = async promise => (await promise).rows;
const request = (userId, extra = {}) => h.as(userId, "aal2", () => h.q(`select public.request_facility_record_access($1,$2,$3,$4::date,'Referral follow-up',$5) as id`,
  [extra.facility ?? ids.fB, extra.unin ?? ids.p.snau, extra.last ?? "Exchange", extra.dob ?? "1985-05-05", extra.sections ?? ["diagnoses", "labs", "notes"]])).then(r => r.rows[0].id);

before(async () => {
  h = helpers(await createDatabase());
  ids.ownerA = await h.user("oa@a.test"); ids.ownerB = await h.user("ob@b.test");
  ids.docA = await h.user("da@a.test"); ids.docB = await h.user("db@b.test"); ids.nurseB = await h.user("nb@b.test"); ids.billingB = await h.user("bb@b.test"); ids.patientUser = await h.user("p@home.test");
  ids.fA = await h.facility("fac-a", ids.ownerA); ids.fB = await h.facility("fac-b", ids.ownerB);
  await h.member(ids.fA, ids.docA, "physician"); await h.member(ids.fB, ids.docB, "physician"); await h.member(ids.fB, ids.nurseB, "nurse"); await h.member(ids.fB, ids.billingB, "billing");
  await h.q(`insert into public.facility_memberships(facility_id,user_id,role_id,is_owner) values($1,$2,(select id from public.roles where role_code='sysadmin'),true) on conflict do nothing`, [ids.fA, ids.ownerA]);
  ids.p = await h.one(`insert into public.patients(first_name,last_name,facility_id,birth_country_id,unin_province_code,unin_commune_code,sex,date_of_birth) values('Rec','Exchange',$1,(select id from public.countries where iso2='CD'),'10','L','F','1985-05-05') returning id,snau`, [ids.fA]);
  await h.q(`insert into public.patient_accounts(user_id,patient_id) values($1,$2) on conflict do nothing`, [ids.patientUser, ids.p.id]);
  const release = await h.one(`select id from public.terminology_releases limit 1`);
  await h.q(`insert into public.diagnoses(patient_id,terminology_release_id,code,entity_uri,display) values($1,$2,'BA00','http://id.who.int/icd/entity/1','Essential hypertension')`, [ids.p.id, release.id]);
  const order = (await h.one(`insert into public.orders(patient_id,order_type,status) values($1,'lab','completed') returning id`, [ids.p.id])).id;
  const lab = (await h.one(`insert into public.lab_orders(order_id,test_code) values($1,'GLU') returning id`, [order])).id;
  await h.q(`insert into public.lab_results(lab_order_id,analyte_code,numeric_value,validation_status) values($1,'GLU',5.2,'validated'),($1,'GLU-DRAFT',9.9,'pending_validation')`, [lab]);
});

test("a clinician at another facility can request only with the exact UNIN, last name, and birth date", async () => {
  await assert.rejects(request(ids.docB, { last: "Wrong" }), /No patient matches/);
  await assert.rejects(request(ids.docB, { dob: "1985-05-06" }), /No patient matches/);
  await assert.rejects(request(ids.billingB), /Only clinicians/);
  await assert.rejects(request(ids.docA, { facility: ids.fA }), /already registered at your facility/);
  ids.g1 = await request(ids.docB);
  await assert.rejects(request(ids.nurseB), /already waiting/);
});

test("nothing can be read until the patient approves", async () => {
  await assert.rejects(h.as(ids.docB, "aal2", () => h.q(`select public.read_shared_facility_record($1)`, [ids.g1])), /not active/);
  const pending = await rows(h.as(ids.patientUser, "aal1", () => h.q(`select id,status,purpose from public.facility_record_access_grants`)));
  assert.equal(pending.length, 1); assert.equal(pending[0].status, "requested");
  await assert.rejects(h.as(ids.docA, "aal2", () => h.q(`select public.respond_facility_record_access($1,true,7)`, [ids.g1])), /not found/, "only the patient decides");
});

test("after approval, only granted sections are returned, with validated results only, and every view is audited for both facilities", async () => {
  await h.as(ids.patientUser, "aal1", () => h.q(`select public.respond_facility_record_access($1,true,7)`, [ids.g1]));
  const record = (await h.as(ids.docB, "aal2", () => h.q(`select public.read_shared_facility_record($1) as r`, [ids.g1]))).rows[0].r;
  assert.equal(record.diagnoses[0].display, "Essential hypertension");
  assert.deepEqual(record.labs.map(l => l.test), ["GLU"], "unvalidated results are not shared");
  assert.equal(record.medications, undefined, "sections not granted are absent");
  assert.equal(record.patient.unin, ids.p.snau);
  const audit = await h.q(`select distinct facility_id from public.audit_logs where context='record-exchange' and patient_id=$1`, [ids.p.id]);
  assert.deepEqual(audit.rows.map(r => r.facility_id).sort(), [ids.fA, ids.fB].sort());
  await assert.rejects(h.as(ids.billingB, "aal2", () => h.q(`select public.read_shared_facility_record($1)`, [ids.g1])), /Access not found/, "non-clinical staff cannot read");
});

test("the patient can revoke at any time and access stops", async () => {
  await h.as(ids.patientUser, "aal1", () => h.q(`select public.revoke_facility_record_access($1)`, [ids.g1]));
  await assert.rejects(h.as(ids.docB, "aal2", () => h.q(`select public.read_shared_facility_record($1)`, [ids.g1])), /not active/);
});

test("emergency access: physicians only, a written reason, 24 hours, and flagged for both facilities", async () => {
  await assert.rejects(h.as(ids.nurseB, "aal2", () => h.q(`select public.emergency_facility_record_access($1,$2,'Exchange','1985-05-05','Unconscious on arrival')`, [ids.fB, ids.p.snau])), /Only physicians/);
  await assert.rejects(h.as(ids.docB, "aal2", () => h.q(`select public.emergency_facility_record_access($1,$2,'Exchange','1985-05-05','urgent')`, [ids.fB, ids.p.snau])), /at least 10 characters/);
  const g = (await h.as(ids.docB, "aal2", () => h.q(`select public.emergency_facility_record_access($1,$2,'Exchange','1985-05-05','Unconscious on arrival, allergy history needed') as id`, [ids.fB, ids.p.snau]))).rows[0].id;
  const record = (await h.as(ids.docB, "aal2", () => h.q(`select public.read_shared_facility_record($1) as r`, [g]))).rows[0].r;
  assert.equal(record.grant.status, "emergency"); assert.ok(record.medications, "emergency access covers all sections");
  const flags = await h.q(`select distinct facility_id from public.audit_logs where action_type='EMERGENCY_ACCESS' and patient_id=$1`, [ids.p.id]);
  assert.equal(flags.rows.length, 2, "both facilities' compliance staff can see it");
  const seen = await rows(h.as(ids.patientUser, "aal1", () => h.q(`select status,emergency_reason from public.facility_record_access_grants where status='emergency'`)));
  assert.equal(seen.length, 1, "the patient sees the emergency access"); assert.match(seen[0].emergency_reason, /Unconscious/);
  await h.as(ids.patientUser, "aal1", () => h.q(`select public.revoke_facility_record_access($1)`, [g]));
  await assert.rejects(h.as(ids.docB, "aal2", () => h.q(`select public.read_shared_facility_record($1)`, [g])), /not active/);
});
