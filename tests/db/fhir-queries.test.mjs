// Runs the FHIR Edge Function's column lists against the real schema, and checks that a
// staff member at another facility gets nothing back through them.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";

let h, ids = {};
const columns = {
  patients: "id,first_name,middle_name,last_name,sex,date_of_birth,snau,life_status,preferred_language",
  patient_contact_methods: "contact_type,country_calling_code,contact_value,primary_contact",
  facility_patient_mrns: "facility_id,mrn",
  encounters: "id,patient_id,encounter_type,start_at,end_at,status",
  diagnoses: "id,patient_id,encounter_id,code,display,clinical_status,onset_at,closed_at,recorded_at",
  medication_orders: "id,patient_id,encounter_id,dose,route,frequency,status,start_at,end_at",
  patient_allergies: "id,patient_id,allergen_type,substance,reaction,severity,verification_status,clinical_status,onset_date,recorded_at",
  immunizations: "id,patient_id,vaccine_name,vaccine_code,dose_number,lot_number,expiry_date,site,route,administered_at,status,not_done_reason",
  vital_sign_observations: "id,patient_id,recorded_at,heart_rate,respiratory_rate,temperature_c,oxygen_saturation,weight_kg,height_cm,bmi,systolic_bp,diastolic_bp",
  lab_results: "id,analyte_code,value,numeric_value,units,reference_range,interpretation,validation_status,result_at",
};

before(async () => {
  h = helpers(await createDatabase());
  ids.owner = await h.user("o@f1.test"); ids.owner2 = await h.user("o@f2.test"); ids.nurse = await h.user("n@f1.test"); ids.nurse2 = await h.user("n@f2.test");
  ids.f1 = await h.facility("f-one", ids.owner); ids.f2 = await h.facility("f-two", ids.owner2);
  await h.member(ids.f1, ids.nurse, "nurse"); await h.member(ids.f2, ids.nurse2, "nurse");
  ids.p = (await h.one(`insert into public.patients(first_name,last_name,facility_id) values('F','H',$1) returning id`, [ids.f1])).id;
  await h.q(`insert into public.vital_sign_observations(facility_id,patient_id,heart_rate) values($1,$2,72)`, [ids.f1, ids.p]);
});

test("every column the FHIR function reads exists", async () => {
  for (const [table, list] of Object.entries(columns)) await h.q(`select ${list} from public.${table} limit 0`);
});
test("through the same reads, another facility's staff see none of the patient's data", async () => {
  for (const table of ["patients", "vital_sign_observations"]) {
    const filter = table === "patients" ? "id" : "patient_id";
    assert.equal((await h.as(ids.nurse, "aal2", () => h.q(`select ${columns[table]} from public.${table} where ${filter}=$1`, [ids.p]))).rows.length, 1, `${table}: own facility`);
    assert.equal((await h.as(ids.nurse2, "aal2", () => h.q(`select ${columns[table]} from public.${table} where ${filter}=$1`, [ids.p]))).rows.length, 0, `${table}: other facility`);
  }
});
test("the audit function the FHIR API calls records the access, and refuses outsiders", async () => {
  await h.as(ids.nurse, "aal2", () => h.q(`select public.log_patient_record_view($1,'fhir')`, [ids.p]));
  assert.equal((await h.one(`select count(*)::int as n from public.audit_logs where context='fhir' and patient_id=$1`, [ids.p])).n, 1);
  await assert.rejects(h.as(ids.nurse2, "aal2", () => h.q(`select public.log_patient_record_view($1,'fhir')`, [ids.p])), /not authorized/);
});
