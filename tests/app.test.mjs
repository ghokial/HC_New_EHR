import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("prototype exposes every source-defined core module", async () => {
  const js = await read("app.js");
  for (const module of ["Patients","Encounters","Orders & results","Medications","Clinical notes","UNIN registry","Departments","Access control","Audit trail"]) assert.match(js, new RegExp(module.replace(/[&]/g,"\\&"),"i"));
});

test("migration enables RLS and avoids deprecated auth.role policies", async () => {
  const sql = await read("supabase/migrations/20260826000000_healthcarology_ehr.sql");
  assert.match(sql,/alter table public\.patients enable row level security/i);
  assert.match(sql,/auth\.jwt\(\)->'app_metadata'/i);
  assert.doesNotMatch(sql,/auth\.role\(\)/i);
});

test("UI declares demonstration-data boundary", async () => {
  const html = await read("index.html");
  const js = await read("app.js");
  assert.match(html,/Demonstration data only/i);
  assert.match(js,/Demonstration only/i);
});

test("live authentication enforces temporary-password replacement", async () => {
  const live = await read("live.js");
  const createUser = await read("supabase/functions/create-user/index.ts");
  const changePassword = await read("supabase/functions/complete-password-change/index.ts");
  assert.match(createUser, /crypto\.getRandomValues/);
  assert.match(createUser, /must_change_password:true/);
  assert.match(live, /signInWithPassword/);
  assert.match(live, /passwordChangeGate/);
  assert.match(live, /resetPasswordForEmail/);
  assert.match(live, /PASSWORD_RECOVERY/);
  assert.match(changePassword, /updateUserById/);
  assert.match(changePassword, /must_change_password:false/);
});

test("live shell does not reload on the normal initial auth event", async () => {
  const html = await read("index.html");
  const app = await read("app.js");
  const live = await read("live.js");
  assert.match(html, /vendor\/supabase\.js/);
  assert.doesNotMatch(live, /https:\/\/esm\.sh/);
  assert.match(live, /event==="SIGNED_IN" && newSession\?\.user\?\.id !== previousUserId/);
  assert.match(live, /hc:view-rendered/);
  assert.match(app, /hc:view-rendered/);
  assert.doesNotMatch(live, /new MutationObserver/);
});

