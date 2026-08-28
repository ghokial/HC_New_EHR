import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { requireMfa } from "./portal-features.js";

const supabase = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const modal = document.querySelector("#live-modal");
let session = null;
let currentProviderId = null;
let currentFacilityId = null;
let currentRoleCode = "";
const safe = value => String(value ?? "—").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
const optionList = (rows, label, empty="Select") => `<option value="">${empty}</option>` + rows.map(row => `<option value="${row.id}">${safe(label(row))}</option>`).join("");

async function loadClinicalContext() {
  if (!session) return;
  const [{data:provider},{data:membership}] = await Promise.all([
    supabase.from("providers").select("id").eq("user_id",session.user.id).maybeSingle(),
    supabase.from("facility_memberships").select("facility_id").eq("user_id",session.user.id).eq("active",true).limit(1).maybeSingle()
  ]);
  currentProviderId=provider?.id||null;
  currentFacilityId=membership?.facility_id||null;
}

async function clinicalChoices() {
  const [{data:patients,error:patientError},{data:services,error:serviceError},{data:medications,error:medicationError}] = await Promise.all([
    supabase.from("patients").select("id,first_name,last_name,snau").order("last_name"),
    supabase.from("services").select("id,name,department_id,departments(id,name)").order("name"),
    supabase.from("medications").select("id,name,generic_name,strength,route").order("name")
  ]);
  const error=patientError||serviceError||medicationError;
  if(error) throw error;
  return {patients:patients||[],services:services||[],medications:medications||[]};
}

const notify = message => {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3200);
};

const closeModal = () => { modal.hidden = true; modal.innerHTML = ""; };
const showModal = (title, body) => {
  modal.innerHTML = `<section class="live-panel"><header><h2>${title}</h2><button class="button secondary" data-close>Close</button></header>${body}</section>`;
  modal.hidden = false;
  modal.querySelector("[data-close]").addEventListener("click", closeModal);
};

function authGate() {
  const gate = document.createElement("div");
  gate.className = "auth-gate";
  gate.innerHTML = `<section class="auth-card"><img class="portal-logo" src="/assets/images/healthcarology-logo.png" alt="Healthcarology"><p class="eyebrow">Secure access</p><h1>Healthcarology EHR</h1><p>Sign in with the email address or international phone number on your account. New accounts must replace their temporary password before accessing the platform.</p><form id="login-form"><label>Language<select id="login-language"><option value="en">English</option><option value="fr">Français</option><option value="am">አማርኛ</option><option value="pt">Português</option><option value="es">Español</option><option value="bn">বাংলা</option><option value="kg">Kikongo</option><option value="lua">Tshiluba</option><option value="sw">Kiswahili</option><option value="ln">Lingála</option></select></label><input type="text" name="identifier" autocomplete="username" placeholder="Authorized email or phone (+country code)" required aria-label="Email or phone number"><input type="password" name="password" autocomplete="current-password" placeholder="Password" required aria-label="Password"><button class="button primary">Sign in</button><button type="button" class="button secondary" id="reset-password">Set or reset password</button></form><p id="auth-message">Authorized users only. All access is auditable.</p></section>`;
  const language=gate.querySelector("#login-language");language.value=localStorage.getItem("hc_locale")||"en";language.addEventListener("change",()=>{localStorage.setItem("hc_locale",language.value);document.documentElement.lang=language.value});
  document.body.append(gate);
  gate.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const identifier=String(form.get("identifier")).trim(),password=form.get("password");
    const credentials=identifier.includes("@")?{email:identifier.toLowerCase(),password}:{phone:identifier.replace(/[\s().-]/g,""),password};
    const { error } = await supabase.auth.signInWithPassword(credentials);
    gate.querySelector("#auth-message").textContent = error ? error.message : "Signed in securely.";
  });
  gate.querySelector("#reset-password").addEventListener("click", async () => {
    const email = gate.querySelector('input[name="identifier"]').value.trim();
    if (!email.includes("@")) { gate.querySelector("#auth-message").textContent = "Password reset links require the email address on your account."; return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href });
    gate.querySelector("#auth-message").textContent = error ? error.message : "Check your email for the secure password link.";
  });
}

