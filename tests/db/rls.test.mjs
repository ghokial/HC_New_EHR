// Behavioural access-rule tests: every migration runs on an in-memory Postgres
// and each check signs in as a specific user. Run with `pnpm test:db`.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";

let h, ids = {};
const rows = async promise => (await promise).rows;

before(async () => {
  const db = await createDatabase();
  h = helpers(db);
  const { user, facility, member, one, q } = h;
  ids.owner = await user("owner@f1.test"); ids.owner2 = await user("owner@f2.test");
  ids.nurse1 = await user("nurse@f1.test"); ids.physician1 = await user("doc@f1.test"); ids.billing1 = await user("billing@f1.test");
  ids.nurse2 = await user("nurse@f2.test"); ids.patientUser = await user("patient@home.test"); ids.pharmacist = await user("rx@pharm.test");
  ids.f1 = await facility("f-one", ids.owner); ids.f2 = await facility("f-two", ids.owner2); ids.pharmacy = await facility("pharm-x", ids.owner2, "Pharmacy");
  await member(ids.f1, ids.nurse1, "nurse"); await member(ids.f1, ids.physician1, "physician"); await member(ids.f1, ids.billing1, "billing");
  await member(ids.f2, ids.nurse2, "nurse"); await member(ids.pharmacy, ids.pharmacist, "pharmacist");
  // create-facility gives each owner a global sysadmin role.
  await q(`insert into public.user_roles(user_id,role_id,scope) values($1,$2,'f-one')`, [ids.owner, await h.role("sysadmin")]);
  ids.p1 = (await one(`insert into public.patients(first_name,last_name,facility_id) values('Test','Patient',$1) returning id`, [ids.f1])).id;
  ids.p2 = (await one(`insert into public.patients(first_name,last_name,facility_id) values('Other','Facility',$1) returning id`, [ids.f2])).id;
  await q(`insert into public.patient_accounts(user_id,patient_id) values($1,$2) on conflict do nothing`, [ids.patientUser, ids.p1]);
  const med = async (name, generic) => (await one(`insert into public.medications(name,generic_name) values($1,$2) returning id`, [name, generic])).id;
  ids.amox = await med("Amoxicillin 500mg", "amoxicillin"); ids.warf = await med("Warfarin 5mg", "warfarin"); ids.asp = await med("Aspirin 81mg", "aspirin");
  // Test-only interaction pair; the migrations deliberately seed none.
  await q(`insert into public.medication_interactions(medication_a_id,medication_b_id,severity,clinical_effect,recommendation) values($1,$2,'major','TEST ONLY effect.','TEST ONLY')`, [ids.warf, ids.asp]);
});

// ---- Phase 1: allergies ------------------------------------------------------
test("allergies: clinical staff at the patient's facility can record them", async () => {
  await h.as(ids.nurse1, "aal2", () => h.q(`insert into public.patient_allergies(patient_id,allergen_type,medication_id,substance,severity,recorded_by) values($1,'medication',$2,'amoxicillin','severe',$3)`, [ids.p1, ids.amox, ids.nurse1]));
});
test("allergies: billing staff and staff without MFA cannot record them", async () => {
  await assert.rejects(h.as(ids.billing1, "aal2", () => h.q(`insert into public.patient_allergies(patient_id,allergen_type,substance,recorded_by) values($1,'food','peanut',$2)`, [ids.p1, ids.billing1])), /row-level security/);
  await assert.rejects(h.as(ids.nurse1, "aal1", () => h.q(`insert into public.patient_allergies(patient_id,allergen_type,substance,recorded_by) values($1,'food','peanut',$2)`, [ids.p1, ids.nurse1])), /row-level security/);
});
test("allergies: other facilities see none; the patient sees their own", async () => {
  assert.equal((await rows(h.as(ids.nurse2, "aal2", () => h.q(`select * from public.patient_allergies where patient_id=$1`, [ids.p1])))).length, 0);
  assert.equal((await rows(h.as(ids.patientUser, "aal1", () => h.q(`select * from public.patient_allergies where patient_id=$1`, [ids.p1])))).length, 1);
});
test("allergies: cannot be moved to another patient or deleted", async () => {
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`update public.patient_allergies set patient_id=$2 where patient_id=$1`, [ids.p1, ids.p2])), /cannot be changed/);
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`delete from public.patient_allergies where patient_id=$1`, [ids.p1])), /permission denied/);
});