test("direct file opening provides launcher guidance", async () => {
  const html = await read("index.html");
  const launcher = await read("Start Healthcarology EHR.cmd");
  assert.match(html, /location\.protocol === "file:"/);
  assert.match(html, /Start Healthcarology EHR\.cmd/);
  assert.match(launcher, /http:\/\/127\.0\.0\.1:4173\//);
});

test("facility and patient portals are tenant-aware", async () => {
  const server = await read("server.mjs");
  const portal = await read("portal.js");
  const migration = await read("supabase/migrations/20260827005747_facility_and_patient_portals.sql");
  assert.match(server, /pathname === "\/admin"/);
  assert.match(server, /pathname === "\/patient"/);
  assert.match(portal, /create-facility/);
  assert.match(portal, /invite_patient_link/);
  assert.match(portal, /respond_patient_link/);
  assert.match(migration, /create table public\.facilities/i);
  assert.match(migration, /public\.is_facility_member\(facility_id\)/i);
});

test("placeholder doctor identity is not rendered", async () => {
  assert.doesNotMatch(await read("index.html"), /Dr\. Jane Doe/);
  assert.doesNotMatch(await read("app.js"), /Dr\. Jane Doe/);
});

test("clinical standards foundation is versioned and branded", async () => {
  const sql = await read("supabase/migrations/20260827022440_clinical_standards_and_interoperability.sql");
  const live = await read("live.js");
  const portal = await read("portal.js");
  const theme = await read("theme.css");
  assert.match(sql, /prevent_unin_change/);
  assert.match(sql, /facility_patient_mrns/);
  assert.match(sql, /interpretation in \('normal','out_of_range','dangerously_abnormal'\)/);
  assert.match(sql, /prescription_interaction_alerts/);
  assert.match(sql, /WHO Model List of Essential Medicines/);
  assert.match(sql, /ICD-11 MMS/);
  assert.match(sql, /dhis2_fhir/);
  assert.match(sql, /dicomweb_qido/);
  assert.doesNotMatch(live, /name="snau"/);
  assert.match(portal, /value="am"/);
  assert.match(portal, /value="ln"/);
  assert.match(theme, /--brand-red:#d90000/);
});

test("operational workflows enforce requested release and lifecycle rules", async () => {
  const sql = await read("supabase/migrations/20260827030209_operational_clinical_workflows.sql");
  const secure = await read("supabase/migrations/20260827031007_secure_operational_access.sql");
  const portal = await read("portal.js");
  assert.match(sql, /facility_number/);
  assert.match(sql, /prescribed','awaiting','dispensed/);
  assert.match(sql, /medication_adherence_events/);
  assert.match(sql, /provider_availability_slots/);
  assert.match(sql, /clinical_status in \('active','healed','closed','entered_in_error'\)/);
  assert.match(sql, /validation_status='validated'/);
  assert.match(sql, /dialysis_sessions/);
  assert.match(sql, /surgical_checklist_items/);
  assert.match(secure, /has_facility_role/);
  assert.match(portal, /Report missed dose/);
  assert.match(portal, /Book an appointment/);
});

test("department, MFA, community, sharing, and mobile foundations are present", async () => {
  const domain = await read("supabase/migrations/20260827091618_department_community_sharing.sql");
  const mfa = await read("supabase/migrations/20260827133548_secure_mfa_and_messaging_bootstrap.sql");
  const sharing = await read("supabase/migrations/20260827134748_shared_record_guest_access.sql");
  const features = await read("portal-features.js");
  const server = await read("server.mjs");
  const mobile = await read("mobile-patient/capacitor.config.ts");
  assert.match(domain, /facility_branding/);
  assert.match(domain, /ehr_connections/);
  assert.match(domain, /health_heatmap_observations/);
  assert.match(domain, /message_threads/);
  assert.match(domain, /community_moderation_actions/);
  assert.match(domain, /support_tickets/);
  assert.match(domain, /patient_record_shares/);
  assert.match(domain, /billing_code_catalogs/);
  assert.match(mfa, /as restrictive for all to authenticated using \(private\.is_aal2\(\)\)/);
  assert.match(sharing, /protect_shared_contribution/);
  assert.match(features, /auth\.mfa\.enroll/);
  assert.match(features, /Google Authenticator, Microsoft Authenticator, Oracle Mobile Authenticator/);
  assert.match(features, /Health heat map/);
  assert.match(features, /Share PDF/);
  assert.match(server, /shared-record\.html/);
  assert.match(mobile, /com\.healthcarology\.patient/);
});

test("patient portal keeps MFA optional until the user shares data", async () => {
  const portal = await read("portal.js");
  const features = await read("portal-features.js");
  const migration = await read("supabase/migrations/20260827145500_patient_mfa_only_for_sharing.sql");
  assert.match(portal, /path==="patient"\|\|await requireMfa/);
  assert.match(features, /share-pdf[^;]+requireMfa/s);
  assert.match(features, /access-share-form[\s\S]*?if\(!await requireMfa/);
  assert.match(migration, /pa\.user_id=\(select auth\.uid\(\)\) and pa\.patient_id=diagnoses\.patient_id/);
  assert.match(migration, /shares_grantor_create/);
});

test("facility types, training hospital, workforce, and messaging are durable", async () => {
  const migration = await read("supabase/migrations/20260827161000_facility_types_training_workforce.sql");
  const createFacility = await read("supabase/functions/create-facility/index.ts");
  const features = await read("portal-features.js");
  const messaging = await read("supabase/migrations/20260827091618_department_community_sharing.sql");
  assert.match(migration, /'Demo Hospital','demo-hospital'/);
  assert.match(migration, /facility_type in \('Hospital','Health Center','Pharmacy','Laboratory \(Labs\)','Imaging Center','Research Center','Other'\)/);
  assert.match(migration, /create table public\.staff_shifts/);
  assert.match(migration, /create table public\.facility_tasks/);
  assert.match(migration, /private\.has_training_access/);
  assert.match(migration, /health_department_memberships hm/);
  assert.match(createFacility, /facilityTypes=/);
  assert.match(features, /Staff scheduling/);
  assert.match(features, /Task assignment/);
  assert.match(messaging, /create table public\.message_threads/);
  assert.match(messaging, /create table public\.messages/);
});

test("attached EHR documents drive intake and hospital service gaps", async () => {
  const intake = await read("supabase/migrations/20260827173500_document_gap_clinical_intake.sql");
  const services = await read("supabase/migrations/20260827174500_complete_major_hospital_services.sql");
  const live = await read("live.js");
  for (const entity of ["patient_contact_methods","insurance_organizations","vital_sign_observations","care_queue_entries","encounter_contributors","ambulance_transports","prenatal_episodes","data_export_audit"]) assert.match(intake,new RegExp(entity));
  assert.match(live,/Military Dependent/);
  assert.match(live,/preferred_language/);
  assert.match(live,/patient_contact_methods/);
  assert.match(live,/service_affiliation_catalog/);
  assert.match(live,/service_rank_custom/);
  assert.match(services,/Primary Care & Ambulatory Services/);
  assert.match(services,/Institutional Review Board \(IRB\)/);
  assert.match(services,/Sterile Processing Department \(SPD\)/);
});

test("core clinical screens use live CRUD instead of prototype-only actions", async () => {
  const live = await read("live.js");
  const app = await read("app.js");
  const policies = await read("supabase/migrations/20260827193000_secure_core_clinical_crud.sql");
  for(const form of ["encounterForm","orderForm","medicationOrderForm","noteForm"]) assert.match(live,new RegExp(`function ${form}`));
  for(const table of ["encounters","orders","medication_orders","clinical_notes"]) assert.match(live,new RegExp(`from\\(\\\"${table}\\\"\\)`));
  assert.match(app,/"Open encounter"/);
  assert.match(policies,/private\.can_write_patient_record/);
  assert.match(policies,/private\.is_aal2\(\)/);
  assert.match(live,/function hydrateDashboard/);
  assert.match(live,/Live operational data/);
});
