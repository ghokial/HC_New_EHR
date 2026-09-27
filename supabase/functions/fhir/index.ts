// FHIR R4 read-only API.
//
// Two kinds of bearer token are accepted:
//  * a Healthcarology session token: requests run with the caller's own session, so the
//    database access rules (facility scoping, MFA, patient portal rules) apply unchanged;
//  * a SMART on FHIR access token (hcs_...), issued by /smart-token after the patient
//    approved an app: only that patient's record, only the granted resource types, and
//    only what the patient portal itself shows (validated results; no staff-only data).
// Every patient whose data is returned is recorded in the audit log.
//
//   GET /fhir/metadata                         GET /fhir/.well-known/smart-configuration
//   GET /fhir/Patient/{id}                     GET /fhir/Patient?identifier=urn:healthcarology:unin|{UNIN}
//   GET /fhir/{Type}/{id}                      GET /fhir/{Type}?patient={id}
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import * as F from "../_shared/fhir-mapping.js";
import { scopeAllows, smartConfiguration } from "../_shared/smart.js";

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
  const functionsBase = baseUrl.replace(/\/fhir$/, "");
  const smartUris = { authorizeUrl: `${(Deno.env.get("PORTAL_ORIGIN") || "http://127.0.0.1:4173").replace(/\/$/, "")}/smart-authorize.html`, tokenUrl: `${functionsBase}/smart-token` };
  if (type === ".well-known" && id === "smart-configuration") return new Response(JSON.stringify(smartConfiguration(smartUris)), { headers: { ...headers, "Content-Type": "application/json" } });
  if (type === "metadata") {
    const capability = F.capabilityStatement(baseUrl) as any;
    capability.rest[0].security.service = [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/restful-security-service", code: "SMART-on-FHIR" }] }];
    capability.rest[0].security.extension = [{ url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris", extension: [{ url: "authorize", valueUri: smartUris.authorizeUrl }, { url: "token", valueUri: smartUris.tokenUrl }] }];
    return reply(capability);
  }

  const auth = req.headers.get("Authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!bearer) return fail("A bearer token is required", 401, "login");
  if (!F.SUPPORTED.includes(type)) return fail(`Resource type ${type || "(none)"} is not supported`, 404, "not-supported");

  // SMART tokens: resolved with the service role, then every query is pinned to the
  // authorized patient. Session tokens: queries run as the user under RLS.
  let db: any, smart: { patient_id: number; scopes: string[]; user_id: string } | null = null;
  if (bearer.startsWith("hcs_")) {
    db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await db.rpc("smart_resolve_token", { presented_token: bearer });
    if (error || !data) return fail("The access token is invalid, expired, or revoked", 401, "login");
    smart = data;
    if (!scopeAllows(smart!.scopes, type, id ? "read" : "search")) return fail(`The token's scopes do not include ${type}`, 403, "forbidden");
  } else {
    db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await db.auth.getUser();
    if (userError || !user) return fail("Invalid or expired session", 401, "login");
  }

  const seen = new Set<number>();
  const audit = async (patientIds: number[]) => {
    if (smart) return; // already recorded when the SMART token was resolved
    for (const pid of patientIds) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const { error } = await db.rpc("log_patient_record_view", { target_patient: pid, view_context: "fhir" });
      if (error) throw new Error(`Access could not be recorded in the audit log: ${error.message}`);
    }
  };
  const need = (value: string | null, name: string) => { if (!value) throw new Error(`The ${name} search parameter is required`); return value; };
  const patientParam = () => {
    const requested = url.searchParams.get("patient");
    if (smart) { if (requested && Number(String(requested).replace(/^Patient\//, "")) !== smart.patient_id) throw new Error("This token is limited to its authorized patient"); return smart.patient_id; }
    return Number(String(need(requested, "patient")).replace(/^Patient\//, ""));
  };
  // Pins a query to the SMART patient, whatever the request asked for.
  const pin = (query: any, column = "patient_id") => smart ? query.eq(column, smart.patient_id) : query;

  try {
    let resources: Record<string, unknown>[] = [];
    if (type === "Patient") {
      let query = pin(db.from("patients").select("id,first_name,middle_name,last_name,sex,date_of_birth,snau,life_status,preferred_language"), "id");
      if (id) query = query.eq("id", Number(id));
      else if (url.searchParams.get("_id")) query = query.eq("id", Number(url.searchParams.get("_id")));
      else if (!smart) {
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
      await audit((data || []).map((r: any) => r.id));
    } else if (type === "Encounter") {
      let query = pin(db.from("encounters").select("id,patient_id,encounter_type,start_at,end_at,status,services(name)"));
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam()).order("start_at", { ascending: false });
      const { data, error } = await query.limit(200); if (error) throw error;
      resources = (data || []).map(F.encounter); await audit((data || []).map((r: any) => r.patient_id));
    } else if (type === "Condition") {
      let query = pin(db.from("diagnoses").select("id,patient_id,encounter_id,code,display,clinical_status,onset_at,closed_at,recorded_at"));
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.condition); await audit((data || []).map((r: any) => r.patient_id));
    } else if (type === "MedicationRequest") {
      let query = pin(db.from("medication_orders").select("id,patient_id,encounter_id,dose,route,frequency,status,start_at,end_at,medications(name,strength)"));
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.medicationRequest); await audit((data || []).map((r: any) => r.patient_id));
    } else if (type === "AllergyIntolerance") {
      let query = pin(db.from("patient_allergies").select("id,patient_id,allergen_type,substance,reaction,severity,verification_status,clinical_status,onset_date,recorded_at"));
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.allergyIntolerance); await audit((data || []).map((r: any) => r.patient_id));
    } else if (type === "Immunization") {
      let query = pin(db.from("immunizations").select("id,patient_id,vaccine_name,vaccine_code,dose_number,lot_number,expiry_date,site,route,administered_at,status,not_done_reason"));
      query = id ? query.eq("id", Number(id)) : query.eq("patient_id", patientParam());
      const { data, error } = await query.limit(500); if (error) throw error;
      resources = (data || []).map(F.immunization); await audit((data || []).map((r: any) => r.patient_id));
    } else if (type === "Observation") {
      // Observation ids: vs-{vital row}-{measure} or lab-{result id}. Vital signs are staff
      // data in Healthcarology (the patient portal does not show them), so SMART apps
      // receive laboratory results only.
      const vitalMatch = id?.match(/^vs-(\d+)-/), labMatch = id?.match(/^lab-(\d+)$/);
      const pid = id ? null : patientParam();
      if (!smart && (!id || vitalMatch)) {
        let query = db.from("vital_sign_observations").select("id,patient_id,recorded_at,heart_rate,respiratory_rate,temperature_c,oxygen_saturation,weight_kg,height_cm,bmi,systolic_bp,diastolic_bp");
        query = vitalMatch ? query.eq("id", Number(vitalMatch[1])) : query.eq("patient_id", pid).order("recorded_at", { ascending: false });
        const { data, error } = await query.limit(500); if (error) throw error;
        resources.push(...(data || []).flatMap(F.vitalObservations)); await audit((data || []).map((r: any) => r.patient_id));
      }
      if (!id || labMatch) {
        let query = db.from("lab_results").select("id,analyte_code,value,numeric_value,units,reference_range,interpretation,validation_status,result_at,lab_orders!inner(orders!inner(patient_id))");
        if (smart) query = query.eq("lab_orders.orders.patient_id", smart.patient_id).eq("validation_status", "validated");
        query = labMatch ? query.eq("id", Number(labMatch[1])) : query.eq("lab_orders.orders.patient_id", pid);
        const { data, error } = await query.limit(500); if (error) throw error;
        const labs = (data || []).map((r: any) => ({ row: r, patientId: r.lab_orders?.orders?.patient_id }));
        resources.push(...labs.map((x: any) => F.labObservation(x.row, x.patientId)).filter(Boolean)); await audit(labs.map((x: any) => x.patientId).filter(Boolean));
      }
      if (id) resources = resources.filter(r => r.id === id);
    }
    if (id) return resources.length ? reply(resources[0]) : fail(`${type}/${id} was not found or you are not allowed to see it`, 404, "not-found");
    return reply(F.searchBundle(resources, baseUrl));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
});