// ---- Phase 1: prescribing safety ----------------------------------------------
test("prescribing: a matching allergy blocks the order until a reason is given, and the override is logged", async () => {
  await assert.rejects(h.as(ids.physician1, "aal2", () => h.q(`insert into public.medication_orders(patient_id,medication_id,dose) values($1,$2,'500mg')`, [ids.p1, ids.amox])), /Medication safety alert.*allergy to amoxicillin/);
  await h.as(ids.physician1, "aal2", () => h.q(`insert into public.medication_orders(patient_id,medication_id,dose,safety_override_reason) values($1,$2,'500mg','Tolerated previously')`, [ids.p1, ids.amox]));
  assert.equal((await rows(h.as(ids.physician1, "aal2", () => h.q(`select * from public.medication_safety_overrides where patient_id=$1`, [ids.p1])))).length, 1);
  await assert.rejects(h.as(ids.physician1, "aal2", () => h.q(`delete from public.medication_safety_overrides where patient_id=$1`, [ids.p1])), /permission denied/);
});
test("prescribing: interactions and duplicate orders block without a reason", async () => {
  await h.as(ids.physician1, "aal2", () => h.q(`insert into public.medication_orders(patient_id,medication_id,dose,safety_override_reason) values($1,$2,'5mg','not needed')`, [ids.p1, ids.warf]));
  assert.equal((await h.one(`select safety_override_reason from public.medication_orders where medication_id=$1`, [ids.warf])).safety_override_reason, null);
  await assert.rejects(h.as(ids.physician1, "aal2", () => h.q(`insert into public.medication_orders(patient_id,medication_id,dose) values($1,$2,'81mg')`, [ids.p1, ids.asp])), /Interaction with active order for Warfarin/);
  await assert.rejects(h.as(ids.physician1, "aal2", () => h.q(`insert into public.medication_orders(patient_id,medication_id,dose) values($1,$2,'5mg')`, [ids.p1, ids.warf])), /already exists/);
});
test("prescribing: the safety-check RPC serves the patient's facility only", async () => {
  assert.equal((await rows(h.as(ids.physician1, "aal2", () => h.q(`select * from public.medication_safety_check($1,$2)`, [ids.p1, ids.asp])))).length, 1);
  await assert.rejects(h.as(ids.nurse2, "aal2", () => h.q(`select * from public.medication_safety_check($1,$2)`, [ids.p1, ids.asp])), /Authorized clinical access required/);
  await assert.rejects(h.as(ids.physician1, "aal2", () => h.q(`select * from private.medication_safety_alerts($1,$2,null)`, [ids.p1, ids.asp])), /permission denied/);
});

// ---- Phase 1: eMAR -------------------------------------------------------------
test("eMAR: nurses append doses; entries cannot be edited; corrections must match the order", async () => {
  const order = (await h.one(`select id from public.medication_orders where medication_id=$1`, [ids.warf])).id;
  const other = (await h.one(`select id from public.medication_orders where medication_id=$1`, [ids.amox])).id;
  const given = (await h.as(ids.nurse1, "aal2", () => h.q(`insert into public.medication_administrations(medication_order_id,administered_at,status,dose_given,recorded_by) values($1,now(),'given','5mg',$2) returning id`, [order, ids.nurse1]))).rows[0].id;
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`insert into public.medication_administrations(medication_order_id,administered_at,status,recorded_by) values($1,now(),'held',$2)`, [order, ids.nurse1])), /reason_check/);
  await assert.rejects(h.as(ids.billing1, "aal2", () => h.q(`insert into public.medication_administrations(medication_order_id,administered_at,status,recorded_by) values($1,now(),'given',$2)`, [order, ids.billing1])), /row-level security/);
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`insert into public.medication_administrations(medication_order_id,administered_at,status,recorded_by) values($1,now(),'given',$2)`, [order, ids.physician1])), /row-level security/);
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`update public.medication_administrations set dose_given='50mg' where id=$1`, [given])), /permission denied/);
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`insert into public.medication_administrations(medication_order_id,administered_at,status,reason,corrects_administration_id,recorded_by) values($1,now(),'entered_in_error','x',$2,$3)`, [other, given, ids.nurse1])), /same medication order/);
  await h.as(ids.nurse1, "aal2", () => h.q(`insert into public.medication_administrations(medication_order_id,administered_at,status,reason,corrects_administration_id,recorded_by) values($1,now(),'entered_in_error','wrong patient',$2,$3)`, [order, given, ids.nurse1]));
  assert.equal((await rows(h.as(ids.nurse2, "aal2", () => h.q(`select * from public.medication_administrations where medication_order_id=$1`, [order])))).length, 0);
});

