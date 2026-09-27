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
  // S6: new accounts are invited by email; no shared or administrator-visible password exists.
  assert.match(createUser, /inviteUserByEmail/);
  assert.doesNotMatch(createUser, /Temp#123|temporary_password/);
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
    assert.doesNotMatch(source,/aal\.currentLevel==="aal2"\|\|sessionVerified/);
    assert.match(source,/persistMfaSession\(supabase,result\)/);
    assert.match(source,/supabase\.auth\.setSession\(\{access_token:result\.data\.access_token,refresh_token:result\.data\.refresh_token\}\)/);
    assert.match(source,/assurance\.data\.currentLevel==="aal2"/);
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
  // S8: the shared department/service catalog is Root-only.
  assert.match(live,/const canManageCatalog=currentRoleCode==="root";/);
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

test("sign in accepts account email, international phone, or explicit username and MFA navigation is honest", async () => {
  const live = await read("live.js");
  const portal = await read("portal.js");
  const mobile = await read("mobile-patient/www/portal.js");
  const mfa = await read("portal-features.js");
  const createUser = await read("supabase/functions/create-user/index.ts");
  const createFacility = await read("supabase/functions/create-facility/index.ts");
  for (const source of [live,portal,mobile]) {
    assert.match(source,/Email, phone \(\+country code\), or username/i);
    assert.match(source,/(?:identifier|value)\.includes\("@"\)/);
    assert.match(source,/sign-in-username/);
    assert.match(source,/supabase\.auth\.setSession/);
    assert.match(source,/\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/);
    assert.match(source,/Invalid login credentials/);
  }
  assert.match(createUser,/phone_confirm:true/);
  assert.match(createFacility,/phone:ownerPhone/);
  assert.match(await read("supabase/functions/create-user/index.ts"),/existing_account:Boolean\(existingUserId\)/);
  assert.match(portal,/This email or phone are already in use/);
  assert.match(await read("portal-features.js"),/List of all staff/);
  assert.match(await read("portal-features.js"),/Suspend until specific date/);
  assert.match(await read("portal-features.js"),/Permanently deny access/);
  assert.match(await read("portal-features.js"),/convertStaffCreationToDirectory/);
  assert.match(await read("portal-features.js"),/Create new staff/);
  assert.match(await read("portal-features.js"),/Physicians & Surgeons/);
  assert.match(await read("portal-features.js"),/Environmental Services \(EVS\)/);
  assert.match(await read("portal-features.js"),/Profile and credential information/);
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

test("Healthcarology admin assigns health-department authority and women health records prenatal and partograph data", async()=>{
  const portal=await read("portal-features.js"),migration=await read("supabase/migrations/20260829213000_health_department_maternal_health.sql"),fn=await read("supabase/functions/create-health-department/index.ts");
  for(const text of ["ehr.healthcarology.com/admin","Create health department","authority_level","Audit tools","Accounts and analytics","renderMaternalHealth","Prenatal visit","partograph_observations"])assert.match(portal,new RegExp(text,"i"));
  for(const table of ["health_department_rules","partographs","partograph_observations"])assert.match(migration,new RegExp(`create table public.${table}`));
  assert.match(migration,/enforce_female_prenatal_patient/);assert.match(fn,/Healthcarology Root access required/);assert.match(fn,/health_department_admin/);
});

test("one account selects an isolated facility context and patient changes remain attributable",async()=>{
  const live=await read("live.js"),migration=await read("supabase/migrations/20260829233000_multifacility_context_and_immutable_history.sql"),theme=await read("theme.css");
  for(const text of ["facilityChoiceGate","ACTIVE_FACILITY_KEY","active_facility_context","patient_intake_drafts","openDeletedRecordHistory","deleted_by_name"])assert.match(live,new RegExp(text));
  for(const table of ["active_facility_context","patient_intake_drafts","deleted_record_archive","record_change_audit"])assert.match(migration,new RegExp(`create table public.${table}`));
  assert.match(migration,/private\.is_active_facility/);assert.match(migration,/archive_record_change/);assert.match(theme,/\.deleted-history/);
});

test("health departments are created as a facility type with bounded aggregate-only reporting and country phone codes",async()=>{
  const features=await read("portal-features.js"),live=await read("live.js"),migration=await read("supabase/migrations/20260830003000_health_department_facility_flow.sql"),codes=JSON.parse(await read("assets/country-calling-codes.json"));
  assert.match(features,/<option>Health Department<\/option>/);assert.match(features,/health-department-modal/);assert.match(features,/province_name/);assert.match(features,/city_name/);
  assert.match(features,/aggregate reporting only/);assert.match(migration,/private\.jurisdiction_contains/);assert.doesNotMatch(migration,/patients/);
  assert.match(live,/patient-calling-code/);assert.ok(codes.length>=240);assert.ok(codes.some(x=>x.iso2==="CD"&&x.calling_code==="+243"));
});

test("facility creation uses structured names and geography, optional URLs, select-all controls, and actionable function errors",async()=>{
  const features=await read("portal-features.js"),fn=await read("supabase/functions/create-facility/index.ts"),live=await read("live.js");
  for(const marker of ['splitNameField\\(facilityForm,"owner_name","owner"','splitNameField\\(facilityForm,"emergency_contact_name","emergency_contact"',"state_province_custom","city_name_custom","Other / not listed","Select all","functionErrorMessage"])assert.match(features,new RegExp(marker,"i"));
  assert.match(fn,/body\.slug\|\|body\.name/);assert.match(fn,/existingProfile/);assert.match(fn,/existing_account/);assert.match(fn,/emergencyPhone/);
  assert.match(live,/first_name/);assert.match(live,/middle_name/);assert.match(live,/last_name/);assert.match(live,/phone_calling_code/);
});

test("insurance access requests use the private facility authorization helper",async()=>{
  const migration=await read("supabase/migrations/20260830150000_insurance_facility_access.sql");
  assert.match(migration,/private\.is_facility_member\(target_insurance_facility\)/);
  assert.doesNotMatch(migration,/public\.private\./);
});

test("admin lists real facilities with portal links and location filters",async()=>{
  const portal=await read("portal.js"),migration=await read("supabase/migrations/20260831010000_platform_agents_list_facilities.sql");
  for(const field of ['name="name" type="search"','name="state" type="search"','name="city" type="search"','name="country" type="search"','name="postal_code" type="search"'])assert.match(portal,new RegExp(field));
  for(const column of ["city_name","state_province","postal_code","country_name"])assert.match(portal,new RegExp(column));
  assert.match(portal,/facility-name-link/);assert.match(portal,/Facilities could not be loaded/);assert.match(portal,/Showing \$\{shown\.length\} of \$\{facilities\.length\} facilities/);
  for(const table of ["facility_clients","facility_client_members","facility_client_facilities"])assert.match(migration,new RegExp(`create table public\\.${table}`));
  assert.match(migration,/private\.can_view_facility_directory\(id\)/);assert.match(migration,/private\.jurisdiction_contains\(hm\.jurisdiction_id,fj\.jurisdiction_id\)/);
  assert.match(migration,/private\.current_role_code\(\)='sysadmin'/);
  assert.match(migration,/cm\.user_id=\(select auth\.uid\(\)\) and cm\.active/);
  const features=await read("portal-features.js");assert.match(features,/Facilities in your jurisdiction/);assert.match(features,/Client facility group/);assert.match(features,/facility-name-link/);
});

test("role lookup cannot recurse through user_roles RLS", async () => {
  const migration=await read("supabase/migrations/20260828020000_stop_role_policy_recursion.sql");
  assert.match(migration,/private\.current_role_code\(\)/);
  assert.match(migration,/security definer/);
  assert.match(migration,/public\.current_role_code\(\)/);
  assert.match(migration,/security invoker/);
  assert.match(migration,/revoke all on function private\.current_role_code\(\) from public,anon/);
});

test("facility departments link to their activated services", async () => {
  const desktop=await read("portal.js"),mobile=await read("mobile-patient/www/portal.js");
  for(const source of [desktop,mobile]){
    assert.match(source,/facility_services\(services\(id,name,department_id\)\)/);
    assert.match(source,/Active Departments &amp; Services/);
    assert.match(source,/data-department-services-link/);
    assert.match(source,/data-service-providers-link/);
    assert.match(source,/data-provider-calendar/);
    assert.match(source,/No activated services in this department/);
    assert.match(source,/No provider available for this service/);
    assert.match(source,/No available appointments for this provider/);
    assert.match(source,/provider_availability_slots/);
    assert.match(source,/wireDepartmentServiceLinks\(app,f\)/);
  }
});

test("staff access management is restricted to a shared administrative scope", async () => {
  const fn=await read("supabase/functions/manage-staff/index.ts");
  assert.match(fn,/Facility or health-department scope is required/);
  assert.match(fn,/Staff account is not assigned to this facility/);
  assert.match(fn,/Staff account is not assigned to this health department/);
  assert.match(fn,/Root account access cannot be changed here/);
  assert.match(fn,/Administrators cannot suspend or deny their own access/);
  assert.match(fn,/isSelf&&\(body\.access_permanently_denied\|\|body\.access_suspended_until\)/);
});

test("staff profile popup has an explicit non-submit close control", async () => {
  for(const file of ["portal-features.js","mobile-patient/www/portal-features.js"]){
    const source=await read(file);
    assert.match(source,/<button type="button" class="button secondary" data-close-staff-profile>Close<\/button>/);
    assert.match(source,/querySelector\('\[data-close-staff-profile\]'\)\.onclick=\(\)=>modal\.close\(\)/);
  }
});

test("staff popup loads and updates the protected full professional profile", async () => {
  const migration=await read("supabase/migrations/20260831210000_staff_professional_profiles.sql"),fn=await read("supabase/functions/manage-staff/index.ts");
  assert.match(migration,/create table if not exists public\.staff_professional_profiles/);
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.staff_professional_profiles from public,anon,authenticated/);
  for(const field of ["legal_name","date_of_birth","languages_spoken","npi","state_licenses","education","clinical_specialties","accepted_insurance","hospital_privileges","scheduling_logic"])assert.match(migration,new RegExp(field));
  assert.match(fn,/body\.action==="get"/);
  assert.match(fn,/staff_professional_profiles/);
  assert.match(fn,/professionalFields/);
  assert.match(fn,/jurisdictionVisibleFields/);
  assert.match(fn,/Facility owner access required/);
  assert.match(fn,/delete visibleProfessional\[field\]/);
  for(const file of ["portal-features.js","mobile-patient/www/portal-features.js"]){
    const source=await read(file);
    assert.match(source,/staffFullProfileFields/);
    assert.match(source,/action:'get'/);
    assert.match(source,/Personal and demographic information/);
    assert.match(source,/Education, practice, and credentials/);
  }
});

test("patient admission links bed capacity and inpatient billing without invented clinical data", async()=>{
  const app=await read("app.js"),live=await read("inpatient.js"),migration=await read("supabase/migrations/20260901010000_inpatient_admission_bed_billing.sql");
  for(const module of ["Patient admission","Bed management","Inpatient billing"])assert.match(app,new RegExp(module));
  for(const table of ["inpatient_admissions","inpatient_beds","inpatient_bed_assignments","inpatient_accounts","inpatient_charge_items","inpatient_claims","inpatient_claim_adjudications"])assert.match(migration,new RegExp(`create table public\\.${table}`));
  assert.match(migration,/one_active_patient_per_bed/);assert.match(migration,/one_active_bed_per_admission/);
  assert.match(migration,/create or replace function public\.admit_inpatient/);assert.match(migration,/security invoker/);
  assert.match(migration,/create or replace function public\.discharge_inpatient/);assert.match(migration,/operational_status='needs_cleaning'/);assert.match(migration,/status='ready_to_claim'/);
  assert.match(migration,/enable row level security/);assert.match(migration,/grant select,insert,update,delete/);
  for(const feature of ["Admit and assign bed","Level of care","Isolation requirement","NUBC Revenue Code","Prepare institutional claim","data-next-status"])assert.match(live,new RegExp(feature));
  assert.doesNotMatch(live,/John Edward Smith|Blue Cross Blue Shield PPO|3500\.00|2800\.00|700\.00/);
});

test("dialysis management adapts to the facility setting selected when Nephrology is activated",async()=>{
  const migration=await read("supabase/migrations/20260901020000_dialysis_management.sql"),features=await read("portal-features.js"),mobile=await read("mobile-patient/www/portal-features.js"),fn=await read("supabase/functions/create-facility/index.ts");
  for(const value of ["freestanding_outpatient","inpatient_hospital_unit","home_therapies"])for(const source of [migration,features,fn])assert.match(source,new RegExp(value));
  for(const table of ["facility_dialysis_profiles","dialysis_outpatient_chair_sessions","dialysis_inpatient_acute_sessions","dialysis_home_therapy_logs","dialysis_device_observations"])assert.match(migration,new RegExp(`create table public\\.${table}`));
  for(const field of ["kt_v","urr_percent","dry_weight_kg","blood_pump_speed_ml_min","arterial_pressure_mmhg","venous_pressure_mmhg"])assert.match(migration,new RegExp(field));
  assert.match(migration,/enable row level security/);assert.match(migration,/revoke all/);assert.match(migration,/grant select,insert,update/);
  assert.match(features,/Nephrology activated/);assert.match(features,/Will this facility have a dialysis center/);assert.match(features,/Changing the center type updates this workspace/);
  assert.match(features,/Freestanding outpatient center/);assert.match(features,/Inpatient hospital unit/);assert.match(features,/Home therapies/);
  assert.equal(features,mobile);
  for(const source of [migration,features])assert.doesNotMatch(source,/John Edward Smith|Fresenius|DaVita/);
});

test("dialysis billing uses the supplied revenue CPT and HCPCS catalog and permits facility-scoped other items",async()=>{
  const migration=await read("supabase/migrations/20260901111305_dialysis_billable_item_catalog.sql"),features=await read("portal-features.js"),mobile=await read("mobile-patient/www/portal-features.js");
  for(const code of ["0821","0829","0831","0841","0851","0881","0809","90960","90961","90962","90935","90937","90945","90999","G0491","J0882","J0885","Q5105","J0606","J1644","J2997"])assert.match(migration,new RegExp(`'${code}'`));
  assert.match(migration,/create table public\.dialysis_billable_items/);assert.match(migration,/create table public\.dialysis_session_billable_items/);
  assert.match(migration,/facility_id is null or private\.is_platform_root\(\) or private\.is_facility_member\(facility_id\)/);
  assert.match(migration,/private\.is_facility_admin\(facility_id\)/);assert.match(migration,/enable row level security/);assert.match(migration,/revoke all/);
  for(const text of ["Dialysis billable items","Other — create missing item","Related revenue codes","Billable item added to the dialysis session"])assert.match(features,new RegExp(text));
  assert.equal(features,mobile);
});

test("blood bank page implements the document-defined vein-to-vein safety workflow without seeding examples",async()=>{
  const app=await read("app.js"),live=await read("live.js"),module=await read("blood-bank.js"),migration=await read("supabase/migrations/20260901115502_blood_bank_management.sql");
  assert.match(app,/Blood bank management/);assert.match(app,/blood-drive/);assert.match(app,/blood-reaction-specimen/);
  assert.match(live,/attachBloodBankFeatures/);assert.match(live,/\.\/blood-bank\.js/);
  for(const table of ["blood_donors","blood_mobile_drives","blood_donor_screenings","blood_donations","blood_storage_devices","blood_products","blood_product_tests","blood_temperature_observations","blood_crossmatches","blood_transfusions","blood_transfusion_reactions","blood_reaction_specimens"])assert.match(migration,new RegExp(`create table public\\.${table}`));
  for(const term of ["donation_identification_number","product_component_code","abo_group","rh_type","processing_modifiers","electronic","serologic","bedside_verification","vital_signs"])assert.match(migration,new RegExp(term));
  assert.match(migration,/lock_blood_storage_on_temperature_breach/);assert.match(migration,/product_status='quarantined'/);assert.match(migration,/split_blood_product/);assert.match(migration,/security invoker/);
  assert.match(migration,/enable row level security/);assert.match(migration,/private\.is_aal2\(\)/);assert.match(migration,/revoke all/);
  for(const action of ["blood-donor","blood-drive","blood-screening","blood-product","blood-test","blood-component","blood-storage","blood-temperature","blood-crossmatch","blood-transfusion","blood-reaction","blood-reaction-specimen"])assert.match(module,new RegExp(action));
  assert.doesNotMatch(module,/Jane Doe|Alex Mercer|Sarah Jenkins|American Red Cross|W000026123456|E3824|E0414/);
});

test("patient intake uses dependent geography, an ISO language list, and authoritative registry codes",async()=>{
  const live=await read("live.js");
  assert.match(live,/patient-preferred-language/);assert.match(live,/iso-639-1-languages\.json/);
  assert.match(live,/patient-province/);assert.match(live,/patient-city/);assert.match(live,/data-registry-code/);
  assert.match(live,/approved location records/);
});

test("encounters route to triage by default and imaging exams are filtered by imaging type",async()=>{
  const live=await read("live.js"),migration=await read("supabase/migrations/20260901133000_patient_triage_and_imaging_types.sql");
  assert.match(live,/enqueue_patient_for_triage/);assert.match(live,/Patient sent to triage/);
  assert.match(live,/data-imaging-type/);assert.match(live,/Select imaging type/);
  assert.match(migration,/add column if not exists imaging_type/);assert.match(migration,/nextval\('public\.triage_arrival_seq'\)/);
});
test("all facilities receive a chargemaster Billing Department with duplicate and inflated-price checks",async()=>{
  const feature=await read("billing-department.js"),portal=await read("portal-features.js"),migration=await read("supabase/migrations/20260907170141_facility_chargemaster_billing_department.sql");
  assert.match(feature,/Billing Department/);assert.match(feature,/Revenue Code/);assert.match(feature,/Charge Code \/ Item Number/);assert.match(feature,/Units of Service/);assert.match(feature,/Billed Charge/);
  assert.match(feature,/data-price-item/);assert.match(feature,/Save price/);assert.match(feature,/update\(\{unit_price:unitPrice/);
  assert.match(portal,/renderBillingDepartment\(supabase,app,facilityId\)/);assert.match(portal,/renderBillingDepartment\(supabase,app,facility\.id\)/);
  assert.match(migration,/create table public\.facility_chargemaster_items/);assert.match(migration,/create table public\.facility_charge_lines/);assert.match(migration,/new\.duplicate_charge=exists/);assert.match(migration,/new\.billed_charge>new\.expected_charge/);assert.match(migration,/enable row level security/);
});

test("supplied laboratory workbooks populate ordering and facility billing setup without invented prices",async()=>{
  const migration=await read("supabase/migrations/20260907214544_laboratory_workbook_catalog.sql"),billing=await read("billing-department.js"),laboratory=await read("laboratory-department.js"),features=await read("portal-features.js");
  assert.match(migration,/create table public\.laboratory_exam_catalog/);
  assert.match(migration,/source_workbook text not null/);
  assert.match(migration,/source_row integer not null/);
  assert.match(migration,/insert into public\.clinical_order_catalog/);
  assert.match(migration,/add column laboratory_exam_catalog_id/);
  for(const file of ["anatomic_pathology_examens_reference_ranges.xlsx","blood_bank_examens_reference_ranges.xlsx","blood_bank_transfusion_services_reference_ranges.xlsx","chemistry_lab_examens_reference_ranges.xlsx","clinical_laboratory_examens_reference_ranges.xlsx","complete_cytology_billing_codes.xlsx","core_lab_examens_reference_ranges.xlsx","genetic_testing_billing_codes.xlsx"])assert.match(migration,new RegExp(file.replaceAll(".","\\.")));
  assert.match(billing,/Laboratory billable-item setup/);
  assert.match(billing,/do not contain revenue codes, units of service, or facility prices/);
  assert.match(billing,/laboratory_exam_catalog_id/);
  assert.match(laboratory,/186 source rows|exams\?\.length/);
  assert.match(laboratory,/must be validated by the performing laboratory/);
  assert.match(features,/renderLaboratoryDepartment/);
});

test("all authenticated portals use the shared responsive left-sidebar shell",async()=>{
  const portal=await read("portal.js"),features=await read("portal-features.js"),theme=await read("theme.css");
  assert.match(portal,/portal app-shell/);assert.match(portal,/portal-global-sidebar/);
  assert.match(portal,/portal-topbar/);assert.match(portal,/portal-menu-toggle/);
  assert.match(features,/portal-global-sidebar \.portal-section-nav/);
  assert.match(features,/portal-menu-open/);assert.match(features,/portal-sidebar/);
  assert.match(theme,/\.portal\.app-shell/);
  assert.match(theme,/grid-template-columns:260px minmax\(0,1fr\)/);
  assert.match(theme,/\.portal-global-sidebar/);assert.match(theme,/text-align:left/);
  assert.match(theme,/linear-gradient\(180deg,#0b4fad/);assert.match(theme,/background:#3372c8/);
  assert.match(theme,/transform:translateX\(-105%\)/);
});

test("staff and facility settings have grouped sidebar landing pages",async()=>{
  const features=await read("portal-features.js"),mobile=await read("mobile-patient/www/portal-features.js"),theme=await read("theme.css");
  for(const title of ["Staff","Facilities","List of all staff","Staff scheduling","My staff profile","Task assignment","Client facility group","Facility branding","Facility subscription"])assert.match(features,new RegExp(title));
  assert.match(features,/portal-group-landing/);assert.match(features,/portal-group-grid/);
  assert.match(features,/entries\.forEach/);assert.match(theme,/\.portal-group-grid/);
  assert.equal(features,mobile);
});

test("staff workspace uses expandable tiles, scoped assignment, teams, pictures, and calculated base pay",async()=>{
  const features=await read("portal-features.js"),createUser=await read("supabase/functions/create-user/index.ts"),manageStaff=await read("supabase/functions/manage-staff/index.ts"),migration=await read("supabase/migrations/20260908143000_staff_primary_service.sql");
  for(const term of ["staff-tool-tile","Filter staff before selection","Create a Team","facility_staff_team_members","profile_photo","base_pay_type","Hourly Rate","Base Salary","Estimated regular gross pay"])assert.match(features,new RegExp(term));
  assert.match(features,/department\.required=true/);assert.match(features,/service\.required=/);
  assert.match(createUser,/primary department is required/);assert.match(createUser,/basePayAmount/);assert.match(createUser,/baseHourlyRate/);assert.match(createUser,/baseSalary/);
  assert.match(manageStaff,/primary_service/);assert.match(migration,/add column if not exists primary_service/);
});

test("facility departments tile owns activated specialty workspaces and separates nephrology services",async()=>{
  const features=await read("portal-features.js"),mobile=await read("mobile-patient/www/portal-features.js"),migration=await read("supabase/migrations/20260908161500_nephrology_dialysis_services.sql");
  assert.match(features,/List of Departments/);assert.match(features,/departmentPanel/);
  assert.match(features,/Laboratory Department/);assert.match(features,/Dialysis management/);
  assert.match(features,/Women.s health/);assert.match(features,/department-workspace/);
  assert.match(features,/group\.title==="Staff"\|\|group\.title==="Facilities"/);
  assert.match(migration,/\('Nephrology'\),\('Dialysis'\)/);
  assert.match(migration,/insert into public\.facility_services/);
  assert.equal(features,mobile);
});

test("appointments use filterable week or month calendars with retained cancellation and rescheduling",async()=>{
  const calendar=await read("appointment-calendar.js"),mobile=await read("mobile-patient/www/appointment-calendar.js"),features=await read("portal-features.js"),migration=await read("supabase/migrations/20260908183000_appointment_calendar_management.sql");
  for(const term of ["Weekly","Monthly","All departments","All services","All providers","Modify","Cancel appointment","notify_if_sooner","Notify me if a sooner appointment becomes available"])assert.match(calendar,new RegExp(term));
  assert.match(calendar,/appointment\.status="cancelled"/);assert.match(calendar,/cancel_appointment_keep_calendar/);assert.match(calendar,/reschedule_appointment/);
  assert.match(features,/renderAppointmentCalendar/);assert.match(features,/enhancePatientAppointmentNotification/);
  assert.match(migration,/add column if not exists notify_if_sooner/);assert.match(migration,/status='cancelled'/);assert.match(migration,/starts_at>now\(\)/);
  assert.equal(calendar.trim(),mobile.trim());
});

test("daily opted-in sooner-appointment checks create facility notifications",async()=>{
  const module=await read("facility-notifications.js"),mobile=await read("mobile-patient/www/facility-notifications.js"),features=await read("portal-features.js"),migration=await read("supabase/migrations/20260908194500_daily_sooner_appointment_notifications.sql");
  assert.match(features,/renderFacilityNotifications/);assert.match(module,/<h2>Notifications<\/h2>/);
  assert.match(module,/patients\(first_name,last_name\)/);assert.match(module,/Mark read/);
  assert.match(migration,/create extension if not exists pg_cron/);assert.match(migration,/appointment\.notify_if_sooner/);
  assert.match(migration,/interval '48 hours'/);assert.match(migration,/candidate\.provider_id=appointment\.provider_id/);
  assert.match(migration,/0 6 \* \* \*/);assert.match(migration,/unique\(appointment_id,available_slot_id,notification_type\)/);
  assert.match(migration,/enable row level security/);assert.match(migration,/private\.is_facility_member\(facility_id\)/);
  assert.equal(module.trim(),mobile.trim());
});

test("searchable lists begin live filtering at three characters on desktop and mobile",async()=>{
  const app=await read("app.js"),live=await read("live.js"),portal=await read("portal.js"),features=await read("portal-features.js"),billing=await read("billing-department.js"),laboratory=await read("laboratory-department.js");
  assert.match(app,/globalSearch\.addEventListener\("input"/);assert.match(app,/q\.length<3/);
  assert.match(live,/search\.minLength=3/);assert.match(live,/term\.length<3/);
  assert.match(portal,/term\.length>0&&term\.length<3/);
  assert.match(features,/minimumSearchLength='3'/);assert.match(features,/term\.length<3\|\|!row\.dataset\.searchText\.includes\(term\)/);
  assert.match(billing,/raw\.length>=3/);assert.match(laboratory,/tooShort=query\.length>0&&query\.length<3/);
  for(const file of ["portal.js","portal-features.js","billing-department.js","laboratory-department.js"]){
    assert.equal(await read(file),await read(`mobile-patient/www/${file}`));
  }
});

test("staff creation supports multiple groups and roles with reusable contact details",async()=>{
  const features=await read("portal-features.js"),mobile=await read("mobile-patient/www/portal-features.js"),createUser=await read("supabase/functions/create-user/index.ts"),styles=await read("staff-facility-tiles.css");
  for(const term of ['Staff groups and types','multiple size="8"','staff_groups_json','staff_subgroups_json','role_codes_json','data-copy-contact="email"','data-copy-contact="phone"'])assert.match(features,new RegExp(term));
  assert.match(createUser,/roleCodes=stringList/);assert.match(createUser,/user_roles"\)\.upsert\(\(roles\|\|\[\]\)\.map/);
  assert.match(createUser,/staff_group:staffGroups\.join/);assert.match(createUser,/staff_subgroup:staffSubgroups\.join/);
  assert.match(styles,/same-contact-control/);assert.equal(features,mobile);
});

test("staff language search saves and closes while staff identity and assignments support multiples",async()=>{
  const features=await read("portal-features.js"),mobile=await read("mobile-patient/www/portal-features.js"),css=await read("portal.css"),mobileCss=await read("mobile-patient/www/portal.css"),app=await read("app.js");
  for(const term of ['data-language-results','data-language-save','Save languages','data-search-text','dropdown.open=false','staff-directory-photo','staff-language-badge','Job Titles','Primary Departments','Primary Services'])assert.match(features,new RegExp(term));
  assert.match(features,/job_title" multiple/);assert.match(features,/data-primary-department multiple/);assert.match(features,/data-primary-service multiple/);
  assert.match(css,/\[data-language-row\]\[hidden\]\{display:none!important\}/);assert.match(app,/globalSearch\.addEventListener\("focusout"/);
  assert.equal(features,mobile);assert.equal(css,mobileCss);
});

test("phase 1 adds allergies, enforced prescribing safety, append-only eMAR, and immunizations", async () => {
  const migration=await read("supabase/migrations/20260927120000_phase1_allergies_medication_safety_emar_immunizations.sql");
  const js=await read("live.js");
  for(const table of ["patient_allergies","medication_safety_overrides","immunizations"]){
    assert.match(migration,new RegExp(`create table public\.${table}`));
    assert.match(migration,new RegExp(`alter table public\.${table} enable row level security`));
  }
  for(const table of ["patient_allergies","immunizations"])assert.match(migration,new RegExp(`create policy mfa_required on public\.${table} as restrictive`));
  assert.match(migration,/create trigger enforce_medication_safety before insert on public\.medication_orders/);
  assert.match(migration,/An override reason is required to prescribe/);
  assert.match(migration,/no interaction content is seeded here/);
  assert.doesNotMatch(migration,/insert into public\.medication_interactions/);
  assert.match(migration,/grant select,insert on public\.medication_administrations/);
  assert.doesNotMatch(migration,/grant[^;]*update[^;]*public\.medication_administrations/);
  assert.match(migration,/Immunization records are permanent/);
  assert.match(js,/rpc\("medication_safety_check"/);
  assert.match(js,/Safety check unavailable, so the order was not saved/);
  assert.match(js,/No allergies recorded\. This is not the same as “no known allergies”/);
  for(const hook of ["data-add-allergy","data-add-immunization","data-emar","data-emar-correct"])assert.match(js,new RegExp(hook));
});

test("S4: shared records honour the share period everywhere and the password is never sent with the link", async () => {
  const fn=await read("supabase/functions/shared-record/index.ts"),portal=await read("portal-features.js");
  for(const [table,column] of [["diagnoses","onset_at"],["encounters","start_at"],["medication_orders","start_at"],["orders","created_at"],["clinical_notes","created_at"]]){
    const call=fn.slice(fn.indexOf(`within(admin.from("${table}")`));
    assert.ok(fn.includes(`within(admin.from("${table}")`),`${table} is filtered by the share period`);
    assert.ok(call.slice(0,call.indexOf(";")).includes(`"${column}")`),`${table} uses ${column}`);
  }
  assert.match(portal,/Send the link and the password separately/);
  assert.doesNotMatch(portal,/navigator\.share\([^)]*temporary_password/);
});

test("clinical notes, order sets, templates, and duplicate-order warnings are wired into the staff app", async () => {
  const js=await read("live.js"),notes=await read("supabase/migrations/20260927140000_clinical_notes_providers.sql"),content=await read("supabase/migrations/20260927150000_order_sets_note_templates.sql");
  assert.match(notes,/create trigger ensure_clinical_provider/);
  assert.match(notes,/Signed notes cannot be changed/);
  assert.match(notes,/drop policy if exists clinical_notes_author_insert/);
  assert.match(content,/No clinical content is seeded/);
  assert.doesNotMatch(content,/insert into public\.(note_templates|order_sets|order_set_items)/);
  for(const fn of ["findDuplicateOrders","placeOrders","manageNoteTemplates","manageOrderSets"])assert.match(js,new RegExp(`async function ${fn}`));
  assert.match(js,/Possible duplicate orders/);
  assert.match(js,/from\("note_templates"\)/);
  assert.match(js,/from\("order_sets"\)/);
});

test("S5-S8 and the audit log are wired into the database and the staff app", async () => {
  const migration=await read("supabase/migrations/20260927160000_security_mfa_privacy_scoping_audit.sql"),live=await read("live.js"),app=await read("app.js");
  for(const fn of ["create-user","create-facility","create-health-department"]){const source=await read(`supabase/functions/${fn}/index.ts`);assert.match(source,/inviteUserByEmail/);assert.doesNotMatch(source,/temporary_password/)}
  assert.match(migration,/must_change_password'\),'false'\)<>'true'/);
  assert.match(migration,/audit_log_is_append_only/);
  assert.match(migration,/values\(first_part,last_part,'active','account_bootstrap',null\)/);
  assert.match(live,/rpc\("log_patient_record_view"/);
  assert.match(live,/from\("audit_logs"\)/);
  assert.doesNotMatch(app,/Signed-in user · Clinical EHR/,"the fake audit rows are gone");
});

test("phase 2: admissions, transfers, room charges, claims and payer responses are wired into the inpatient screens", async () => {
  const js=await read("inpatient.js"),migration=await read("supabase/migrations/20260927170000_inpatient_adt_beds_billing_completion.sql");
  for(const rpc of ["admit_inpatient","transfer_inpatient_bed","discharge_inpatient","post_inpatient_room_charges","create_inpatient_claim","record_inpatient_claim_adjudication"])assert.ok(js.includes(`rpc("${rpc}"`),`${rpc} is called`);
  assert.match(js,/triage_bypass_reason/);assert.match(js,/placement_override_reason/);assert.match(js,/data-bed-room-charge/);assert.match(js,/chargemaster_item_id/);
  assert.doesNotMatch(js,/from\("inpatient_claims"\)\.insert/,"claims are created only through the database function");
  assert.match(migration,/no invented prices/);assert.doesNotMatch(migration,/insert into public\.facility_chargemaster_items/);
});

test("phase 2: discharge summaries and medication reconciliation are wired into the admission screen", async () => {
  const js=await read("inpatient.js"),migration=await read("supabase/migrations/20260927180000_medication_reconciliation_discharge_summary.sql");
  for(const rpc of ["pending_discharge_reconciliation","reconcile_inpatient_medication"])assert.ok(js.includes(`rpc("${rpc}"`),`${rpc} is called`);
  assert.ok(js.includes("data-discharge-summary"));assert.ok(js.includes('from("inpatient_discharge_summaries")'));
  assert.ok(migration.includes("Reconcile these medications before discharge"));assert.ok(migration.includes("A signed discharge summary cannot be changed"));
});