function passwordChangeGate() {
  const gate=document.createElement("div");
  gate.className="auth-gate";
  gate.innerHTML=`<section class="auth-card"><p class="eyebrow">Required security step</p><h1>Change temporary password</h1><p>You cannot access patient or administrative data until your temporary password is replaced.</p><form id="password-form"><input type="password" name="password" minlength="12" autocomplete="new-password" placeholder="New password (12+ characters)" required><input type="password" name="confirm" minlength="12" autocomplete="new-password" placeholder="Confirm new password" required><button class="button primary">Change password and continue</button></form><p id="password-message"></p></section>`;
  document.body.append(gate);
  gate.querySelector("form").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=new FormData(event.target); const password=form.get("password");
    if(password!==form.get("confirm")){gate.querySelector("#password-message").textContent="Passwords do not match.";return;}
    const {data,error}=await supabase.functions.invoke("complete-password-change",{body:{password}});
    if(error||data?.error){gate.querySelector("#password-message").textContent=error?.message||data.error;return;}
    await supabase.auth.refreshSession(); location.reload();
  });
}

async function loadCountries(select) {
  const { data, error } = await supabase.from("countries").select("id,iso2,default_name").eq("active",true).order("default_name");
  if (error) throw error;
  select.innerHTML = `<option value="">Select country</option>` + data.map(c => `<option value="${c.id}" data-iso2="${safe(c.iso2)}">${c.default_name} (${c.iso2})</option>`).join("");
}

