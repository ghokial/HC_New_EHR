// Phase 2: admission-discharge-transfer, bed management, and inpatient billing.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";

let h, ids = {};
const rows = async promise => (await promise).rows;
const admit = (userId, params) => h.as(userId, "aal2", () => h.q(
  `select public.admit_inpatient($1,$2,$3,null,$4,$5,$6,$7,'','',now(),null,$8,$9) as id`,
  [ids.f1, params.patient, ids.service, params.bed, params.source || "Emergency department", params.acuity || "standard", params.isolation || "", params.bypass || null, params.override || null]));

before(async () => {
  h = helpers(await createDatabase());
  const { user, facility, member, one, q } = h;
  ids.owner = await user("owner@f1.test"); ids.owner2 = await user("owner@f2.test");
  ids.nurse = await user("nurse@f1.test"); ids.doc = await user("doc@f1.test"); ids.billing = await user("billing@f1.test"); ids.nurse2 = await user("nurse@f2.test");
  ids.f1 = await facility("f-one", ids.owner); ids.f2 = await facility("f-two", ids.owner2);
  await member(ids.f1, ids.nurse, "nurse"); await member(ids.f1, ids.doc, "physician"); await member(ids.f1, ids.billing, "billing"); await member(ids.f2, ids.nurse2, "nurse");
  ids.service = (await one(`select id from public.services limit 1`)).id;
  const patient = async name => (await one(`insert into public.patients(first_name,last_name,facility_id) values($1,'Test',$2) returning id`, [name, ids.f1])).id;
  ids.p1 = await patient("One"); ids.p2 = await patient("Two"); ids.p3 = await patient("Three");
  const bed = async (label, extra = {}) => (await one(`insert into public.inpatient_beds(facility_id,ward,room,bed_label,bed_type,telemetry,negative_pressure,isolation_capable) values($1,'W','1',$2,$3,$4,$5,$6) returning id`,
    [ids.f1, label, extra.type || "standard", !!extra.telemetry, !!extra.negative, !!extra.isolation])).id;
  ids.bedA = await bed("A"); ids.bedB = await bed("B"); ids.bedTele = await bed("T", { type: "telemetry", telemetry: true }); ids.bedNeg = await bed("N", { negative: true, isolation: true });
  // Facility-configured room price in the chargemaster (test value, not a real rate).
  await q(`update public.facilities set currency='USD' where id=$1`, [ids.f1]);
  ids.roomItem = (await one(`insert into public.facility_chargemaster_items(facility_id,revenue_code,charge_code,charge_description,item_type,unit_of_service,unit_price,currency,created_by) values($1,'0110','1001','Private room','Accommodation','day',100,'USD',$2) returning id`, [ids.f1, ids.owner])).id;
  await q(`update public.inpatient_beds set accommodation_charge_item_id=$1 where facility_id=$2`, [ids.roomItem, ids.f1]);
});