// ---- Phase 1: immunizations ----------------------------------------------------
test("immunizations: permanent records, visible to the patient, hidden from staff without MFA", async () => {
  await h.as(ids.nurse1, "aal2", () => h.q(`insert into public.immunizations(patient_id,facility_id,vaccine_name,dose_number,administered_at,recorded_by) values($1,$2,'TEST vaccine',1,now(),$3)`, [ids.p1, ids.f1, ids.nurse1]));
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`update public.immunizations set vaccine_name='changed' where patient_id=$1`, [ids.p1])), /permanent/);
  await h.as(ids.nurse1, "aal2", () => h.q(`update public.immunizations set status='entered_in_error' where patient_id=$1`, [ids.p1]));
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`insert into public.immunizations(patient_id,facility_id,vaccine_name,administered_at,recorded_by) values($1,$2,'TEST vaccine',now(),$3)`, [ids.p1, ids.f2, ids.nurse1])), /row-level security/);
  assert.equal((await rows(h.as(ids.patientUser, "aal1", () => h.q(`select * from public.immunizations where patient_id=$1`, [ids.p1])))).length, 1);
  assert.equal((await rows(h.as(ids.nurse1, "aal1", () => h.q(`select * from public.immunizations where patient_id=$1`, [ids.p1])))).length, 0);
});

// ---- Security review fixes ------------------------------------------------------
test("S1: a facility owner (sysadmin) cannot grant themselves Root or read other facilities", async () => {
  await assert.rejects(h.as(ids.owner, "aal2", async () => h.q(`insert into public.user_roles(user_id,role_id,scope) values($1,$2,'global')`, [ids.owner, await h.role("root")])), /row-level security/);
  assert.equal((await rows(h.as(ids.owner, "aal2", () => h.q(`select id from public.patients where id=$1`, [ids.p2])))).length, 0);
  assert.equal((await rows(h.as(ids.owner, "aal2", () => h.q(`select * from public.user_roles where user_id=$1`, [ids.owner])))).length, 1, "users still read their own roles");
});
test("S2: a pharmacy cannot self-refer another facility's prescription to read it", async () => {
  const order = (await h.one(`select id from public.medication_orders where medication_id=$1`, [ids.warf])).id;
  await assert.rejects(h.as(ids.pharmacist, "aal2", () => h.q(`insert into public.clinical_service_referrals(patient_id,source_facility_id,target_facility_id,service_type,medication_order_id,sent_by) values($1,$2,$2,'pharmacy',$3,$4)`, [ids.p1, ids.pharmacy, order, ids.pharmacist])), /row-level security/);
  assert.equal((await rows(h.as(ids.pharmacist, "aal2", () => h.q(`select id from public.medication_orders where id=$1`, [order])))).length, 0);
});
test("S2: the holding facility can still refer its own patient's order to a pharmacy, which may progress but not re-point it", async () => {
  const order = (await h.one(`select id from public.medication_orders where medication_id=$1`, [ids.warf])).id;
  const other = (await h.one(`select id from public.medication_orders where medication_id=$1`, [ids.amox])).id;
  const referral = (await h.as(ids.physician1, "aal2", () => h.q(`insert into public.clinical_service_referrals(patient_id,source_facility_id,target_facility_id,service_type,medication_order_id,sent_by) values($1,$2,$3,'pharmacy',$4,$5) returning id`, [ids.p1, ids.f1, ids.pharmacy, order, ids.physician1]))).rows[0].id;
  assert.equal((await rows(h.as(ids.pharmacist, "aal2", () => h.q(`select id from public.medication_orders where id=$1`, [order])))).length, 1);
  await h.as(ids.pharmacist, "aal2", () => h.q(`update public.clinical_service_referrals set status='received',received_at=now() where id=$1`, [referral]));
  await assert.rejects(h.as(ids.pharmacist, "aal2", () => h.q(`update public.clinical_service_referrals set medication_order_id=$2 where id=$1`, [referral, other])), /Only the referral status/);
  await assert.rejects(h.as(ids.physician1, "aal2", () => h.q(`insert into public.clinical_service_referrals(patient_id,source_facility_id,target_facility_id,service_type,medication_order_id,sent_by) values($1,$2,$3,'pharmacy',$4,$5)`, [ids.p2, ids.f1, ids.pharmacy, order, ids.physician1])), /row-level security/, "order must belong to the referred patient");
});
test("S3 and messaging: only owners add participants, and participants can read messages", async () => {
  const thread = (await h.as(ids.physician1, "aal2", () => h.q(`insert into public.message_threads(subject,thread_type,created_by) values('private','direct',$1) returning id`, [ids.physician1]))).rows[0].id;
  await h.as(ids.physician1, "aal2", () => h.q(`insert into public.message_participants(thread_id,user_id) values($1,$2)`, [thread, ids.nurse1]));
  await h.as(ids.physician1, "aal2", () => h.q(`insert into public.messages(thread_id,sender_user_id,body) values($1,$2,'confidential')`, [thread, ids.physician1]));
  assert.equal((await rows(h.as(ids.physician1, "aal2", () => h.q(`select body from public.messages where thread_id=$1`, [thread])))).length, 1);
  assert.equal((await rows(h.as(ids.nurse1, "aal2", () => h.q(`select body from public.messages where thread_id=$1`, [thread])))).length, 1);
  await assert.rejects(h.as(ids.nurse2, "aal2", () => h.q(`insert into public.message_participants(thread_id,user_id) values($1,$2)`, [thread, ids.nurse2])), /row-level security/);
  assert.equal((await rows(h.as(ids.nurse2, "aal2", () => h.q(`select body from public.messages where thread_id=$1`, [thread])))).length, 0);
});
test("communities: listing no longer fails with a permission error", async () => {
  await h.as(ids.physician1, "aal2", () => h.q(`select title from public.communities`));
});