async function patientForm() {
  const {data:membership}=await supabase.from("facility_memberships").select("facility_id").eq("user_id",session.user.id).eq("active",true).limit(1).maybeSingle();
  showModal("Register patient", `<form id="patient-form"><div class="live-banner">UNIN is generated automatically once and is permanent. MRN belongs to the registering facility.</div><label>Patient type<select name="patient_type" id="patient-type" required><option>Standard Patient</option><option>Military</option><option>Military Dependent</option><option>Police</option><option>Police Dependent</option><option>Public Servant / Fonctionnaire</option><option>Public Servant / Fonctionnaire Dependent</option><option>Personnel CIVIL (PERCI) / Civilian Personnel</option><option>Personnel CIVIL (PERCI) / Civilian Personnel Dependent</option></select></label><label>First name<input name="first_name" required></label><label>Middle name<input name="middle_name"></label><label>Last name<input name="last_name" required></label><label>Facility MRN<input name="mrn"></label><label>Date of birth<input type="date" name="date_of_birth"></label><label>Gender<select name="gender_identity" id="patient-gender"><option value="">Not specified</option><option>Male</option><option>Female</option><option>Other</option></select></label><label id="patient-gender-other" hidden>Other gender<input name="gender_other"></label><label>Ethnicity<select name="ethnicity" id="patient-ethnicity"><option value="">Not specified</option><option>Black</option><option>White</option><option>Arab</option><option>Asian</option><option>Latino</option><option>Other</option></select></label><label id="patient-ethnicity-other" hidden>Other ethnicity<input name="ethnicity_other"></label><label>Preferred language<input name="preferred_language" placeholder="Language"></label><label>Primary phone<div class="phone-grid"><input name="country_calling_code" placeholder="Country code, e.g. +243"><input name="phone" type="tel"></div></label><label>Service / matricule ID<input name="service_identifier"></label><label id="rank-label">Rank / function<select name="service_rank" id="service-rank"><option value="">Select patient type and country</option></select></label><label id="rank-custom-label" hidden>Rank / function not listed<input name="service_rank_custom"></label><label id="unit-label">Unit<select name="service_unit" id="service-unit"><option value="">Select patient type and country</option></select></label><label id="unit-custom-label" hidden>Unit not listed<input name="service_unit_custom"></label><label>Dependent relationship<select name="dependent_relationship"><option value="">Not a dependent</option><option>Spouse</option><option>Child</option><option>Parent</option></select></label><label>Related member name<input name="related_service_member_name"></label><label>Related member service ID<input name="related_service_identifier"></label><label>Country<select name="country_id" id="country-select" required></select></label><label>Address line 1<input name="line1" required></label><label>Postal code<input name="postal_code_text"></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Create patient</button></footer></form>`);
  modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
  await loadCountries(modal.querySelector("#country-select"));
  const dependentLabels=[modal.querySelector('[name="dependent_relationship"]').closest("label"),modal.querySelector('[name="related_service_member_name"]').closest("label"),modal.querySelector('[name="related_service_identifier"]').closest("label")];
  const addressLine=modal.querySelector('[name="line1"]').closest("label");
  const provinceLabel=document.createElement("label"),cityLabel=document.createElement("label"),provinceCustomLabel=document.createElement("label"),cityCustomLabel=document.createElement("label");
  provinceLabel.innerHTML='State / Province<select name="province_text" id="patient-province"><option value="">Select country first</option></select>';
  cityLabel.innerHTML='City<select name="city_text" id="patient-city"><option value="">Select state / province first</option></select>';
  provinceCustomLabel.innerHTML='State / Province not listed<input name="province_text_custom">';provinceCustomLabel.hidden=true;
  cityCustomLabel.innerHTML='City not listed<input name="city_text_custom">';cityCustomLabel.hidden=true;
  addressLine.before(provinceLabel,provinceCustomLabel,cityLabel,cityCustomLabel);
  let geography=null;
  const loadCities=async()=>{const provinceCode=modal.querySelector("#patient-province").value,city=modal.querySelector("#patient-city");if(!geography){city.innerHTML='<option value="">Select country first</option>';return;}const state=geography.states.find(item=>item.code===provinceCode),cities=state?.cities||[];city.innerHTML='<option value="">Select city</option>'+cities.map(item=>`<option value="${safe(item.name)}">${safe(item.name)}</option>`).join("")+'<option value="__other__">Other / not listed</option>';};
  const loadProvinces=async()=>{const country=modal.querySelector("#country-select"),iso2=country.selectedOptions[0]?.dataset.iso2,province=modal.querySelector("#patient-province");if(!iso2){geography=null;province.innerHTML='<option value="">Select country first</option>';await loadCities();return;}try{const response=await fetch(`/assets/geography/${iso2}.json`);if(!response.ok)throw new Error(`Geographic data unavailable for ${iso2}`);geography=await response.json();province.innerHTML='<option value="">Select state / province</option>'+geography.states.map(item=>`<option value="${safe(item.code)}">${safe(item.name)}</option>`).join("")+'<option value="__other__">Other / not listed</option>';await loadCities()}catch(error){geography=null;province.innerHTML='<option value="__other__">Other / not listed</option>';await loadCities();notify(error.message)}};
  modal.querySelector("#patient-province").addEventListener("change",async event=>{provinceCustomLabel.hidden=event.target.value!=="__other__";provinceCustomLabel.querySelector("input").required=event.target.value==="__other__";await loadCities()});
  modal.querySelector("#patient-city").addEventListener("change",event=>{cityCustomLabel.hidden=event.target.value!=="__other__";cityCustomLabel.querySelector("input").required=event.target.value==="__other__"});
  const refreshAffiliations=async()=>{
    const type=modal.querySelector("#patient-type").value.toLowerCase();
    const organizationType=type.includes("military")?"military":type.includes("police")?"police":null;
    const countryId=modal.querySelector("#country-select").value;
    const rank=modal.querySelector("#service-rank"),unit=modal.querySelector("#service-unit");
    const applicable=Boolean(organizationType);modal.querySelector("#rank-label").hidden=!applicable;modal.querySelector("#unit-label").hidden=!applicable;
    if(!applicable){modal.querySelector("#rank-custom-label").hidden=true;modal.querySelector("#unit-custom-label").hidden=true;rank.innerHTML=unit.innerHTML='<option value="">Not applicable</option>';return;}
    if(!countryId){rank.innerHTML=unit.innerHTML='<option value="">Select country first</option>';return;}
    const {data,error}=await supabase.from("service_affiliation_catalog").select("entry_type,name").eq("country_id",Number(countryId)).eq("organization_type",organizationType).eq("active",true).order("name");
    if(error){notify(error.message);return;}
    const rankKind="rank";
    const choices=kind=>`<option value="">Select</option>`+(data||[]).filter(item=>item.entry_type===kind).map(item=>`<option value="${safe(item.name)}">${safe(item.name)}</option>`).join("")+`<option value="__other__">Other / not listed</option>`;
    rank.innerHTML=choices(rankKind);unit.innerHTML=choices("unit");
  };
  const refreshDependent=()=>{const dependent=modal.querySelector("#patient-type").value.toLowerCase().includes("dependent");dependentLabels.forEach(label=>label.hidden=!dependent);const relationship=modal.querySelector('[name="dependent_relationship"]');relationship.required=dependent;if(!dependent){relationship.value="";modal.querySelector('[name="related_service_member_name"]').value="";modal.querySelector('[name="related_service_identifier"]').value=""}};
  modal.querySelector("#patient-type").addEventListener("change",()=>{refreshDependent();refreshAffiliations()});
  modal.querySelector("#country-select").addEventListener("change",async()=>{await loadProvinces();await refreshAffiliations();});
  await refreshAffiliations();
  refreshDependent();
  for(const [selectId,labelId] of [["#service-rank","#rank-custom-label"],["#service-unit","#unit-custom-label"]]) modal.querySelector(selectId).addEventListener("change",event=>modal.querySelector(labelId).hidden=event.target.value!=="__other__");
  for(const [selectId,otherId] of [["#patient-gender","#patient-gender-other"],["#patient-ethnicity","#patient-ethnicity-other"]]){const select=modal.querySelector(selectId),other=modal.querySelector(otherId),input=other.querySelector("input");select.addEventListener("change",()=>{const show=select.value==="Other";other.hidden=!show;input.required=show;if(!show)input.value=""})}
  modal.querySelector("#patient-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const provinceText=values.province_text==="__other__"?values.province_text_custom:geography?.states.find(item=>item.code===values.province_text)?.name||values.province_text;
    const cityText=values.city_text==="__other__"?values.city_text_custom:values.city_text;
    const { data: address, error: addressError } = await supabase.from("addresses").insert({ line1: values.line1, country_id: Number(values.country_id),province_text:provinceText||null,city_text:cityText||null,postal_code_text:values.postal_code_text||null }).select("id").single();
    if (addressError) return notify(addressError.message);
    const patient = {first_name:values.first_name,last_name:values.last_name,middle_name:values.middle_name||null,date_of_birth:values.date_of_birth||null,sex:values.gender_identity==="Male"?"M":values.gender_identity==="Female"?"F":values.gender_identity?"X":null,gender_identity:values.gender_identity||null,gender_other:values.gender_other||null,ethnicity:values.ethnicity||null,ethnicity_other:values.ethnicity_other||null,preferred_language:values.preferred_language||null,patient_type:values.patient_type,service_identifier:values.service_identifier||null,service_rank:(values.service_rank==="__other__"?values.service_rank_custom:values.service_rank)||null,service_unit:(values.service_unit==="__other__"?values.service_unit_custom:values.service_unit)||null,dependent_relationship:values.dependent_relationship||null,related_service_member_name:values.related_service_member_name||null,related_service_identifier:values.related_service_identifier||null,primary_address_id:address.id,facility_id:membership?.facility_id||null};
    const { data:created,error } = await supabase.from("patients").insert(patient).select("id,snau").single();
    if (error) return notify(error.message);
    if(values.mrn&&membership?.facility_id){const {error:mrnError}=await supabase.from("facility_patient_mrns").insert({facility_id:membership.facility_id,patient_id:created.id,mrn:values.mrn});if(mrnError)return notify(mrnError.message);}
    if(values.phone){const {error:phoneError}=await supabase.from("patient_contact_methods").insert({patient_id:created.id,contact_type:"phone",country_calling_code:values.country_calling_code||null,contact_value:values.phone,primary_contact:true});if(phoneError)return notify(phoneError.message);}
    closeModal(); notify(`Patient created. Permanent UNIN: ${created.snau}`); await hydrateLivePatients();
  });
}

