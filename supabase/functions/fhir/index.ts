// FHIR R4 read-only API. Requests run with the caller's own Supabase session, so the
// database access rules (facility scoping, MFA, patient portal rules) apply unchanged.
// Every patient whose data is returned is recorded in the audit log.
//
//   GET /fhir/metadata
//   GET /fhir/Patient/{id}              GET /fhir/Patient?identifier=urn:healthcarology:unin|{UNIN}
//   GET /fhir/{Type}/{id}               GET /fhir/{Type}?patient={id}
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import * as F from "../_shared/fhir-mapping.js";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/fhir+json", "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const fail = (message: string, status = 400, code = "processing") => reply(F.operationOutcome(message, code), status);

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "GET") return fail("This FHIR endpoint is read-only", 405, "not-supported");
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("fhir");
  const [type, id] = parts.slice(at + 1);
  const baseUrl = `${url.origin}${parts.slice(0, at + 1).map(p => `/${p}`).join("")}`;
  if (type === "metadata") return reply(F.capabilityStatement(baseUrl));

  const auth = req.headers.get("Authorization");
  if (!auth) return fail("A bearer token from a signed-in account is required", 401, "login");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) return fail("Invalid or expired session", 401, "login");
  if (!F.SUPPORTED.includes(type)) return fail(`Resource type ${type || "(none)"} is not supported`, 404, "not-supported");

  const seen = new Set<number>();
  const audit = async (patientIds: number[]) => {
    for (const pid of patientIds) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const { error } = await db.rpc("log_patient_record_view", { target_patient: pid, view_context: "fhir" });
      if (error) throw new Error(`Access could not be recorded in the audit log: ${error.message}`);
    }
  };
  const need = (value: string | null, name: string) => { if (!value) throw new Error(`The ${name} search parameter is required`); return value; };
  const patientParam = () => Number(String(need(url.searchParams.get("patient"), "patient")).replace(/^Patient\//, ""));

  try {
    let resources: Record<string, unknown>[] = [];
    if (type === "Patient") {
      let query = db.from("patients").select("id,first_name,middle_name,last_name,sex,date_of_birth,snau,life_status,preferred_language");
      if (id) query = query.eq("id", Number(id));
      else if (url.searchParams.get("_id")) query = query.eq("id", Number(url.searchParams.get("_id")));
      else {
        const [system, value] = String(need(url.searchParams.get("identifier"), "identifier or _id")).split("|");
        if (system !== F.SYSTEMS.unin || !value) throw new Error(`Search by identifier=${F.SYSTEMS.unin}|{UNIN}`);
        query = query.eq("snau", value);
      }
      const { data, error } = await query.limit(50);
      if (error) throw error;
      for (const row of data || []) {
        const [{ data: contacts }, { data: mrns }] = await Promise.all([
          db.from("patient_contact_methods").select("contact_type,country_calling_code,contact_value,primary_contact").eq("patient_id", row.id),
          db.from("facility_patient_mrns").select("facility_id,mrn").eq("patient_id", row.id),
        ]);
        resources.push(F.patient(row, { contacts: contacts || [], mrns: mrns || [] }));
      }
      await audit((data || []).map(r => r.id));
    } else if (type === "Encounter") {
      let query = db.from("encounters").select("id,patient_id,encounter_type,start_at,end_at,status,services(name)");
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam()).order("start_at", { ascending: false });
      const { data, error } = await query.limit(200); if (error) throw error;
      resources = (data || []).map(F.encounter); await audit((data || []).map(r => r.patient_id));
    } else if (type === "Condition") {
      let query = db.from("diagnoses").select("id,patient_id,encounter_id,code,display,clinical_status,onset_at,closed_at,recorded_at");
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.condition); await audit((data || []).map(r => r.patient_id));
    } else if (type === "MedicationRequest") {
      let query = db.from("medication_orders").select("id,patient_id,encounter_id,dose,route,frequency,status,start_at,end_at,medications(name,strength)");
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.medicationRequest); await audit((data || []).map(r => r.patient_id));
    } else if (type === "AllergyIntolerance") {
      let query = db.from("patient_allergies").select("id,patient_id,allergen_type,substance,reaction,severity,verification_status,clinical_status,onset_date,recorded_at");
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.allergyIntolerance); await audit((data || []).map(r => r.patient_id));
    } else if (type === "Immunization") {
      let query = db.from("immunizations").select("id,patient_id,vaccine_name,vaccine_code,dose_number,lot_number,expiry_date,site,route,administered_at,status,not_done_reason");
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.immunization); await audit((data || []).map(r => r.patient_id));
    } else if (type === "Observation") {
      // Observation ids: vs-{vital row}-{measure} or lab-{result id}.
      const vitalMatch = id?.match(/^vs-(\d+)-/), labMatch = id?.match(/^lab-(\d+)$/);
      const pid = id ? null : patientParam();
      if (!id || vitalMatch) {
        let query = db.from("vital_sign_observations").select("id,patient_id,recorded_at,heart_rate,respiratory_rate,temperature_c,oxygen_saturation,weight_kg,height_cm,bmi,systolic_bp,diastolic_bp");
        query = vitalMatch ? query.eq("id", Number(vitalMatch[1])) : query.eq("patient_id", pid).order("recorded_at", { ascending: false });
        const { data, error } = await query.limit(500); if (error) throw error;
        resources.push(...(data || []).flatMap(F.vitalObservations)); await audit((data || []).map(r => r.patient_id));
      }
      if (!id || labMatch) {
        let query = db.from("lab_results").select("id,analyte_code,value,numeric_value,units,reference_range,interpretation,validation_status,result_at,lab_orders!inner(orders!inner(patient_id))");
        query = labMatch ? query.eq("id", Number(labMatch[1])) : query.eq("lab_orders.orders.patient_id", pid);
        const { data, error } = await query.limit(500); if (error) throw error;
        const labs = (data || []).map((r: any) => ({ row: r, patientId: r.lab_orders?.orders?.patient_id }));
        resources.push(...labs.map(x => F.labObservation(x.row, x.patientId)).filter(Boolean)); await audit(labs.map(x => x.patientId).filter(Boolean));
      }
      if (id) resources = resources.filter(r => r.id === id);
    }
    if (id) return resources.length ? reply(resources[0]) : fail(`${type}/${id} was not found or you are not allowed to see it`, 404, "not-found");
    return reply(F.searchBundle(resources, baseUrl));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
});