// ---- Clinical notes (review B2) -------------------------------------------------
test("notes: clinical members get provider records and can write notes for their facility's patients", async () => {
  const provider = await h.one(`select id,provider_type from public.providers where user_id=$1`, [ids.nurse1]);
  assert.equal(provider.provider_type, "nurse");
  assert.equal(await h.one(`select id from public.providers where user_id=$1`, [ids.billing1]), undefined, "billing staff are not providers");
  await h.as(ids.nurse1, "aal2", () => h.q(`insert into public.clinical_notes(patient_id,author_provider_id,note_type,content,status) values($1,$2,'Nursing note','Draft text','draft')`, [ids.p1, provider.id]));
  const nurse2Provider = (await h.one(`select id from public.providers where user_id=$1`, [ids.nurse2])).id;
  await assert.rejects(h.as(ids.nurse2, "aal2", () => h.q(`insert into public.clinical_notes(patient_id,author_provider_id,note_type,content) values($1,$2,'Nursing note','x')`, [ids.p1, nurse2Provider])), /row-level security/, "other facility");
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`insert into public.clinical_notes(patient_id,author_provider_id,note_type,content) values($1,$2,'Nursing note','x')`, [ids.p1, nurse2Provider])), /row-level security/, "cannot author as someone else");
});
test("notes: drafts can be edited and signed; signed notes are final", async () => {
  const note = (await h.one(`select id from public.clinical_notes where content='Draft text'`)).id;
  await h.as(ids.nurse1, "aal2", () => h.q(`update public.clinical_notes set content='Final text',status='signed' where id=$1`, [note]));
  assert.ok((await h.one(`select signed_at from public.clinical_notes where id=$1`, [note])).signed_at, "signed_at is set");
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`update public.clinical_notes set content='rewritten' where id=$1`, [note])), /Signed notes cannot be changed/);
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`delete from public.clinical_notes where id=$1`, [note])), /permission denied/);
});