async function userForm() {
  const { data: roles, error } = await supabase.from("roles").select("role_code,role_name").order("access_level");
  if (error) return notify(error.message);
  showModal("Create user", `<form id="user-form"><div class="live-banner">A strong temporary password will be generated and shown once.</div><label>Email<input type="email" name="email" required></label><label>Phone number<input type="tel" name="phone" autocomplete="tel" placeholder="+243..." pattern="\+[1-9][0-9]{7,14}" required></label><label>Display name<input name="display_name" required></label><label>Role<select name="role_code" required>${roles.map(r=>`<option value="${r.role_code}">${r.role_name}</option>`).join("")}</select></label><label>Scope<input name="scope" value="hospital_main" required></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Create account</button></footer></form>`);
  modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
  modal.querySelector("#user-form").addEventListener("submit", async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    const { data, error: invokeError } = await supabase.functions.invoke("create-user", { body });
    if (invokeError || data?.error) return notify(invokeError?.message || data.error);
    modal.querySelector("#user-form").innerHTML=`<div class="live-banner">Account created. Copy this temporary password now; it is shown only once.</div><label>Email<input value="${body.email}" readonly></label><label>Temporary password<input value="${data.temporary_password}" readonly id="temporary-password"></label><p class="alert">The user must change this password at first login.</p><footer><button type="button" class="button primary" data-done>Done</button></footer>`;
    modal.querySelector("[data-done]").addEventListener("click",closeModal);
  });
}

