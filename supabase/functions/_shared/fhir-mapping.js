// Maps Healthcarology rows to FHIR R4 resources. Pure functions with no I/O, so the
// same code runs in the Edge Function (Deno) and in the Node test suite.
// Only standard code systems are used; local identifiers use Healthcarology URNs.

export const SYSTEMS = {
  unin: "urn:healthcarology:unin",
  mrn: facilityId => `urn:healthcarology:facility:${facilityId}:mrn`,
  loinc: "http://loinc.org",
  ucum: "http://unitsofmeasure.org",
  icd11: "http://id.who.int/icd/release/11/mms",
  observationCategory: "http://terminology.hl7.org/CodeSystem/observation-category",
  conditionClinical: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  conditionVerification: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
  allergyClinical: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
  allergyVerification: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  interpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
};

const present = value => value !== null && value !== undefined && value !== "";
const clean = object => Object.fromEntries(Object.entries(object).filter(([, value]) => present(value) && !(Array.isArray(value) && value.length === 0)));
const ref = (type, id) => ({ reference: `${type}/${id}` });

export function patient(row, { contacts = [], mrns = [] } = {}) {
  const gender = row.sex === "M" ? "male" : row.sex === "F" ? "female" : "unknown";
  return clean({
    resourceType: "Patient",
    id: String(row.id),
    identifier: [
      ...(row.snau ? [{ system: SYSTEMS.unin, value: row.snau }] : []),
      ...mrns.map(m => ({ system: SYSTEMS.mrn(m.facility_id), value: m.mrn, type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] } })),
    ],
    active: row.life_status ? row.life_status !== "deceased" : undefined,
    name: [clean({ use: "official", family: row.last_name, given: [row.first_name, row.middle_name].filter(Boolean) })],
    telecom: contacts.map(c => clean({ system: c.contact_type === "email" ? "email" : "phone", value: `${c.country_calling_code || ""}${c.contact_value}`, rank: c.primary_contact ? 1 : undefined })),
    gender,
    birthDate: row.date_of_birth || undefined,
    deceasedBoolean: row.life_status === "deceased" ? true : undefined,
    communication: row.preferred_language ? [{ language: { text: row.preferred_language } }] : undefined,
  });
}

const encounterClass = type => {
  const t = String(type || "").toLowerCase();
  if (t.includes("inpatient")) return { system: SYSTEMS.actCode, code: "IMP", display: "inpatient encounter" };
  if (t.includes("emergency")) return { system: SYSTEMS.actCode, code: "EMER", display: "emergency" };
  if (t.includes("observation")) return { system: SYSTEMS.actCode, code: "OBSENC", display: "observation encounter" };
  if (t.includes("tele")) return { system: SYSTEMS.actCode, code: "VR", display: "virtual" };
  return { system: SYSTEMS.actCode, code: "AMB", display: "ambulatory" };
};

export function encounter(row) {
  const status = row.status === "open" ? "in-progress" : row.status === "closed" ? "finished" : row.status === "cancelled" ? "cancelled" : "unknown";
  return clean({
    resourceType: "Encounter",
    id: String(row.id),
    status,
    class: encounterClass(row.encounter_type),
    type: row.encounter_type ? [{ text: row.encounter_type }] : undefined,
    serviceType: row.services?.name ? { text: row.services.name } : undefined,
    subject: ref("Patient", row.patient_id),
    period: clean({ start: row.start_at, end: row.end_at }),
  });
}

// Vital-sign columns and their LOINC code and UCUM unit.
export const VITALS = {
  heart_rate: ["8867-4", "Heart rate", "/min"],
  respiratory_rate: ["9279-1", "Respiratory rate", "/min"],
  temperature_c: ["8310-5", "Body temperature", "Cel"],
  oxygen_saturation: ["59408-5", "Oxygen saturation in Arterial blood by Pulse oximetry", "%"],
  weight_kg: ["29463-7", "Body weight", "kg"],
  height_cm: ["8302-2", "Body height", "cm"],
  bmi: ["39156-5", "Body mass index (BMI) [Ratio]", "kg/m2"],
};