test("direct admission without triage needs a documented reason", async () => {
  await assert.rejects(admit(ids.doc, { patient: ids.p1, bed: ids.bedA, source: "Direct admission" }), /complete triage/);
  ids.adm1 = (await admit(ids.doc, { patient: ids.p1, bed: ids.bedA, source: "Direct admission", bypass: "Regional transfer, triaged at referring hospital" })).rows[0].id;
  assert.equal((await h.one(`select operational_status from public.inpatient_beds where id=$1`, [ids.bedA])).operational_status, "occupied");
  await assert.rejects(admit(ids.doc, { patient: ids.p1, bed: ids.bedB, bypass: "again" }), /already has an active admission/);
});
test("bed placement must match telemetry and isolation needs, unless overridden with a reason", async () => {
  await assert.rejects(admit(ids.doc, { patient: ids.p2, bed: ids.bedB, acuity: "telemetry", bypass: "direct" }), /telemetry monitoring/);
  await assert.rejects(admit(ids.doc, { patient: ids.p2, bed: ids.bedTele, isolation: "airborne", bypass: "direct" }), /negative-pressure/);
  ids.adm2 = (await admit(ids.doc, { patient: ids.p2, bed: ids.bedB, acuity: "telemetry", bypass: "direct", override: "No telemetry bed free; portable monitor in use" })).rows[0].id;
  assert.match((await h.one(`select placement_override_reason from public.inpatient_admissions where id=$1`, [ids.adm2])).placement_override_reason, /portable monitor/);
});
test("billing staff cannot admit, edit admissions, or block beds", async () => {
  await assert.rejects(admit(ids.billing, { patient: ids.p3, bed: ids.bedTele, bypass: "x" }), /Only clinical/);
  assert.equal((await rows(h.as(ids.billing, "aal2", () => h.q(`update public.inpatient_admissions set diagnosis_display='x' returning id`)))).length, 0);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`update public.inpatient_beds set operational_status='blocked' where id=$1`, [ids.bedTele])), /Only clinical or administrative staff/);
});
test("an occupied bed cannot be marked free, and a free bed cannot be marked occupied by hand", async () => {
  await assert.rejects(h.as(ids.nurse, "aal2", () => h.q(`update public.inpatient_beds set operational_status='available' where id=$1`, [ids.bedA])), /discharge or transfer the patient first/);
  await assert.rejects(h.as(ids.nurse, "aal2", () => h.q(`update public.inpatient_beds set operational_status='occupied' where id=$1`, [ids.bedTele])), /only through an admission or transfer/);
});
test("transfer moves the patient, sends the old bed to cleaning, and checks placement", async () => {
  await assert.rejects(h.as(ids.nurse, "aal2", () => h.q(`select public.transfer_inpatient_bed($1,$2,'')`, [ids.adm2, ids.bedTele])), /transfer reason is required/);
  await h.as(ids.nurse, "aal2", () => h.q(`select public.transfer_inpatient_bed($1,$2,'Telemetry bed now free')`, [ids.adm2, ids.bedTele]));
  const beds = Object.fromEntries((await h.q(`select id,operational_status from public.inpatient_beds where id in ($1,$2)`, [ids.bedB, ids.bedTele])).rows.map(r => [r.id, r.operational_status]));
  assert.equal(beds[ids.bedB], "needs_cleaning"); assert.equal(beds[ids.bedTele], "occupied");
});
test("cleaning turnaround is recorded from needs-cleaning to available", async () => {
  await h.as(ids.billing, "aal2", () => h.q(`update public.inpatient_beds set operational_status='cleaning' where id=$1`, [ids.bedB]));
  await h.as(ids.billing, "aal2", () => h.q(`update public.inpatient_beds set operational_status='available' where id=$1`, [ids.bedB]));
  const turn = (await rows(h.as(ids.nurse, "aal2", () => h.q(`select * from public.inpatient_bed_turnaround where bed_id=$1`, [ids.bedB]))))[0];
  assert.ok(turn.cleaning_started_at && turn.available_at, "both milestones recorded");
});
test("charges use chargemaster prices, cannot be edited, and corrections need a reason", async () => {
  const acct = (await h.one(`select id,(select encounter_id from public.inpatient_admissions where id=$1) as enc from public.inpatient_accounts where admission_id=$1`, [ids.adm1]));
  ids.acct1 = acct.id;
  const charge = (await h.as(ids.nurse, "aal2", () => h.q(`insert into public.inpatient_charge_items(facility_id,account_id,encounter_id,code_system,code,description,unit_price,created_by,chargemaster_item_id) values($1,$2,$3,'x','x','x',999999,$4,$5) returning id,unit_price,code`, [ids.f1, acct.id, acct.enc, ids.nurse, ids.roomItem]))).rows[0];
  assert.equal(Number(charge.unit_price), 100, "price comes from the chargemaster, not the form"); assert.equal(charge.code, "0110");
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`update public.inpatient_charge_items set unit_price=1 where id=$1`, [charge.id])), /cannot be edited/);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`update public.inpatient_charge_items set status='entered_in_error' where id=$1`, [charge.id])), /reason is required/);
  await h.as(ids.billing, "aal2", () => h.q(`update public.inpatient_charge_items set status='entered_in_error',correction_reason='duplicate entry' where id=$1`, [charge.id]));
  assert.equal((await rows(h.as(ids.nurse2, "aal2", () => h.q(`select * from public.inpatient_charge_items`)))).length, 0, "other facility sees none");
});
test("discharge happens once, posts daily room charges from the chargemaster, and readies the account", async () => {
  await h.q(`update public.inpatient_bed_assignments set occupied_at=now()-interval '3 days' where admission_id=$1`, [ids.adm1]);
  await h.as(ids.doc, "aal2", () => h.q(`select public.discharge_inpatient($1)`, [ids.adm1]));
  await assert.rejects(h.as(ids.doc, "aal2", () => h.q(`select public.discharge_inpatient($1)`, [ids.adm1])), /already discharged/);
  const room = await h.q(`select count(*)::int as n, sum(total_amount) as total from public.inpatient_charge_items where account_id=$1 and bed_assignment_id is not null and status='billable'`, [ids.acct1]);
  assert.equal(room.rows[0].n, 3, "three midnights, three room days"); assert.equal(Number(room.rows[0].total), 300);
  const again = (await h.as(ids.billing, "aal2", () => h.q(`select public.post_inpatient_room_charges($1) as r`, [ids.acct1]))).rows[0].r;
  assert.equal(again.posted, 0, "room days are never charged twice");
  assert.equal((await h.one(`select status from public.inpatient_accounts where id=$1`, [ids.acct1])).status, "ready_to_claim");
  assert.equal((await h.one(`select operational_status from public.inpatient_beds where id=$1`, [ids.bedA])).operational_status, "needs_cleaning");
});
test("claims are prepared in one step by billing staff, lock the charges, and record the payer's decision", async () => {
  await assert.rejects(h.as(ids.nurse, "aal2", () => h.q(`select public.create_inpatient_claim($1)`, [ids.acct1])), /not authorized/);
  const claim = (await h.as(ids.billing, "aal2", () => h.q(`select public.create_inpatient_claim($1) as id`, [ids.acct1]))).rows[0].id;
  assert.equal(Number((await h.one(`select submitted_amount from public.inpatient_claims where id=$1`, [claim])).submitted_amount), 300);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`select public.create_inpatient_claim($1)`, [ids.acct1])), /ready to claim/);
  const enc = (await h.one(`select encounter_id from public.inpatient_admissions where id=$1`, [ids.adm1])).encounter_id;
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`insert into public.inpatient_charge_items(facility_id,account_id,encounter_id,code_system,code,description,unit_price,created_by) values($1,$2,$3,'Local','1','late',5,$4)`, [ids.f1, ids.acct1, enc, ids.billing])), /charges are locked/);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`select public.record_inpatient_claim_adjudication($1,'denied',0,0)`, [claim])), /CARC/);
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`select public.record_inpatient_claim_adjudication($1,'paid',300,50)`, [claim])), /cannot exceed/);
  await h.as(ids.billing, "aal2", () => h.q(`select public.record_inpatient_claim_adjudication($1,'partially_paid',240,60,'ERA-1','45',null,'Contractual adjustment')`, [claim]));
  const c = await h.one(`select status,benefit_amount,patient_responsibility from public.inpatient_claims where id=$1`, [claim]);
  assert.equal(c.status, "partially_paid"); assert.equal(Number(c.benefit_amount), 240); assert.equal(Number(c.patient_responsibility), 60);
  assert.equal((await rows(h.as(ids.nurse, "aal2", () => h.q(`select * from public.inpatient_claims`)))).length, 0, "clinical staff do not see claims");
});
test("inpatient changes are written to the audit log", async () => {
  const n = (await h.one(`select count(*)::int as n from public.audit_logs where table_name in ('inpatient_admissions','inpatient_charge_items','inpatient_claims')`)).n;
  assert.ok(n > 0);
});