async function hydrateLivePatients() {
  const table = document.querySelector("#patient-table");
  if (!table || !session) return;
  const { data, error } = await supabase.from("patients").select("id,first_name,middle_name,last_name,mrn,date_of_birth,sex,snau,life_status").order("last_name");
  if (error) { table.innerHTML=`<tr><td colspan="6" class="empty">${error.message}</td></tr>`; return; }
  table.innerHTML = data.length ? data.map(p => `<tr><td><div class="patient-cell"><span class="patient-avatar">${(p.first_name?.[0]||"")+(p.last_name?.[0]||"")}</span><span><strong>${p.first_name} ${p.last_name}</strong><small>${p.mrn||"No MRN"}</small></span></div></td><td>${p.date_of_birth||"—"}</td><td>${p.snau||"UNIN not assigned"}</td><td>${p.sex||"—"}</td><td><span class="status active">${p.life_status||"active"}</span></td><td>Live</td></tr>`).join("") : `<tr><td colspan="6" class="empty">No live patients yet. Use “Register patient”.</td></tr>`;
}

async function hydrateClinicalView(viewName) {
  if(!session) return;
  const table=document.querySelector("#view tbody");
  if(!table) return;
  let data,error,rows=[];
  if(viewName==="encounters"){
    ({data,error}=await supabase.from("encounters").select("id,encounter_type,start_at,status,patients(first_name,last_name),services(name)").order("start_at",{ascending:false}).limit(100));
    rows=(data||[]).map(item=>[item.encounter_type,`${item.patients?.first_name||""} ${item.patients?.last_name||""} · ${new Date(item.start_at).toLocaleString()}`,item.status]);
  } else if(viewName==="orders"){
    ({data,error}=await supabase.from("orders").select("id,order_type,status,created_at,patients(first_name,last_name),services(name)").order("created_at",{ascending:false}).limit(100));
    rows=(data||[]).map(item=>[`${item.order_type}${item.services?.name?` · ${item.services.name}`:""}`,`${item.patients?.first_name||""} ${item.patients?.last_name||""} · ${new Date(item.created_at).toLocaleString()}`,item.status]);
  } else if(viewName==="medications"){
    ({data,error}=await supabase.from("medication_orders").select("id,dose,route,frequency,status,patients(first_name,last_name),medications(name,strength)").order("id",{ascending:false}).limit(100));
    rows=(data||[]).map(item=>[`${item.medications?.name||"Medication"} ${item.medications?.strength||""}`.trim(),`${item.patients?.first_name||""} ${item.patients?.last_name||""} · ${item.dose} ${item.route||""} ${item.frequency||""}`.trim(),item.status]);
  } else if(viewName==="notes"){
    ({data,error}=await supabase.from("clinical_notes").select("id,note_type,status,created_at,patients(first_name,last_name)").order("created_at",{ascending:false}).limit(100));
    rows=(data||[]).map(item=>[item.note_type,`${item.patients?.first_name||""} ${item.patients?.last_name||""} · ${new Date(item.created_at).toLocaleString()}`,item.status]);
  } else return;
  if(error){table.innerHTML=`<tr><td colspan="3" class="empty">${safe(error.message)}</td></tr>`;return;}
  table.innerHTML=rows.length?rows.map(row=>`<tr>${row.map((cell,index)=>`<td>${index===2?`<span class="status ${safe(cell).toLowerCase()}">${safe(cell)}</span>`:safe(cell)}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="3" class="empty">No live records yet.</td></tr>`;
  document.querySelector("#view .alert")?.remove();
}

async function hydrateDashboard(){
  if(!session||!document.querySelector("#view .metrics"))return;
  const dayStart=new Date();dayStart.setHours(0,0,0,0);
  const [{count:encounters},{count:orders},{count:results},{count:patients},{data:schedule}] = await Promise.all([
    supabase.from("encounters").select("id",{count:"exact",head:true}).gte("start_at",dayStart.toISOString()),
    supabase.from("orders").select("id",{count:"exact",head:true}).in("status",["pending","in_progress"]),
    supabase.from("lab_results").select("id",{count:"exact",head:true}).eq("validation_status","validated").gte("validated_at",dayStart.toISOString()),
    supabase.from("patients").select("id",{count:"exact",head:true}),
    supabase.from("encounters").select("id,start_at,status,encounter_type,patients(first_name,last_name,date_of_birth),services(name)").gte("start_at",dayStart.toISOString()).order("start_at").limit(20)
  ]);
  const values=[encounters,orders,results,patients];document.querySelectorAll("#view .metric strong").forEach((element,index)=>element.textContent=values[index]??"0");
  const table=document.querySelector("#view .grid-2 tbody");
  if(table)table.innerHTML=(schedule||[]).length?(schedule||[]).map(item=>`<tr><td><strong>${safe(`${item.patients?.first_name||""} ${item.patients?.last_name||""}`.trim())}</strong></td><td>${safe(item.patients?.date_of_birth)}</td><td>${safe(item.services?.name||item.encounter_type)}</td><td>Assigned provider</td><td><span class="status ${safe(item.status).toLowerCase()}">${safe(item.status)}</span></td><td>${safe(new Date(item.start_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}))}</td></tr>`).join(""):`<tr><td colspan="6" class="empty">No encounters scheduled today.</td></tr>`;
  const heading=document.querySelector("#view .page-head h1"),subtitle=document.querySelector("#view .page-head p");if(heading)heading.textContent="Healthcarology EHR";if(subtitle)subtitle.textContent="Internal EHR · Live operational data";
}

async function encounterForm(){
  try{
    const {patients,services}=await clinicalChoices();
    const canManageCatalog=["root","sysadmin"].includes(currentRoleCode);
    const alphabetically=(left,right)=>String(left?.name||"").localeCompare(String(right?.name||""),undefined,{sensitivity:"base"});
    const departments=[...new Map(services.filter(service=>service.departments?.id).map(service=>[String(service.departments.id),service.departments])).values()].sort(alphabetically);
    const sortedServices=[...services].sort(alphabetically);
    const otherOption=canManageCatalog?`<option value="__other__">Other — add new</option>`:"";
    showModal("Open encounter",`<form id="clinical-form"><label>Patient<select name="patient_id" required>${optionList(patients,p=>`${p.last_name}, ${p.first_name} · ${p.snau||"UNIN pending"}`)}</select></label><label>Encounter type<select name="encounter_type" required><option>Outpatient</option><option>Inpatient</option><option>Emergency</option><option>Observation</option><option>Telehealth</option></select></label><label>Department<select id="encounter-department" name="department_id" required>${optionList(departments,department=>department.name,"Select department")}${otherOption}</select></label>${canManageCatalog?`<label id="new-department-field" hidden>New department name<input id="new-department-name" name="new_department_name" maxlength="160"></label>`:""}<label>Service<select id="encounter-service" name="service_id" required disabled><option value="">Select department first</option></select></label>${canManageCatalog?`<label id="new-service-field" hidden>New service name<input id="new-service-name" name="new_service_name" maxlength="160"></label>`:""}<label>Start date and time<input type="datetime-local" name="start_at" required></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Open encounter</button></footer></form>`);
    const departmentSelect=modal.querySelector("#encounter-department");
    const serviceSelect=modal.querySelector("#encounter-service");
    const departmentField=modal.querySelector("#new-department-field");
    const departmentName=modal.querySelector("#new-department-name");
    const serviceField=modal.querySelector("#new-service-field");
    const serviceName=modal.querySelector("#new-service-name");
    const refreshServiceName=()=>{
      if(!serviceField)return;
      const addingService=serviceSelect.value==="__other__";
      serviceField.hidden=!addingService;
      serviceName.required=addingService;
      if(!addingService)serviceName.value="";
    };
    departmentSelect.addEventListener("change",()=>{
      const addingDepartment=departmentSelect.value==="__other__";
      if(departmentField){departmentField.hidden=!addingDepartment;departmentName.required=addingDepartment;if(!addingDepartment)departmentName.value="";}
      const matchingServices=addingDepartment?[]:sortedServices.filter(service=>String(service.department_id||service.departments?.id||"")===departmentSelect.value);
      serviceSelect.innerHTML=optionList(matchingServices,service=>service.name,matchingServices.length?"Select service":"No services available")+(canManageCatalog&&departmentSelect.value?otherOption:"");
      serviceSelect.disabled=!departmentSelect.value||(!canManageCatalog&&matchingServices.length===0);
      if(addingDepartment){serviceSelect.value="__other__";}
      refreshServiceName();
    });
    serviceSelect.addEventListener("change",refreshServiceName);
    bindClinicalSubmit("encounters",async values=>{
      let departmentId=values.department_id;
      if(departmentId==="__other__"){
        const name=String(values.new_department_name||"").trim();
        if(!name)throw new Error("Enter the new department name.");
        const code=`custom_${name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,60)||"department"}_${Date.now().toString(36)}`;
        const {data,error}=await supabase.from("departments").insert({code,name,type:"custom"}).select("id").single();
        if(error)throw error;
        departmentId=data.id;
      }
      let serviceId=values.service_id;
      if(serviceId==="__other__"){
        const name=String(values.new_service_name||"").trim();
        if(!name)throw new Error("Enter the new service name.");
        const {data,error}=await supabase.from("services").insert({department_id:Number(departmentId),name,service_type:"custom"}).select("id").single();
        if(error)throw error;
        serviceId=data.id;
      }
      return {patient_id:Number(values.patient_id),encounter_type:values.encounter_type,service_id:Number(serviceId),start_at:new Date(values.start_at).toISOString(),attending_provider_id:currentProviderId,status:"open"};
    });
  }catch(error){notify(error.message)}
}

async function orderForm(){
  try{
    const {patients,services}=await clinicalChoices();
    showModal("Place order",`<form id="clinical-form"><label>Patient<select name="patient_id" required>${optionList(patients,p=>`${p.last_name}, ${p.first_name} · ${p.snau||"UNIN pending"}`)}</select></label><label>Order type<select name="order_type" required><option value="lab">Laboratory</option><option value="imaging">Imaging</option><option value="procedure">Procedure</option></select></label><label>Requested service<select name="service_id">${optionList(services,s=>`${s.departments?.name||"Department"} · ${s.name}`,"No service")}</select></label><label>Test / modality / procedure code<input name="requested_code" required></label><label>Priority<select name="priority"><option>Routine</option><option>Urgent</option><option>STAT</option></select></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Place order</button></footer></form>`);
    const form=modal.querySelector("#clinical-form");modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
    form.addEventListener("submit",async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form));const {data:order,error}=await supabase.from("orders").insert({patient_id:Number(values.patient_id),ordering_provider_id:currentProviderId,order_type:values.order_type,service_id:values.service_id?Number(values.service_id):null,status:"pending"}).select("id").single();if(error)return notify(error.message);const details=values.order_type==="lab"?{order_id:order.id,test_code:values.requested_code,priority:values.priority}:values.order_type==="imaging"?{order_id:order.id,modality:values.requested_code,contrast:false}:{order_id:order.id,procedure_code:values.requested_code};const {error:detailError}=await supabase.from(`${values.order_type}_orders`).insert(details);if(detailError)return notify(detailError.message);closeModal();notify("Order placed and recorded.");await hydrateClinicalView("orders")});
  }catch(error){notify(error.message)}
}

async function medicationOrderForm(){
  try{
    const {patients,medications}=await clinicalChoices();
    showModal("New medication order",`<form id="clinical-form"><label>Patient<select name="patient_id" required>${optionList(patients,p=>`${p.last_name}, ${p.first_name} · ${p.snau||"UNIN pending"}`)}</select></label><label>Medication<select name="medication_id" required>${optionList(medications,m=>`${m.name}${m.strength?` · ${m.strength}`:""}`)}</select></label><label>Dose<input name="dose" required></label><label>Route<input name="route" required></label><label>Frequency<input name="frequency" required></label><label>Start date<input type="date" name="start_at"></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Prescribe</button></footer></form>`);
    bindClinicalSubmit("medication_orders",values=>({patient_id:Number(values.patient_id),prescriber_id:currentProviderId,medication_id:Number(values.medication_id),dose:values.dose,route:values.route,frequency:values.frequency,start_at:values.start_at?new Date(`${values.start_at}T00:00:00`).toISOString():null,status:"active"}),"medications");
  }catch(error){notify(error.message)}
}

async function noteForm(){
  if(!currentProviderId)return notify("This account must be linked to a provider before authoring clinical notes.");
  try{
    const {patients}=await clinicalChoices();
    showModal("Write clinical note",`<form id="clinical-form"><label>Patient<select name="patient_id" required>${optionList(patients,p=>`${p.last_name}, ${p.first_name} · ${p.snau||"UNIN pending"}`)}</select></label><label>Note type<select name="note_type"><option>Progress note</option><option>Consult note</option><option>Nursing note</option><option>Discharge note</option><option>Operative note</option></select></label><label>Clinical note<textarea name="content" rows="10" required></textarea></label><label>Status<select name="status"><option value="draft">Draft</option><option value="signed">Signed</option></select></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Save note</button></footer></form>`);
    bindClinicalSubmit("clinical_notes",values=>({patient_id:Number(values.patient_id),author_provider_id:currentProviderId,note_type:values.note_type,content:values.content,status:values.status,signed_at:values.status==="signed"?new Date().toISOString():null}),"notes");
  }catch(error){notify(error.message)}
}

function bindClinicalSubmit(tableName,buildRow,viewName=tableName){
  const form=modal.querySelector("#clinical-form");modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
  form.addEventListener("submit",async event=>{event.preventDefault();try{const values=Object.fromEntries(new FormData(form));const row=await buildRow(values);const {error}=await supabase.from(tableName).insert(row);if(error)throw error;closeModal();notify("Saved to the live health record.");await hydrateClinicalView(viewName)}catch(error){notify(error.message)}});
}

async function setSignedInUser() {
  if (!session) return;
  const { data: profile } = await supabase.from("profiles").select("display_name,email").eq("user_id",session.user.id).maybeSingle();
  const { data: role } = await supabase.from("user_roles").select("roles(role_name,role_code)").eq("user_id",session.user.id).limit(1).maybeSingle();
  currentRoleCode=role?.roles?.role_code||"";
  const name = profile?.display_name || session.user.email;
  const roleName = role?.roles?.role_name || "Pending role";
  const menu = document.querySelector(".user-menu");
  menu.innerHTML = `<span class="avatar">${name.split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}</span><span><strong>${name}</strong><small>${roleName}</small></span><span>⌄</span>`;
  menu.addEventListener("click", async()=>{await supabase.auth.signOut();location.reload()});
  const sourceNote = document.querySelector(".source-note");
  if (sourceNote) sourceNote.innerHTML = `<span class="status-dot"></span><div><strong>Live database</strong><small>Connected securely</small></div>`;
}

document.addEventListener("click", event => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "new-patient") { event.preventDefault(); event.stopImmediatePropagation(); patientForm(); }
  if (action === "review-access") { event.preventDefault(); event.stopImmediatePropagation(); userForm(); }
  if (action === "module-create") {
    event.preventDefault();event.stopImmediatePropagation();
    const title=document.querySelector("#view h1")?.textContent;
    if(title==="Encounters") encounterForm();
    else if(title==="Orders & results") orderForm();
    else if(title==="Medications") medicationOrderForm();
    else if(title==="Clinical notes") noteForm();
  }
}, true);

document.addEventListener("hc:view-rendered", event => {
  hydrateLivePatients();
  hydrateClinicalView(event.detail?.view);
  if(event.detail?.view==="dashboard")hydrateDashboard();
});

const { data } = await supabase.auth.getSession();
session = data.session;
if (!session) authGate(); else if(session.user.app_metadata?.must_change_password===true) passwordChangeGate(); else if(await requireMfa(supabase,document.body)){ await loadClinicalContext(); await setSignedInUser(); await hydrateLivePatients(); await hydrateDashboard(); if(new URLSearchParams(location.search).get("register")==="patient")await patientForm(); }
supabase.auth.onAuthStateChange((event,newSession)=>{
  const previousUserId = session?.user?.id;
  session = newSession;
  if(event==="PASSWORD_RECOVERY"){
    document.querySelector(".auth-gate")?.remove();
    passwordChangeGate();
    return;
  }
  if(event==="SIGNED_IN" && newSession?.user?.id !== previousUserId) location.reload();
  if(event==="SIGNED_OUT") location.reload();
});