const quantity = (value, unit) => ({ value: Number(value), unit, system: SYSTEMS.ucum, code: unit });
const vitalCategory = [{ coding: [{ system: SYSTEMS.observationCategory, code: "vital-signs", display: "Vital Signs" }] }];

// One vital-sign row becomes one Observation per recorded measurement;
// systolic and diastolic become one blood-pressure panel.
export function vitalObservations(row) {
  const base = { resourceType: "Observation", status: "final", category: vitalCategory, subject: ref("Patient", row.patient_id), effectiveDateTime: row.recorded_at };
  const out = [];
  for (const [column, [code, display, unit]] of Object.entries(VITALS)) {
    if (!present(row[column])) continue;
    out.push(clean({ ...base, id: `vs-${row.id}-${column.replaceAll("_", "-")}`, code: { coding: [{ system: SYSTEMS.loinc, code, display }], text: display }, valueQuantity: quantity(row[column], unit) }));
  }
  if (present(row.systolic_bp) || present(row.diastolic_bp)) {
    out.push(clean({
      ...base, id: `vs-${row.id}-bp`,
      code: { coding: [{ system: SYSTEMS.loinc, code: "85354-9", display: "Blood pressure panel with all children optional" }], text: "Blood pressure" },
      component: [
        present(row.systolic_bp) ? { code: { coding: [{ system: SYSTEMS.loinc, code: "8480-6", display: "Systolic blood pressure" }] }, valueQuantity: quantity(row.systolic_bp, "mm[Hg]") } : null,
        present(row.diastolic_bp) ? { code: { coding: [{ system: SYSTEMS.loinc, code: "8462-4", display: "Diastolic blood pressure" }] }, valueQuantity: quantity(row.diastolic_bp, "mm[Hg]") } : null,
      ].filter(Boolean),
    }));
  }
  return out;
}

const interpretationCode = { normal: ["N", "Normal"], out_of_range: ["A", "Abnormal"], dangerously_abnormal: ["AA", "Critical abnormal"] };

// Only validated (released) laboratory results are exposed.
export function labObservation(row, patientId) {
  if (row.validation_status !== "validated") return null;
  const interp = interpretationCode[row.interpretation];
  return clean({
    resourceType: "Observation",
    id: `lab-${row.id}`,
    status: "final",
    category: [{ coding: [{ system: SYSTEMS.observationCategory, code: "laboratory", display: "Laboratory" }] }],
    code: { text: row.analyte_code },
    subject: ref("Patient", patientId),
    effectiveDateTime: row.result_at || undefined,
    valueQuantity: present(row.numeric_value) ? clean({ value: Number(row.numeric_value), unit: row.units || undefined }) : undefined,
    valueString: !present(row.numeric_value) && present(row.value) ? String(row.value) : undefined,
    interpretation: interp ? [{ coding: [{ system: SYSTEMS.interpretation, code: interp[0], display: interp[1] }] }] : undefined,
    referenceRange: row.reference_range ? [{ text: row.reference_range }] : undefined,
  });
}

export function condition(row) {
  const clinical = { active: "active", healed: "resolved", closed: "inactive" }[row.clinical_status];
  const errored = row.clinical_status === "entered_in_error";
  return clean({
    resourceType: "Condition",
    id: String(row.id),
    clinicalStatus: clinical ? { coding: [{ system: SYSTEMS.conditionClinical, code: clinical }] } : undefined,
    verificationStatus: { coding: [{ system: SYSTEMS.conditionVerification, code: errored ? "entered-in-error" : "confirmed" }] },
    code: { coding: [clean({ system: SYSTEMS.icd11, code: row.code, display: row.display })], text: row.display },
    subject: ref("Patient", row.patient_id),
    encounter: row.encounter_id ? ref("Encounter", row.encounter_id) : undefined,
    onsetDateTime: row.onset_at || undefined,
    abatementDateTime: row.closed_at || undefined,
    recordedDate: row.recorded_at || undefined,
  });
}

