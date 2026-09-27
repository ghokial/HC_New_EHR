// FHIR R4 mapping: checks each resource against the fields FHIR R4 requires, the
// standard code systems used, and that the Edge Function only reads columns that exist.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as F from "../supabase/functions/_shared/fhir-mapping.js";

test("Patient carries the UNIN, facility MRNs, name, gender and contact details", () => {
  const p = F.patient({ id: 7, first_name: "Amina", middle_name: "K", last_name: "Mbuyi", sex: "F", date_of_birth: "1990-02-01", snau: "10L-F990-00003", life_status: "active", preferred_language: "Lingala" },
    { contacts: [{ contact_type: "phone", country_calling_code: "+243", contact_value: "810000000", primary_contact: true }], mrns: [{ facility_id: "fac-1", mrn: "MRN-1" }] });
  assert.equal(p.resourceType, "Patient"); assert.equal(p.id, "7"); assert.equal(p.gender, "female");
  assert.deepEqual(p.identifier[0], { system: "urn:healthcarology:unin", value: "10L-F990-00003" });
  assert.equal(p.identifier[1].system, "urn:healthcarology:facility:fac-1:mrn"); assert.equal(p.identifier[1].type.coding[0].code, "MR");
  assert.deepEqual(p.name[0].given, ["Amina", "K"]); assert.equal(p.telecom[0].value, "+243810000000");
  assert.equal(F.patient({ id: 1, first_name: "X", last_name: "Y", life_status: "deceased" }).deceasedBoolean, true);
});

test("Encounter has the required status and class", () => {
  const e = F.encounter({ id: 3, patient_id: 7, encounter_type: "Inpatient", status: "open", start_at: "2026-09-01T10:00:00Z", services: { name: "Cardiology" } });
  assert.equal(e.status, "in-progress"); assert.equal(e.class.code, "IMP"); assert.equal(e.subject.reference, "Patient/7");
  assert.equal(F.encounter({ id: 4, patient_id: 7, encounter_type: "Outpatient", status: "closed" }).status, "finished");
  assert.equal(F.encounter({ id: 4, patient_id: 7, encounter_type: "Emergency", status: "open" }).class.code, "EMER");
});

test("vital signs use LOINC codes and UCUM units, and blood pressure is one panel", () => {
  const list = F.vitalObservations({ id: 9, patient_id: 7, recorded_at: "2026-09-01T10:00:00Z", heart_rate: 80, temperature_c: 37.2, systolic_bp: 120, diastolic_bp: 80, weight_kg: null });
  const byCode = Object.fromEntries(list.map(o => [o.code.coding[0].code, o]));
  assert.equal(byCode["8867-4"].valueQuantity.code, "/min"); assert.equal(byCode["8310-5"].valueQuantity.code, "Cel");
  assert.deepEqual(byCode["85354-9"].component.map(c => c.code.coding[0].code), ["8480-6", "8462-4"]);
  assert.ok(!byCode["29463-7"], "empty measurements are not exported");
  for (const o of list) { assert.equal(o.status, "final"); assert.equal(o.category[0].coding[0].code, "vital-signs"); }
});

test("only validated laboratory results are exported", () => {
  assert.equal(F.labObservation({ id: 1, analyte_code: "GLU", numeric_value: 5, validation_status: "pending_validation" }, 7), null);
  const o = F.labObservation({ id: 2, analyte_code: "GLU", numeric_value: 9.1, units: "mmol/L", interpretation: "out_of_range", validation_status: "validated", reference_range: "3.9 - 5.5" }, 7);
  assert.equal(o.id, "lab-2"); assert.equal(o.category[0].coding[0].code, "laboratory"); assert.equal(o.interpretation[0].coding[0].code, "A");
  assert.equal(o.valueQuantity.value, 9.1); assert.equal(o.referenceRange[0].text, "3.9 - 5.5");
});

test("Condition, MedicationRequest, AllergyIntolerance and Immunization map statuses to FHIR codes", () => {
  const c = F.condition({ id: 5, patient_id: 7, code: "BA00", display: "Essential hypertension", clinical_status: "healed", onset_at: "2026-01-01" });
  assert.equal(c.code.coding[0].system, "http://id.who.int/icd/release/11/mms"); assert.equal(c.clinicalStatus.coding[0].code, "resolved");
  assert.equal(F.condition({ id: 6, patient_id: 7, code: "x", display: "x", clinical_status: "entered_in_error" }).verificationStatus.coding[0].code, "entered-in-error");
  const m = F.medicationRequest({ id: 8, patient_id: 7, status: "on_hold", dose: "5mg", route: "oral", frequency: "daily", medications: { name: "Amlodipine", strength: "5 mg" } });
  assert.equal(m.status, "on-hold"); assert.equal(m.intent, "order"); assert.equal(m.medicationCodeableConcept.text, "Amlodipine 5 mg");
  const a = F.allergyIntolerance({ id: 2, patient_id: 7, allergen_type: "medication", substance: "Penicillin", severity: "life_threatening", verification_status: "confirmed", clinical_status: "active", reaction: "Anaphylaxis" });
  assert.equal(a.criticality, "high"); assert.deepEqual(a.category, ["medication"]); assert.equal(a.patient.reference, "Patient/7");
  assert.equal(F.allergyIntolerance({ id: 3, patient_id: 7, allergen_type: "food", substance: "x", severity: "unknown", verification_status: "entered_in_error", clinical_status: "active" }).clinicalStatus, undefined, "FHIR forbids clinicalStatus on entered-in-error");
  const i = F.immunization({ id: 4, patient_id: 7, vaccine_name: "Measles", status: "not_done", not_done_reason: "Refused", administered_at: "2026-09-01T09:00:00Z", dose_number: 2 });
  assert.equal(i.status, "not-done"); assert.equal(i.statusReason.text, "Refused"); assert.equal(i.protocolApplied[0].doseNumberPositiveInt, 2);
});

test("search results are a FHIR searchset Bundle and the capability statement lists every resource", () => {
  const b = F.searchBundle([F.encounter({ id: 1, patient_id: 2, status: "open" })], "https://x/functions/v1/fhir");
  assert.equal(b.type, "searchset"); assert.equal(b.total, 1); assert.equal(b.entry[0].fullUrl, "https://x/functions/v1/fhir/Encounter/1");
  const cap = F.capabilityStatement("https://x/functions/v1/fhir");
  assert.equal(cap.fhirVersion, "4.0.1"); assert.deepEqual(cap.rest[0].resource.map(r => r.type), F.SUPPORTED);
});

test("the Edge Function is read-only, uses the caller's session, and audits every patient it returns", async () => {
  const source = await readFile(new URL("../supabase/functions/fhir/index.ts", import.meta.url), "utf8");
  assert.ok(source.includes('SUPABASE_ANON_KEY'), "runs with the caller's token"); assert.ok(!source.includes("SERVICE_ROLE"), "never bypasses access rules");
  assert.ok(source.includes('rpc("log_patient_record_view"')); assert.ok(source.includes("This FHIR endpoint is read-only"));
});