// ---- Order sets and note templates --------------------------------------------------
test("order sets and note templates: facility admins author them, their staff use them, other facilities cannot see them", async () => {
  await h.q(`insert into public.facility_memberships(facility_id,user_id,role_id,is_owner) values($1,$2,$3,true) on conflict do nothing`, [ids.f1, ids.owner, await h.role("sysadmin")]);
  await h.as(ids.owner, "aal2", () => h.q(`insert into public.note_templates(facility_id,name,note_type,body) values($1,'Test template','Progress note','Heading')`, [ids.f1]));
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`insert into public.note_templates(facility_id,name,note_type,body) values($1,'Nurse template','Nursing note','x')`, [ids.f1])), /row-level security/);
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`insert into public.note_templates(facility_id,name,note_type,body) values(null,'Platform template','Progress note','x')`)), /row-level security/, "only Root authors platform-wide content");
  assert.equal((await rows(h.as(ids.nurse1, "aal2", () => h.q(`select * from public.note_templates`)))).length, 1);
  assert.equal((await rows(h.as(ids.nurse2, "aal2", () => h.q(`select * from public.note_templates`)))).length, 0);
  const set = (await h.as(ids.owner, "aal2", () => h.q(`insert into public.order_sets(facility_id,name) values($1,'Test set') returning id`, [ids.f1]))).rows[0].id;
  const catalog = (await h.one(`select id from public.clinical_order_catalog order by id limit 1`)).id;
  await h.as(ids.owner, "aal2", () => h.q(`insert into public.order_set_items(order_set_id,catalog_id) values($1,$2)`, [set, catalog]));
  await assert.rejects(h.as(ids.nurse1, "aal2", () => h.q(`insert into public.order_set_items(order_set_id,catalog_id,priority) values($1,$2,'STAT') on conflict do nothing`, [set, catalog + 1])), /row-level security/);
  assert.equal((await rows(h.as(ids.nurse1, "aal2", () => h.q(`select * from public.order_set_items where order_set_id=$1`, [set])))).length, 1);
  assert.equal((await rows(h.as(ids.nurse2, "aal2", () => h.q(`select * from public.order_set_items where order_set_id=$1`, [set])))).length, 0);
});

