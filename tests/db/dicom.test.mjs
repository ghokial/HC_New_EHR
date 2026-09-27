// Imaging orders linked to PACS studies over DICOMweb.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";

let h, ids = {};
const link = (userId, uid, patientId, accession) => h.as(userId, "aal2", () => h.q(`select public.link_imaging_study($1,$2,$3,$4)`, [ids.io, uid, patientId, accession]));

before(async () => {
  h = helpers(await createDatabase());
  ids.owner = await h.user("o@f1.test"); ids.rad = await h.user("r@f1.test"); ids.billing = await h.user("b@f1.test"); ids.owner2 = await h.user("o@f2.test"); ids.rad2 = await h.user("r@f2.test");
  ids.f1 = await h.facility("f-one", ids.owner); ids.f2 = await h.facility("f-two", ids.owner2);
  await h.member(ids.f1, ids.rad, "rad_tech"); await h.member(ids.f1, ids.billing, "billing"); await h.member(ids.f2, ids.rad2, "rad_tech");
  await h.q(`insert into public.facility_memberships(facility_id,user_id,role_id,is_owner) values($1,$2,(select id from public.roles where role_code='sysadmin'),true) on conflict do nothing`, [ids.f1, ids.owner]);
  ids.p = await h.one(`insert into public.patients(first_name,last_name,facility_id,birth_country_id,unin_province_code,unin_commune_code,sex,date_of_birth) values('I','Mage',$1,(select id from public.countries where iso2='CD'),'10','L','M','1980-01-01') returning id,snau`, [ids.f1]);
  await h.q(`insert into public.facility_patient_mrns(facility_id,patient_id,mrn) values($1,$2,'MRN-5')`, [ids.f1, ids.p.id]);
  const order = (await h.one(`insert into public.orders(patient_id,order_type,status) values($1,'imaging','pending') returning id`, [ids.p.id])).id;
  const io = await h.one(`insert into public.imaging_orders(order_id,modality) values($1,'CT') returning id,accession_number`, [order]);
  ids.io = io.id; ids.acc = io.accession_number;
});

test("every imaging order gets a unique accession number", async () => {
  assert.match(ids.acc, /^HC\d{10}$/);
  const other = (await h.one(`insert into public.orders(patient_id,order_type,status) values($1,'imaging','pending') returning id`, [ids.p.id])).id;
  assert.notEqual((await h.one(`insert into public.imaging_orders(order_id,modality) values($1,'MRI') returning accession_number`, [other])).accession_number, ids.acc);
});

test("a study links only with a matching accession number and the patient's UNIN or MRN", async () => {
  await assert.rejects(link(ids.rad, "1.2.3.4", ids.p.snau, "HC9999999999"), /accession number does not match/);
  await assert.rejects(link(ids.rad, "1.2.3.4", "SOMEONE-ELSE", ids.acc), /Patient ID does not match/);
  await assert.rejects(link(ids.rad, "1.2.x", ids.p.snau, ids.acc), /valid DICOM Study Instance UID/);
  await assert.rejects(link(ids.billing, "1.2.3.4", ids.p.snau, ids.acc), /Only imaging or clinical staff/);
  await assert.rejects(link(ids.rad2, "1.2.3.4", ids.p.snau, ids.acc), /Only imaging or clinical staff/);
  await link(ids.rad, "1.2.3.4", "MRN-5", ids.acc);
  const row = await h.one(`select study_instance_uid,study_linked_by from public.imaging_orders where id=$1`, [ids.io]);
  assert.equal(row.study_instance_uid, "1.2.3.4"); assert.equal(row.study_linked_by, ids.rad);
});

test("archive settings: admins configure, secrets cannot be stored inline, only the service role reads the full config", async () => {
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`insert into public.integration_endpoints(facility_id,integration_type,base_url,enabled,configuration) values($1,'dicomweb_qido','https://pacs.example/dicom-web',true,'{"token":"abc"}')`, [ids.f1])), /no_inline_secret/);
  await h.as(ids.owner, "aal2", () => h.q(`insert into public.integration_endpoints(facility_id,integration_type,base_url,enabled,configuration) values($1,'dicomweb_qido','https://pacs.example/dicom-web',true,'{"viewer_url_template":"https://viewer.example/v?StudyInstanceUIDs={StudyInstanceUID}","auth_env":"PACS_TOKEN"}')`, [ids.f1]));
  await assert.rejects(h.as(ids.rad, "aal2", () => h.q(`insert into public.integration_endpoints(facility_id,integration_type,base_url) values($1,'dicomweb_wado','https://x')`, [ids.f1])), /row-level security/, "imaging staff cannot change integrations");
  assert.equal((await h.as(ids.rad, "aal2", () => h.q(`select public.imaging_viewer_template($1) as t`, [ids.io]))).rows[0].t, "https://viewer.example/v?StudyInstanceUIDs={StudyInstanceUID}");
  assert.equal((await h.as(ids.rad2, "aal2", () => h.q(`select public.imaging_viewer_template($1) as t`, [ids.io]))).rows[0].t, null, "other facilities get nothing");
  await assert.rejects(h.as(ids.rad, "aal2", () => h.q(`select public.imaging_archive_config($1)`, [ids.io])), /permission denied/);
  await h.q(`set role service_role`);
  try { assert.equal((await h.q(`select public.imaging_archive_config($1) as c`, [ids.io])).rows[0].c.auth_env, "PACS_TOKEN"); } finally { await h.q(`reset role`); }
});
