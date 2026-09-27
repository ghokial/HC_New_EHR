// HL7 v2 lab interface: registration, safe ingestion, and release rules.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";
import { parseOru } from "../../supabase/functions/_shared/hl7v2.js";

let h, ids = {};
const oru = (control, orderId, pid) => parseOru([
  `MSH|^~\\&|LABSYS|LAB|HEALTHCAROLOGY|F|20260927101500||ORU^R01|${control}|P|2.5.1`,
  `PID|1||${pid}^^^HEALTHCAROLOGY^UNIN||TEST^PATIENT`,
  `OBR|1|${orderId}||HC-LAB-GLU^Glucose`,
  `OBX|1|NM|GLU^Glucose||9.1|mmol/L|3.9-5.5|H|||F`,
].join("\r"));
const ingest = async (payload, iface = ids.iface) => {
  await h.q(`reset role`); await h.q(`set role service_role`);
  try { return (await h.q(`select public.hl7_ingest_lab_results($1,$2::jsonb,'raw') as r`, [iface, JSON.stringify(payload)])).rows[0].r; }
  finally { await h.q(`reset role`); }
};

before(async () => {
  h = helpers(await createDatabase());
  ids.owner = await h.user("o@f1.test"); ids.owner2 = await h.user("o@f2.test"); ids.doc = await h.user("d@f1.test"); ids.tech = await h.user("t@f1.test"); ids.sup = await h.user("s@f1.test"); ids.billing = await h.user("b@f1.test");
  ids.f1 = await h.facility("f-one", ids.owner); ids.f2 = await h.facility("f-two", ids.owner2);
  await h.member(ids.f1, ids.doc, "physician"); await h.member(ids.f1, ids.tech, "lab_tech"); await h.member(ids.f1, ids.sup, "lab_supervisor"); await h.member(ids.f1, ids.billing, "billing");
  await h.q(`insert into public.facility_memberships(facility_id,user_id,role_id,is_owner) values($1,$2,(select id from public.roles where role_code='sysadmin'),true) on conflict do nothing`, [ids.f2, ids.owner2]);
  const patient = async (facility, last) => h.one(`insert into public.patients(first_name,last_name,facility_id,birth_country_id,unin_province_code,unin_commune_code,sex,date_of_birth) values('T',$2,$1,(select id from public.countries where iso2='CD'),'10','L','F','1990-02-01') returning id,snau`, [facility, last]);
  ids.p = await patient(ids.f1, "One"); ids.other = await patient(ids.f1, "Two"); ids.p2 = await patient(ids.f2, "Far");
  const order = async p => { const o = (await h.one(`insert into public.orders(patient_id,order_type,status) values($1,'lab','pending') returning id`, [p.id])).id; return (await h.one(`insert into public.lab_orders(order_id,test_code) values($1,'HC-LAB-GLU') returning id`, [o])).id; };
  ids.lab = await order(ids.p); ids.lab2 = await order(ids.p2);
});

test("lab supervisors register an interface and get its key once; others cannot, and nobody can read the hash", async () => {
  await assert.rejects(h.as(ids.billing, "aal2", () => h.q(`select public.create_lab_interface($1,'Analyzer')`, [ids.f1])), /Only facility administrators or laboratory supervisors/);
  const r = (await h.as(ids.sup, "aal2", () => h.q(`select public.create_lab_interface($1,'Analyzer') as r`, [ids.f1]))).rows[0].r;
  ids.iface = r.interface_id; assert.match(r.secret_key, /^hcl_[0-9a-f]{64}$/);
  await assert.rejects(h.as(ids.sup, "aal2", () => h.q(`select key_hash from public.lab_interfaces`)), /permission denied/);
  assert.equal((await h.as(ids.sup, "aal2", () => h.q(`select name from public.lab_interfaces`))).rows.length, 1);
  await assert.rejects(h.as(ids.sup, "aal2", () => h.q(`select public.hl7_ingest_lab_results($1,'{}'::jsonb,'x')`, [ids.iface])), /permission denied/, "only the Edge Function (service role) can ingest");
});

test("results matched to the order and patient are stored for supervisor validation, not released", async () => {
  assert.ok(ids.p.snau, "test patient has a UNIN");
  const r = await ingest(oru("M1", ids.lab, ids.p.snau));
  assert.equal(r.ack, "AA"); assert.equal(r.results_created, 1);
  const row = await h.one(`select validation_status,numeric_value,interpretation,units from public.lab_results where lab_order_id=$1`, [ids.lab]);
  assert.deepEqual([row.validation_status, Number(row.numeric_value), row.interpretation, row.units], ["pending_validation", 9.1, "out_of_range", "mmol/L"]);
  assert.equal((await h.as(ids.doc, "aal2", () => h.q(`select * from public.lab_results where lab_order_id=$1`, [ids.lab]))).rows.length, 0, "the doctor cannot see it before validation");
  assert.equal((await h.one(`select status from public.orders o join public.lab_orders lo on lo.order_id=o.id where lo.id=$1`, [ids.lab])).status, "in_progress");
});

test("a resent message is acknowledged without duplicating results", async () => {
  const r = await ingest(oru("M1", ids.lab, ids.p.snau));
  assert.equal(r.ack, "AA"); assert.equal(r.duplicate, true);
  assert.equal((await h.one(`select count(*)::int as n from public.lab_results where lab_order_id=$1`, [ids.lab])).n, 1);
});

test("wrong patient, another facility's order, or an unknown order are rejected and logged", async () => {
  const wrong = await ingest(oru("M2", ids.lab, ids.other.snau));
  assert.equal(wrong.ack, "AE"); assert.match(wrong.error, /do not match the patient/);
  const foreign = await ingest(oru("M3", ids.lab2, ids.p2.snau));
  assert.equal(foreign.ack, "AE"); assert.match(foreign.error, /does not belong to this facility/);
  const missing = await ingest(oru("M4", 999999, ids.p.snau));
  assert.equal(missing.ack, "AE"); assert.match(missing.error, /not found/);
  assert.equal((await h.one(`select count(*)::int as n from public.lab_results where lab_order_id=$1`, [ids.lab])).n, 1, "nothing was stored");
  const log = (await h.as(ids.sup, "aal2", () => h.q(`select control_id,status from public.hl7_messages order by id`))).rows;
  assert.deepEqual(log.map(x => `${x.control_id}:${x.status}`), ["M1:accepted", "M2:rejected", "M3:rejected", "M4:rejected"]);
  assert.equal((await h.as(ids.owner2, "aal2", () => h.q(`select * from public.hl7_messages`))).rows.length, 0, "other facilities cannot read the message log");
});

test("an inactive interface is refused", async () => {
  await h.as(ids.sup, "aal2", () => h.q(`update public.lab_interfaces set active=false where id=$1`, [ids.iface]));
  const r = await ingest(oru("M5", ids.lab, ids.p.snau));
  assert.equal(r.ack, "AR");
});