// ---- Security review S5-S8 and audit log ------------------------------------------
test("S5: encounter documentation, referrals and contact details need MFA for staff", async () => {
  const encounter = (await h.as(ids.physician1, "aal2", () => h.q(`insert into public.encounters(patient_id,encounter_type,start_at,triage_skipped,triage_skip_reason,triage_skipped_by) values($1,'Outpatient',now(),true,'test',$2) returning id`, [ids.p1, ids.physician1]))).rows[0].id;
  await h.as(ids.physician1, "aal2", () => h.q(`insert into public.encounter_clinical_workflows(encounter_id,patient_id,subjective,updated_by) values($1,$2,'private history',$3)`, [encounter, ids.p1, ids.physician1]));
  await h.as(ids.physician1, "aal2", () => h.q(`insert into public.patient_contact_methods(patient_id,contact_type,contact_value) values($1,'phone','+243000000000')`, [ids.p1]));
  assert.equal((await rows(h.as(ids.physician1, "aal2", () => h.q(`select * from public.encounter_clinical_workflows where patient_id=$1`, [ids.p1])))).length, 1);
  for (const table of ["encounter_clinical_workflows", "clinical_service_referrals", "patient_contact_methods"])
    assert.equal((await rows(h.as(ids.physician1, "aal1", () => h.q(`select * from public.${table} where patient_id=$1`, [ids.p1])))).length, 0, `${table} without MFA`);
  assert.equal((await rows(h.as(ids.patientUser, "aal1", () => h.q(`select * from public.patient_contact_methods where patient_id=$1`, [ids.p1])))).length, 1, "patient still sees own contacts");
});
test("S5: patients see bookable slots without MFA", async () => {
  await h.q(`insert into public.provider_availability_slots(facility_id,department_id,starts_at,ends_at) values($1,(select id from public.departments limit 1),now()+interval '1 day',now()+interval '1 day 30 minutes')`, [ids.f1]);
  assert.equal((await rows(h.as(ids.patientUser, "aal1", () => h.q(`select * from public.provider_availability_slots where status='available'`)))).length, 1);
});
test("S6: an account that must still replace its temporary password gets no staff access, even with MFA", async () => {
  await h.q(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: ids.nurse1, aal: "aal2", app_metadata: { must_change_password: true } })]);
  await h.q(`set role authenticated`);
  try { assert.equal((await h.q(`select * from public.patient_allergies where patient_id=$1`, [ids.p1])).rows.length, 0); }
  finally { await h.q(`reset role`); }
  assert.ok((await rows(h.as(ids.nurse1, "aal2", () => h.q(`select * from public.patient_allergies where patient_id=$1`, [ids.p1])))).length > 0, "same user after the change");
});
test("S7: a staff member's own health file is not visible to their colleagues", async () => {
  const own = (await h.one(`select pa.patient_id,p.facility_id from public.patient_accounts pa join public.patients p on p.id=pa.patient_id where pa.user_id=$1`, [ids.physician1]));
  assert.equal(own.facility_id, null);
  assert.equal((await rows(h.as(ids.nurse1, "aal2", () => h.q(`select id from public.patients where id=$1`, [own.patient_id])))).length, 0);
  assert.equal((await rows(h.as(ids.physician1, "aal1", () => h.q(`select id from public.patients where id=$1`, [own.patient_id])))).length, 1, "the person still sees their own file");
});
test("S8: facility admins cannot edit the shared catalogs or read strangers' profiles", async () => {
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`insert into public.departments(code,name) values('x_test','X')`)), /row-level security/);
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`insert into public.services(department_id,name) values((select id from public.departments limit 1),'X')`)), /row-level security/);
  assert.equal((await rows(h.as(ids.owner, "aal2", () => h.q(`delete from public.departments returning id`)))).length, 0);
  assert.equal((await rows(h.as(ids.owner, "aal2", () => h.q(`select * from public.profiles where user_id=$1`, [ids.nurse2])))).length, 0, "other facility's staff");
  assert.equal((await rows(h.as(ids.nurse1, "aal2", () => h.q(`select * from public.profiles where user_id=$1`, [ids.physician1])))).length, 1, "colleague at the same facility");
  assert.equal((await rows(h.as(ids.owner, "aal2", () => h.q(`update public.profiles set display_name='x' where user_id=$1 returning user_id`, [ids.nurse1])))).length, 0);
});
test("S8: addresses are readable only through a patient you may read", async () => {
  const address = (await h.as(ids.nurse1, "aal2", () => h.q(`insert into public.addresses(line1,country_id,created_by) values('1 Test St',(select id from public.countries limit 1),$1) returning id`, [ids.nurse1]))).rows[0].id;
  await h.q(`update public.patients set primary_address_id=$1 where id=$2`, [address, ids.p1]);
  assert.equal((await rows(h.as(ids.physician1, "aal2", () => h.q(`select * from public.addresses where id=$1`, [address])))).length, 1);
  assert.equal((await rows(h.as(ids.nurse2, "aal2", () => h.q(`select * from public.addresses where id=$1`, [address])))).length, 0);
  await assert.rejects(h.as(ids.billing1, "aal2", () => h.q(`insert into public.addresses(line1,country_id,created_by) values('x',(select id from public.countries limit 1),$1)`, [ids.billing1])), /row-level security/);
});
test("audit log: changes and chart views are recorded, readable by oversight roles only, and cannot be altered", async () => {
  const before = Number((await h.one(`select count(*) from public.audit_logs where patient_id=$1`, [ids.p1])).count);
  assert.ok(before > 0, "earlier clinical writes were logged");
  const insertRow = await h.one(`select actor_user_id,facility_id from public.audit_logs where table_name='patient_allergies' and action_type='INSERT' and patient_id=$1`, [ids.p1]);
  assert.equal(insertRow.actor_user_id, ids.nurse1); assert.equal(insertRow.facility_id, ids.f1);
  const update = await h.one(`select details from public.audit_logs where table_name='clinical_notes' and action_type='UPDATE' order by id desc limit 1`);
  assert.deepEqual(update.details.changed_fields.includes("content"), true);
  assert.ok(!JSON.stringify(update.details).includes("Final text"), "values are not copied into the log");
  await h.as(ids.nurse1, "aal2", () => h.q(`select public.log_patient_record_view($1,'chart')`, [ids.p1]));
  assert.equal((await h.one(`select count(*) from public.audit_logs where action_type='VIEW' and patient_id=$1 and actor_user_id=$2`, [ids.p1, ids.nurse1])).count, 1);
  await assert.rejects(h.as(ids.nurse2, "aal2", () => h.q(`select public.log_patient_record_view($1,'chart')`, [ids.p1])), /not authorized/);
  assert.equal((await rows(h.as(ids.nurse1, "aal2", () => h.q(`select * from public.audit_logs`)))).length, 0, "clinical staff cannot browse the log");
  assert.ok((await rows(h.as(ids.owner, "aal2", () => h.q(`select * from public.audit_logs where facility_id=$1`, [ids.f1])))).length > 0, "facility owner can");
  assert.equal((await rows(h.as(ids.owner, "aal2", () => h.q(`select * from public.audit_logs where facility_id=$1`, [ids.f2])))).length, 0, "but not another facility's");
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`delete from public.audit_logs`)), /permission denied/);
  await assert.rejects(h.q(`update public.audit_logs set action_type='x'`), /append-only/, "even the database owner cannot edit it");
});
