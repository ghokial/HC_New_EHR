// Phase 2: medication reconciliation and discharge summaries.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";

let h, ids = {};
const rows = async promise => (await promise).rows;

before(async () => {
  h = helpers(await createDatabase());
  const { user, facility, member, one, q } = h;
  ids.owner = await user("owner@f1.test"); ids.nurse = await user("nurse@f1.test"); ids.doc = await user("doc@f1.test"); ids.billing = await user("billing@f1.test"); ids.patientUser = await user("patient@home.test");
  ids.f1 = await facility("f-one", ids.owner);
  await member(ids.f1, ids.nurse, "nurse"); await member(ids.f1, ids.doc, "physician"); await member(ids.f1, ids.billing, "billing");
  ids.p = (await one(`insert into public.patients(first_name,last_name,facility_id) values('Dis','Charge',$1) returning id`, [ids.f1])).id;
  await q(`insert into public.patient_accounts(user_id,patient_id) values($1,$2) on conflict do nothing`, [ids.patientUser, ids.p]);
  ids.bed = (await one(`insert into public.inpatient_beds(facility_id,ward,room,bed_label) values($1,'W','1','A') returning id`, [ids.f1])).id;
  const service = (await one(`select id from public.services limit 1`)).id;
  ids.adm = (await h.as(ids.doc, "aal2", () => q(`select public.admit_inpatient($1,$2,$3,null,$4,'Direct admission','standard','','','',now(),null,'direct admission') as id`, [ids.f1, ids.p, service, ids.bed]))).rows[0].id;
  const med = async name => (await one(`insert into public.medications(name) values($1) returning id`, [name])).id;
  const drugA = await med("Drug A"), drugB = await med("Drug B");
  ids.orderA = (await h.as(ids.doc, "aal2", () => q(`insert into public.medication_orders(patient_id,medication_id,dose,frequency) values($1,$2,'10mg','daily') returning id`, [ids.p, drugA]))).rows[0].id;
  ids.orderB = (await h.as(ids.doc, "aal2", () => q(`insert into public.medication_orders(patient_id,medication_id,dose,frequency) values($1,$2,'5mg','twice daily') returning id`, [ids.p, drugB]))).rows[0].id;
});

test("discharge is blocked until every active medication has a discharge decision", async () => {
  assert.equal((await rows(h.as(ids.doc, "aal2", () => h.q(`select * from public.pending_discharge_reconciliation($1)`, [ids.adm])))).length, 2);
  await assert.rejects(h.as(ids.doc, "aal2", () => h.q(`select public.discharge_inpatient($1)`, [ids.adm])), /Reconcile these medications before discharge: Drug A, Drug B/);
});
test("only prescribers reconcile; stopping or changing a medication needs a note", async () => {
  await assert.rejects(h.as(ids.nurse, "aal2", () => h.q(`select public.reconcile_inpatient_medication($1,'discharge',$2,'continue')`, [ids.adm, ids.orderA])), /Only prescribers or pharmacists/);
  await assert.rejects(h.as(ids.doc, "aal2", () => h.q(`select public.reconcile_inpatient_medication($1,'discharge',$2,'stop')`, [ids.adm, ids.orderB])), /check constraint/);
  await h.as(ids.doc, "aal2", () => h.q(`select public.reconcile_inpatient_medication($1,'discharge',$2,'continue')`, [ids.adm, ids.orderA]));
  await h.as(ids.doc, "aal2", () => h.q(`select public.reconcile_inpatient_medication($1,'discharge',$2,'stop','Course complete')`, [ids.adm, ids.orderB]));
  assert.equal((await h.one(`select status from public.medication_orders where id=$1`, [ids.orderB])).status, "completed", "a stopped medication's order is completed");
  assert.equal((await rows(h.as(ids.doc, "aal2", () => h.q(`select * from public.pending_discharge_reconciliation($1)`, [ids.adm])))).length, 0);
});
test("discharge summary: nurses draft, physicians sign, signing needs the key sections, and a signed summary is final", async () => {
  await h.as(ids.nurse, "aal2", () => h.q(`insert into public.inpatient_discharge_summaries(admission_id,patient_id,facility_id,hospital_course,author_user_id) values($1,$2,$3,'Draft course',$4)`, [ids.adm, ids.p, ids.f1, ids.nurse]));
  await assert.rejects(h.as(ids.nurse, "aal2", () => h.q(`update public.inpatient_discharge_summaries set status='signed' where admission_id=$1`, [ids.adm])), /Only a physician/);
  await assert.rejects(h.as(ids.doc, "aal2", () => h.q(`update public.inpatient_discharge_summaries set status='signed' where admission_id=$1`, [ids.adm])), /required to sign/);
  await h.as(ids.doc, "aal2", () => h.q(`update public.inpatient_discharge_summaries set discharge_diagnosis='Documented diagnosis',discharge_disposition='home',follow_up_instructions='Clinic review',status='signed' where admission_id=$1`, [ids.adm]));
  const summary = await h.one(`select signed_by,signed_at from public.inpatient_discharge_summaries where admission_id=$1`, [ids.adm]);
  assert.equal(summary.signed_by, ids.doc); assert.ok(summary.signed_at);
  await assert.rejects(h.as(ids.doc, "aal2", () => h.q(`update public.inpatient_discharge_summaries set hospital_course='rewritten' where admission_id=$1`, [ids.adm])), /cannot be changed/);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`insert into public.inpatient_discharge_summaries(admission_id,patient_id,facility_id,author_user_id) values($1,$2,$3,$4)`, [ids.adm, ids.p, ids.f1, ids.billing])), /row-level security|duplicate/);
});
test("the patient reads their own signed summary; discharge then succeeds", async () => {
  assert.equal((await rows(h.as(ids.patientUser, "aal1", () => h.q(`select discharge_diagnosis from public.inpatient_discharge_summaries`)))).length, 1);
  await h.as(ids.doc, "aal2", () => h.q(`select public.discharge_inpatient($1)`, [ids.adm]));
  assert.equal((await h.one(`select admission_status from public.inpatient_admissions where id=$1`, [ids.adm])).admission_status, "discharged");
});