export function medicationRequest(row) {
  const status = { active: "active", completed: "completed", cancelled: "cancelled", on_hold: "on-hold" }[row.status] || "unknown";
  const med = row.medications || {};
  return clean({
    resourceType: "MedicationRequest",
    id: String(row.id),
    status,
    intent: "order",
    medicationCodeableConcept: { text: [med.name, med.strength].filter(Boolean).join(" ") || "Medication" },
    subject: ref("Patient", row.patient_id),
    encounter: row.encounter_id ? ref("Encounter", row.encounter_id) : undefined,
    authoredOn: row.start_at || undefined,
    dosageInstruction: [clean({ text: [row.dose, row.route, row.frequency].filter(Boolean).join(" "), route: row.route ? { text: row.route } : undefined })],
  });
}

export function allergyIntolerance(row) {
  const verification = row.verification_status === "entered_in_error" ? "entered-in-error" : row.verification_status;
  const criticality = row.severity === "life_threatening" || row.severity === "severe" ? "high" : row.severity === "mild" || row.severity === "moderate" ? "low" : "unable-to-assess";
  return clean({
    resourceType: "AllergyIntolerance",
    id: String(row.id),
    clinicalStatus: verification === "entered-in-error" ? undefined : { coding: [{ system: SYSTEMS.allergyClinical, code: row.clinical_status }] },
    verificationStatus: { coding: [{ system: SYSTEMS.allergyVerification, code: verification }] },
    category: { medication: ["medication"], food: ["food"], environmental: ["environment"] }[row.allergen_type],
    criticality,
    code: { text: row.substance },
    patient: ref("Patient", row.patient_id),
    onsetDateTime: row.onset_date || undefined,
    recordedDate: row.recorded_at || undefined,
    reaction: row.reaction ? [{ manifestation: [{ text: row.reaction }], severity: { mild: "mild", moderate: "moderate", severe: "severe", life_threatening: "severe" }[row.severity] }] : undefined,
  });
}

export function immunization(row) {
  const status = { completed: "completed", not_done: "not-done", entered_in_error: "entered-in-error" }[row.status];
  return clean({
    resourceType: "Immunization",
    id: String(row.id),
    status,
    statusReason: row.status === "not_done" && row.not_done_reason ? { text: row.not_done_reason } : undefined,
    vaccineCode: { text: row.vaccine_name, ...(row.vaccine_code ? { coding: [{ code: row.vaccine_code }] } : {}) },
    patient: ref("Patient", row.patient_id),
    occurrenceDateTime: row.administered_at,
    lotNumber: row.lot_number || undefined,
    expirationDate: row.expiry_date || undefined,
    site: row.site ? { text: row.site } : undefined,
    route: row.route ? { text: row.route } : undefined,
    protocolApplied: row.dose_number ? [{ doseNumberPositiveInt: Number(row.dose_number) }] : undefined,
  });
}

export function searchBundle(resources, baseUrl) {
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: resources.length,
    entry: resources.map(resource => ({ fullUrl: `${baseUrl}/${resource.resourceType}/${resource.id}`, resource, search: { mode: "match" } })),
  };
}

export function operationOutcome(message, code = "processing") {
  return { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics: message }] };
}

export const SUPPORTED = ["Patient", "Encounter", "Observation", "Condition", "MedicationRequest", "AllergyIntolerance", "Immunization"];

export function capabilityStatement(baseUrl) {
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    date: "2026-09-27",
    kind: "instance",
    fhirVersion: "4.0.1",
    format: ["json"],
    implementation: { description: "Healthcarology EHR FHIR R4 read-only API", url: baseUrl },
    rest: [{
      mode: "server",
      security: { description: "Bearer token from a signed-in Healthcarology account. The account's own access rules apply; staff need MFA." },
      resource: SUPPORTED.map(type => ({
        type,
        interaction: [{ code: "read" }, { code: "search-type" }],
        searchParam: type === "Patient" ? [{ name: "identifier", type: "token" }, { name: "_id", type: "token" }] : [{ name: "patient", type: "reference" }],
      })),
    }],
  };
}
