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
  assert.match(features, /Google Authenticator/);
  assert.match(features, /Microsoft Authenticator/);
  assert.match(features, /Oracle Mobile Authenticator/);
  assert.match(features, /auth\.refreshSession\(\)/);
  assert.match(features, /Your session has expired/);
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

test("first-login MFA presents supported choices before enrollment", async () => {
  const live = await read("live.js");
  const features = await read("portal-features.js");
  const mobile = await read("mobile-patient/www/portal-features.js");
  assert.match(features,/Choose your authentication method/);
  assert.match(features,/Google Authenticator/);
  assert.match(features,/Microsoft Authenticator/);
  assert.match(features,/Oracle Mobile Authenticator/);
  assert.match(features,/factorType:"phone"/);
  assert.match(features,/value="sms"/);
  assert.match(features,/value="whatsapp"/);
  assert.match(features,/body:\{password\}/);
  assert.match(live,/requireMfa\(supabase,document\.body\)/);
  assert.equal(mobile,features);
});

test("MFA can remember the verified browser for exactly 30 days without bypassing AAL2", async () => {
  const features=await read("portal-features.js");
  const mobile=await read("mobile-patient/www/portal-features.js");
  for(const source of [features,mobile]){
    assert.match(source,/Remember this device for 30 days/);
    assert.match(source,/MFA_DEVICE_DAYS=30/);
    assert.match(source,/expiresAt=rememberDevice\?Date\.now\(\)\+MFA_DEVICE_DAYS\*24\*60\*60\*1000:null/);
    assert.match(source,/aal\.currentLevel==="aal2"/);
    assert.match(source,/rememberDevice/);
  }
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

test("clinical orders are destination-specific and use validated interpretation guidance", async () => {
  const live = await read("live.js");
  const theme = await read("theme.css");
  const catalog = await read("supabase/migrations/20260828170000_contextual_clinical_order_catalog.sql");
  assert.match(live,/clinical_order_catalog/);
  assert.match(live,/serviceMatches/);
  assert.match(live,/order-destination/);
  assert.match(live,/Other specialty \/ procedure/);
  assert.match(live,/Range \/ interpretation/);
  assert.match(catalog,/performing laboratory.*validated/i);
  assert.match(catalog,/MedlinePlus/i);
  assert.match(catalog,/Stanford/i);
  assert.match(theme,/result-interpretation\.normal/);
  assert.match(theme,/result-interpretation\.out-of-range/);
  assert.match(theme,/result-interpretation\.dangerously-abnormal/);
});

test("laboratory imaging and specialty orders have live result workflows", async () => {
  const live = await read("live.js");
  const theme = await read("theme.css");
  const migration = await read("supabase/migrations/20260829143000_live_diagnostic_results.sql");
  const labSecurity = await read("supabase/migrations/20260827031007_secure_operational_access.sql");
  assert.match(live,/async function openOrderResult/);
  assert.match(live,/from\("lab_results"\)/);
  assert.match(live,/from\("lab_reference_ranges"\)/);
  assert.match(live,/"imaging_results"/);
  assert.match(live,/"procedure_results"/);
  assert.match(live,/from\(resultTable\)\.insert/);
  assert.match(live,/Awaiting supervisor validation/);
  assert.match(live,/Results remain hidden from prescribers and patients until laboratory-supervisor validation/);
  assert.match(live,/critical low ≤ normal low ≤ normal high ≤ critical high/i);
  assert.match(live,/Imaging and specialty reports use findings and an impression, not laboratory reference ranges/);
  assert.match(migration,/result_status='final' and private\.can_read_patient_record/);
  assert.match(labSecurity,/validation_status='validated'/);
  assert.match(theme,/\.result-record/);
});

test("encounter creation filters alphabetized services by alphabetized department", async () => {
  const live = await read("live.js");
  assert.match(live,/departments\(id,name\)/);
  assert.match(live,/id="encounter-department"/);
  assert.match(live,/id="encounter-service"[^>]+disabled/);
  assert.match(live,/Select department first/);
  assert.match(live,/localeCompare/);
  assert.match(live,/matchingServices=addingDepartment\?\[\]:sortedServices\.filter/);
  assert.match(live,/\["root","sysadmin"\]\.includes\(currentRoleCode\)/);
  assert.match(live,/Other — add new/);
  assert.match(live,/new_department_name/);
  assert.match(live,/new_service_name/);
  assert.match(live,/from\("departments"\)\.insert/);
  assert.match(live,/from\("services"\)\.insert/);
});

test("live patient names open profile or a patient-preselected encounter", async () => {
  const live=await read("live.js");
  const theme=await read("theme.css");
  assert.match(live,/class="patient-name-link" data-live-patient/);
  assert.match(live,/Start new encounter/);
  assert.match(live,/View full patient profile/);
  assert.match(live,/async function patientProfile/);
  for(const section of ["Demographics","Contact and address","Service affiliation","Encounters","Diagnoses","Orders","Medications","Clinical notes"])assert.match(live,new RegExp(section));
  assert.match(live,/encounterForm\(preselectedPatientId=null\)/);
  assert.match(live,/\[name="patient_id"\]'\)\.value=String\(preselectedPatientId\)/);
  assert.match(theme,/\.patient-name-link/);
  assert.match(live,/Pending registry data/);
  assert.match(live,/<td><strong>\$\{safe\(p\.snau/);
  assert.match(live,/renderLivePatientChart/);
  assert.match(live,/event\.detail\?\.view==="chart"/);
});

test("every account receives a non-fabricated patient file and authorized encounters read back", async () => {
  const migration=await read("supabase/migrations/20260828143000_live_patient_files_and_encounter_visibility.sql");
  assert.match(migration,/private\.ensure_account_patient_file/);
  assert.match(migration,/registration_source,facility_id[\s\S]+account_bootstrap/);
  assert.match(migration,/from auth\.users u/);
  assert.match(migration,/insert into public\.patient_accounts/);
  assert.match(migration,/create trigger on_auth_user_created/);
  assert.match(migration,/encounters_authorized_read/);
  assert.match(migration,/private\.can_read_patient_record\(patient_id\)/);
  assert.match(migration,/encounters_patient_start_idx/);
  assert.doesNotMatch(migration,/date_of_birth[^\n]+values/i);
});

test("UNIN follows the registry document and hides the country prefix in patient displays", async () => {
  const app = await read("app.js");
  const live = await read("live.js");
  const migration = await read("supabase/migrations/20260829103000_document_defined_unin.sql");
  assert.match(app,/<th>UNIN<\/th>/);
  assert.match(app,/10L-M192-00003/);
  assert.doesNotMatch(app,/unin:"243-10L/);
  assert.match(live,/Pending registry data/);
  assert.match(live,/unin_province_code/);
  assert.match(live,/unin_commune_code/);
  assert.match(migration,/new\.unin_full=prefix \|\| '-' \|\| new\.snau/);
  assert.match(migration,/new\.snau=new\.unin_province_code \|\| new\.unin_commune_code/);
  assert.match(migration,/right\(extract\(year from new\.date_of_birth\)/);
  assert.match(migration,/where snau like 'HC-%'/);
  assert.match(migration,/UNIN is permanent and cannot be changed/);
});

test("patients enter triage before encounters with complete vitals and an audited bypass", async () => {
  const app = await read("app.js");
  const live = await read("live.js");
  const portal = await read("portal-features.js");
  const createFacility = await read("supabase/functions/create-facility/index.ts");
  const migration = await read("supabase/migrations/20260829170000_required_triage_workflow.sql");
  assert.match(app,/\["triage","♧","Triage"\]/);
  assert.match(live,/async function hydrateTriage/);
  assert.match(live,/async function triageForm/);
  for(const field of ["weight_kg","height_cm","bmi","temperature_c","systolic_bp","diastolic_bp","heart_rate","respiratory_rate","oxygen_saturation","blood_glucose","pain_score","head_circumference_cm","mid_upper_arm_circumference_cm","consciousness_level","pregnancy_status","chief_complaint","allergy_alerts"]) assert.match(live,new RegExp(field));
  assert.match(live,/Assign doctor \/ provider/);
  assert.match(live,/Skip vital signs and go directly to the encounter/);
  assert.match(portal,/Separate triage queues by department/);
  assert.match(createFacility,/triage_mode:triageMode/);
  assert.match(migration,/enqueue_new_patient_for_triage/);
  assert.match(migration,/enforce_triage_before_encounter/);
  assert.match(migration,/Patient must complete triage and vital signs before an encounter can start/);
  assert.match(migration,/This role cannot bypass triage vital signs/);
});

test("stand-alone service facilities use scoped referrals, OTP consent, and inventory visibility", async () => {
  const portal = await read("portal-features.js");
  const live = await read("live.js");
  const theme = await read("theme.css");
  const migration = await read("supabase/migrations/20260827203000_standalone_facility_referrals_and_otp.sql");
  const followup = await read("supabase/migrations/20260827204500_standalone_routing_followup.sql");
  assert.match(portal,/standalonePurpose/);
  assert.match(portal,/Patient-authorized search/);
  assert.match(portal,/Inventory management/);
  assert.match(portal,/My preferred service facilities/);
  assert.match(migration,/external_record_access_requests/);
  assert.match(migration,/issue_patient_access_otp/);
  assert.match(migration,/search_shared_pharmacy_inventory/);
  assert.match(followup,/route_prescription_to_pharmacy_on_file/);
  assert.match(live,/patient-province/);
  assert.match(live,/patient-city/);
  assert.match(live,/const organizationType=type\.includes\("military"\)\?"military":type\.includes\("police"\)\?"police":null/);
  assert.match(theme,/\.live-panel \[hidden\]\{display:none!important\}/);
});

test("sign in accepts account email or international phone and MFA navigation is honest", async () => {
  const live = await read("live.js");
  const portal = await read("portal.js");
  const mobile = await read("mobile-patient/www/portal.js");
  const mfa = await read("portal-features.js");
  const createUser = await read("supabase/functions/create-user/index.ts");
  const createFacility = await read("supabase/functions/create-facility/index.ts");
  for (const source of [live,portal,mobile]) {
    assert.match(source,/Email or phone/i);
    assert.match(source,/identifier\.includes\("@"\)/);
    assert.match(source, /phone:identifier\.replace/);
  }
  assert.match(createUser,/phone_confirm:true/);
  assert.match(createFacility,/phone:ownerPhone/);
  assert.match(mfa,/Only one authentication method is currently connected/);
  assert.match(mfa,/Choose another enrolled method/);
  assert.doesNotMatch(mfa,/id="mfa-back"[^;]+location\.reload/);
});

test("patient form limits dependent fields and uses licensed worldwide geography", async () => {
  const live=await read("live.js");
  const manifest=JSON.parse(await read("assets/geography/manifest.json"));
  const gabon=JSON.parse(await read("assets/geography/GA.json"));
  const benin=JSON.parse(await read("assets/geography/BJ.json"));
  const nigeria=JSON.parse(await read("assets/geography/NG.json"));
  const migration=await read("supabase/migrations/20260828010000_world_geography_text_fallback.sql");
  assert.match(live,/refreshDependent/);
  assert.match(live,/includes\("dependent"\)/);
  assert.match(live,/assets\/geography/);
  assert.equal(manifest.countries.length,250);
  assert.equal(manifest.source,"dr5hn/countries-states-cities-database");
  assert.ok(gabon.states.some(state=>state.name==="Estuaire"));
  assert.ok(benin.states.some(state=>state.name==="Alibori"));
  assert.ok(nigeria.states.some(state=>state.name==="Abia"));
  assert.match(migration,/province_text/);
  assert.match(migration,/city_text/);
});

test("encounters persist SOAP steps, diagnostic ordering, guarded ICD-11 selection, and vital trends", async () => {
  const live=await read("live.js"),migration=await read("supabase/migrations/20260829193000_encounter_workflow_vital_trends.sql"),theme=await read("theme.css");
  for(const field of ["subjective","objective","assessment","plan","physical_exam","presumed_diagnosis"])assert.match(live,new RegExp(field));
  for(const feature of ["openEncounterWorkflow","data-encounter-workflow","data-exam-search","terminology_concepts","Suggested Diagnosis","Definitive Diagnosis","openVitalTrends","data-vital-period"])assert.match(live,new RegExp(feature));
  assert.match(migration,/create table if not exists public\.encounter_clinical_workflows/);
  assert.match(migration,/create table if not exists public\.vital_sign_alert_rules/);
  assert.match(migration,/active boolean not null default false/);
  assert.match(theme,/\.vital-trend/);
});

test("role lookup cannot recurse through user_roles RLS", async () => {
  const migration=await read("supabase/migrations/20260828020000_stop_role_policy_recursion.sql");
  assert.match(migration,/private\.current_role_code\(\)/);
  assert.match(migration,/security definer/);
  assert.match(migration,/public\.current_role_code\(\)/);
  assert.match(migration,/security invoker/);
  assert.match(migration,/revoke all on function private\.current_role_code\(\) from public,anon/);
});
