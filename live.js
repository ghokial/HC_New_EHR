import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { requireMfa } from "./portal-features.js";

const supabase = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const modal = document.querySelector("#live-modal");
let session = null;
let currentProviderId = null;
let currentFacilityId = null;
let currentRoleCode = "";
let selectedLivePatientId = null;
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
  modal.querySelector(".live-banner").textContent="UNIN follows the registry document. The country prefix is stored internally but hidden in normal display. UNIN becomes permanent after the required registry fields are complete. MRN belongs to the registering facility.";
  const dobInput=modal.querySelector('[name="date_of_birth"]');dobInput.required=true;
  const genderLabel=modal.querySelector("#patient-gender").closest("label"),registrySexLabel=document.createElement("label"),birthCountryLabel=document.createElement("label"),uninProvinceLabel=document.createElement("label"),uninCommuneLabel=document.createElement("label");
  registrySexLabel.innerHTML='Registry sex<select name="sex" required><option value="">Select</option><option value="M">Male (M)</option><option value="F">Female (F)</option></select>';
  birthCountryLabel.innerHTML='Country of birth / registry<select name="birth_country_id" id="birth-country-select" required></select>';
  uninProvinceLabel.innerHTML='Registry province code<input name="unin_province_code" inputmode="numeric" pattern="[0-9]{2}" maxlength="2" placeholder="e.g. 10" required>';
  uninCommuneLabel.innerHTML='Registry commune / sector code<input name="unin_commune_code" pattern="[A-Za-z]" maxlength="1" placeholder="e.g. L" required>';
  genderLabel.before(registrySexLabel,birthCountryLabel,uninProvinceLabel,uninCommuneLabel);
  await loadCountries(modal.querySelector("#country-select"));
  await loadCountries(modal.querySelector("#birth-country-select"));
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
    const patient = {first_name:values.first_name,last_name:values.last_name,middle_name:values.middle_name||null,date_of_birth:values.date_of_birth,sex:values.sex,birth_country_id:Number(values.birth_country_id),unin_province_code:values.unin_province_code.toUpperCase(),unin_commune_code:values.unin_commune_code.toUpperCase(),gender_identity:values.gender_identity||null,gender_other:values.gender_other||null,ethnicity:values.ethnicity||null,ethnicity_other:values.ethnicity_other||null,preferred_language:values.preferred_language||null,patient_type:values.patient_type,service_identifier:values.service_identifier||null,service_rank:(values.service_rank==="__other__"?values.service_rank_custom:values.service_rank)||null,service_unit:(values.service_unit==="__other__"?values.service_unit_custom:values.service_unit)||null,dependent_relationship:values.dependent_relationship||null,related_service_member_name:values.related_service_member_name||null,related_service_identifier:values.related_service_identifier||null,primary_address_id:address.id,facility_id:membership?.facility_id||null};
    const { data:created,error } = await supabase.from("patients").insert(patient).select("id,snau").single();
    if (error) return notify(error.message);
    if(values.mrn&&membership?.facility_id){const {error:mrnError}=await supabase.from("facility_patient_mrns").insert({facility_id:membership.facility_id,patient_id:created.id,mrn:values.mrn});if(mrnError)return notify(mrnError.message);}
    if(values.phone){const {error:phoneError}=await supabase.from("patient_contact_methods").insert({patient_id:created.id,contact_type:"phone",country_calling_code:values.country_calling_code||null,contact_value:values.phone,primary_contact:true});if(phoneError)return notify(phoneError.message);}
    closeModal(); notify(created.snau?`Patient created. Permanent UNIN: ${created.snau}`:"Patient created. UNIN is pending an approved country registry rule."); await hydrateLivePatients();
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
  if (error) { table.innerHTML=`<tr><td colspan="7" class="empty">${error.message}</td></tr>`; return; }
  table.innerHTML = data.length ? data.map(p => `<tr><td><div class="patient-cell"><span class="patient-avatar">${safe((p.first_name?.[0]||"")+(p.last_name?.[0]||""))}</span><span><button type="button" class="patient-name-link" data-live-patient="${p.id}" data-patient-name="${safe(`${p.first_name||""} ${p.last_name||""}`.trim())}">${safe(`${p.first_name||""} ${p.last_name||""}`.trim())}</button><small>${safe(p.mrn||"No MRN")}</small></span></div></td><td>${safe(p.date_of_birth||"—")}</td><td><strong>${safe(p.snau||"Pending registry data")}</strong></td><td>—</td><td>—</td><td><span class="status active">${safe(p.life_status||"active")}</span></td><td>Live</td></tr>`).join("") : `<tr><td colspan="7" class="empty">No live patients yet. Use “Register patient”.</td></tr>`;
}

function patientActionMenu(patientId,patientName){
  showModal("Patient options",`<div class="live-banner"><strong>${safe(patientName)}</strong></div><div class="patient-actions"><button type="button" class="button primary" data-patient-encounter="${patientId}">Start new encounter</button><button type="button" class="button secondary" data-patient-profile="${patientId}">View full patient profile</button></div>`);
}

const profileFact=(label,content)=>`<div class="data-row"><span>${safe(label)}</span><strong>${safe(content===null||content===undefined||content===""?"—":content)}</strong></div>`;
const profileRecords=(rows,render,empty)=>rows.length?rows.map(render).join(""):`<p class="empty">${safe(empty)}</p>`;

async function patientProfile(patientId,inline=false){
  try{
    const patientResult=await supabase.from("patients").select("id,first_name,middle_name,last_name,mrn,snau,date_of_birth,sex,gender_identity,gender_other,ethnicity,ethnicity_other,preferred_language,patient_type,life_status,service_identifier,service_rank,service_unit,dependent_relationship,related_service_member_name,related_service_identifier,primary_address_id").eq("id",patientId).single();
    if(patientResult.error)throw patientResult.error;
    const patient=patientResult.data;
    const results=await Promise.all([
      supabase.from("patient_contact_methods").select("contact_type,country_calling_code,contact_value,primary_contact").eq("patient_id",patientId).order("primary_contact",{ascending:false}),
      patient.primary_address_id?supabase.from("addresses").select("line1,line2,city_text,province_text,postal_code_text,countries(default_name)").eq("id",patient.primary_address_id).maybeSingle():Promise.resolve({data:null,error:null}),
      supabase.from("encounters").select("id,encounter_type,start_at,end_at,status,services(name)").eq("patient_id",patientId).order("start_at",{ascending:false}),
      supabase.from("diagnoses").select("id,code,display,clinical_status,onset_at,closed_at,recorded_at").eq("patient_id",patientId).order("recorded_at",{ascending:false}),
      supabase.from("orders").select("id,order_type,status,created_at,services(name)").eq("patient_id",patientId).order("created_at",{ascending:false}),
      supabase.from("medication_orders").select("id,dose,route,frequency,start_at,end_at,status,medications(name,strength)").eq("patient_id",patientId).order("id",{ascending:false}),
      supabase.from("clinical_notes").select("id,note_type,content,created_at,signed_at,status").eq("patient_id",patientId).order("created_at",{ascending:false})
    ]);
    const failed=results.find(result=>result.error);if(failed)throw failed.error;
    const [contacts,addressResult,encounters,diagnoses,orders,medications,notes]=results.map(result=>result.data);
    const fullName=[patient.first_name,patient.middle_name,patient.last_name].filter(Boolean).join(" "),address=addressResult;
    const profile=`<section class="patient-profile"><div class="patient-hero"><div class="patient-id"><span class="hero-avatar">${safe((patient.first_name?.[0]||"")+(patient.last_name?.[0]||""))}</span><div><h2>${safe(fullName)}</h2><p>MRN: ${safe(patient.mrn||"—")} · UNIN: ${safe(patient.snau||"—")}</p></div></div><button type="button" class="button primary" data-patient-encounter="${patient.id}">Start new encounter</button></div><div class="profile-grid"><article class="card"><header class="card-head"><h2>Demographics</h2></header><div class="card-body data-list">${profileFact("Date of birth",patient.date_of_birth)}${profileFact("Sex",patient.sex)}${profileFact("Gender",patient.gender_identity==="Other"?patient.gender_other:patient.gender_identity)}${profileFact("Ethnicity",patient.ethnicity==="Other"?patient.ethnicity_other:patient.ethnicity)}${profileFact("Preferred language",patient.preferred_language)}${profileFact("Patient type",patient.patient_type)}${profileFact("Life status",patient.life_status)}</div></article><article class="card"><header class="card-head"><h2>Contact and address</h2></header><div class="card-body data-list">${profileRecords(contacts||[],contact=>profileFact(contact.contact_type,`${contact.country_calling_code||""}${contact.contact_value}${contact.primary_contact?" · Primary":""}`),"No contact methods recorded.")}${address?profileFact("Address",[address.line1,address.line2,address.city_text,address.province_text,address.postal_code_text,address.countries?.default_name].filter(Boolean).join(", ")):'<p class="empty">No primary address recorded.</p>'}</div></article><article class="card"><header class="card-head"><h2>Service affiliation</h2></header><div class="card-body data-list">${profileFact("Service ID",patient.service_identifier)}${profileFact("Rank / function",patient.service_rank)}${profileFact("Unit",patient.service_unit)}${profileFact("Dependent relationship",patient.dependent_relationship)}${profileFact("Related member",patient.related_service_member_name)}${profileFact("Related member service ID",patient.related_service_identifier)}</div></article></div><article class="card"><header class="card-head"><h2>Encounters</h2></header><div class="card-body compact-list">${profileRecords(encounters||[],item=>`<div class="data-row"><span>${safe(item.encounter_type)} · ${safe(item.services?.name||"No service")}</span><strong>${safe(item.status)} · ${safe(new Date(item.start_at).toLocaleString())}</strong></div>`,"No encounters recorded.")}</div></article><article class="card"><header class="card-head"><h2>Diagnoses</h2></header><div class="card-body compact-list">${profileRecords(diagnoses||[],item=>`<div class="data-row"><span>${safe(item.code)} · ${safe(item.display)}</span><strong>${safe(item.clinical_status||"recorded")}</strong></div>`,"No diagnoses recorded.")}</div></article><article class="card"><header class="card-head"><h2>Orders</h2></header><div class="card-body compact-list">${profileRecords(orders||[],item=>`<div class="data-row"><span>${safe(item.order_type)} · ${safe(item.services?.name||"No service")}</span><strong>${safe(item.status)}</strong></div>`,"No orders recorded.")}</div></article><article class="card"><header class="card-head"><h2>Medications</h2></header><div class="card-body compact-list">${profileRecords(medications||[],item=>`<div class="data-row"><span>${safe(item.medications?.name||"Medication")} ${safe(item.medications?.strength||"")} · ${safe(item.dose)} ${safe(item.route||"")} ${safe(item.frequency||"")}</span><strong>${safe(item.status)}</strong></div>`,"No medication orders recorded.")}</div></article><article class="card"><header class="card-head"><h2>Clinical notes</h2></header><div class="card-body compact-list">${profileRecords(notes||[],item=>`<div class="profile-note"><strong>${safe(item.note_type)} · ${safe(item.status)}</strong><small>${safe(new Date(item.created_at).toLocaleString())}</small><p>${safe(item.content)}</p></div>`,"No clinical notes recorded.")}</div></article></section>`;
    if(inline)document.querySelector("#view").innerHTML=`<div class="page-head"><div><p class="eyebrow">Longitudinal health record</p><h1>Patient chart</h1><p>Live patient information. Empty fields are shown as “—” and are never invented.</p></div></div>${profile}`;
    else showModal("Full patient profile",profile);
  }catch(error){notify(error.message)}
}

async function renderLivePatientChart(){
  if(!selectedLivePatientId){
    const {data:account}=await supabase.from("patient_accounts").select("patient_id").eq("user_id",session.user.id).limit(1).maybeSingle();
    selectedLivePatientId=account?.patient_id||null;
  }
  if(selectedLivePatientId)await patientProfile(selectedLivePatientId,true);
  else document.querySelector("#view").innerHTML=`<div class="page-head"><div><p class="eyebrow">Longitudinal health record</p><h1>Patient chart</h1><p>Select a patient name from the Patients list to open the live chart.</p></div></div><div class="alert">No patient file is linked to this account yet.</div>`;
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
    if(error){table.innerHTML=`<tr><td colspan="3" class="empty">${safe(error.message)}</td></tr>`;return;}
    table.innerHTML=(data||[]).length?(data||[]).map(item=>`<tr><td><button type="button" class="patient-name-link" data-order-result="${item.id}" data-order-type="${safe(item.order_type)}">${safe(item.order_type.toUpperCase())}${item.services?.name?` · ${safe(item.services.name)}`:""}</button></td><td>${safe(`${item.patients?.first_name||""} ${item.patients?.last_name||""}`.trim())} · ${safe(new Date(item.created_at).toLocaleString())}</td><td><span class="status ${safe(item.status).toLowerCase()}">${safe(item.status)}</span></td></tr>`).join(""):`<tr><td colspan="3" class="empty">No live records yet.</td></tr>`;
    table.querySelectorAll("[data-order-result]").forEach(button=>button.addEventListener("click",()=>openOrderResult(Number(button.dataset.orderResult),button.dataset.orderType)));
    document.querySelector("#view .alert")?.remove();return;
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

async function hydrateTriage(){
  const table=document.querySelector("#triage-table");if(!table||!session)return;
  const {data,error}=await supabase.from("care_queue_entries").select("id,reference_number,started_at,priority,patient_id,department_id,assigned_provider_id,patients(first_name,last_name,snau),departments(name)").eq("queue_stage","triage").order("priority",{ascending:false}).order("started_at");
  if(error){table.innerHTML=`<tr><td colspan="6" class="empty">${safe(error.message)}</td></tr>`;return}
  table.innerHTML=(data||[]).length?(data||[]).map(item=>`<tr><td><strong>${safe(`${item.patients?.first_name||""} ${item.patients?.last_name||""}`.trim())}</strong><small>${safe(item.reference_number)} · ${safe(item.patients?.snau||"UNIN pending")}</small></td><td>${safe(new Date(item.started_at).toLocaleString())}</td><td>${safe(item.departments?.name||"Common triage")}</td><td><span class="status ${safe(item.priority)}">${safe(item.priority)}</span></td><td>${item.assigned_provider_id?`Provider #${safe(item.assigned_provider_id)}`:"Not assigned"}</td><td><button type="button" class="button primary" data-triage-entry="${item.id}">Triage patient</button></td></tr>`).join(""):`<tr><td colspan="6" class="empty">No patients are waiting for triage.</td></tr>`;
  table.querySelectorAll("[data-triage-entry]").forEach(button=>button.addEventListener("click",()=>triageForm(button.dataset.triageEntry)));
}

async function triageForm(queueId){
  try{
    const [{data:queue,error:queueError},{data:providers,error:providerError},{data:departments,error:departmentError},{data:services,error:serviceError},{data:facility,error:facilityError}]=await Promise.all([
      supabase.from("care_queue_entries").select("id,facility_id,patient_id,priority,department_id,service_id,patients(first_name,last_name,date_of_birth,snau)").eq("id",queueId).single(),
      supabase.from("providers").select("id,user_id,provider_type,department_id,service_id,departments(name),services(name)").eq("active",true).order("id"),
      supabase.from("departments").select("id,name").order("name"),
      supabase.from("services").select("id,name,department_id").order("name"),
      currentFacilityId?supabase.from("facilities").select("triage_mode").eq("id",currentFacilityId).single():Promise.resolve({data:{triage_mode:"common"}})
    ]);const error=queueError||providerError||departmentError||serviceError||facilityError;if(error)throw error;
    const userIds=(providers||[]).map(x=>x.user_id).filter(Boolean),profiles=userIds.length?(await supabase.from("profiles").select("user_id,display_name").in("user_id",userIds)).data||[]:[],names=new Map(profiles.map(x=>[x.user_id,x.display_name]));
    const providerOptions=(providers||[]).map(p=>`<option value="${p.id}" data-department="${p.department_id||""}" data-service="${p.service_id||""}">${safe(names.get(p.user_id)||p.provider_type||`Provider ${p.id}`)} · ${safe(p.departments?.name||"General")} ${p.services?.name?`· ${safe(p.services.name)}`:""}</option>`).join("");
    const departmentRequired=facility?.triage_mode==="department";
    showModal("Triage and vital signs",`<div class="live-banner"><strong>${safe(`${queue.patients?.first_name||""} ${queue.patients?.last_name||""}`.trim())}</strong> · ${safe(queue.patients?.snau||"UNIN pending")} · ${departmentRequired?"Department-based triage":"Common hospital triage"}</div><form id="triage-form"><label>Chief complaint<textarea name="chief_complaint" rows="3" required></textarea></label><label>Acuity / sorting priority<select name="priority" required><option value="normal">Routine / stable</option><option value="medium">Urgent</option><option value="high">Emergency / immediate</option></select></label><label>Department<select name="department_id" id="triage-department" ${departmentRequired?"required":""}>${optionList(departments||[],x=>x.name,departmentRequired?"Select department":"Common triage / select if known")}</select></label><label>Service<select name="service_id" id="triage-service"><option value="">Select department first</option></select></label><label>Assign doctor / provider<select name="assigned_provider_id" id="triage-provider" required><option value="">Select provider</option>${providerOptions}</select></label><h3>Vital signs</h3><div class="vitals-grid"><label>Weight (kg)<input type="number" step="0.01" min="0" name="weight_kg"></label><label>Height (cm)<input type="number" step="0.01" min="0" name="height_cm"></label><label>BMI<input name="bmi" readonly></label><label>Temperature (°C)<input type="number" step="0.1" name="temperature_c"></label><label>Systolic blood pressure<input type="number" min="0" name="systolic_bp"></label><label>Diastolic blood pressure<input type="number" min="0" name="diastolic_bp"></label><label>Heart rate (/min)<input type="number" min="0" name="heart_rate"></label><label>Respiratory rate (/min)<input type="number" min="0" name="respiratory_rate"></label><label>Oxygen saturation (%)<input type="number" step="0.1" min="0" max="100" name="oxygen_saturation"></label><label>Blood glucose<input type="number" step="0.01" min="0" name="blood_glucose"></label><label>Glucose units<select name="blood_glucose_units"><option value="mg/dL">mg/dL</option><option value="mmol/L">mmol/L</option></select></label><label>Pain score (0–10)<input type="number" min="0" max="10" name="pain_score"></label><label>Head circumference (cm)<input type="number" step="0.01" min="0" name="head_circumference_cm"></label><label>Mid-upper arm circumference (cm)<input type="number" step="0.01" min="0" name="mid_upper_arm_circumference_cm"></label><label>Protocol month<input name="protocol_month" placeholder="M0, M1, M3, M6, M12…"></label><label>Level of consciousness<select name="consciousness_level"><option value="alert">Alert</option><option value="voice">Responds to voice</option><option value="pain">Responds to pain</option><option value="unresponsive">Unresponsive</option></select></label><label>Pregnancy status<select name="pregnancy_status"><option value="unknown">Unknown / not applicable</option><option value="not_pregnant">Not pregnant</option><option value="pregnant">Pregnant</option><option value="postpartum">Postpartum</option></select></label></div><label>Known allergies / alerts<textarea name="allergy_alerts" rows="2"></textarea></label><label>Triage observations<textarea name="notes" rows="4"></textarea></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Complete triage and assign provider</button></footer></form>`);
    const form=modal.querySelector("#triage-form"),department=form.querySelector("#triage-department"),service=form.querySelector("#triage-service"),provider=form.querySelector("#triage-provider");form.elements.priority.value=queue.priority||"normal";if(queue.department_id)department.value=String(queue.department_id);
    const refreshServices=()=>{const rows=(services||[]).filter(x=>!department.value||String(x.department_id)===department.value);service.innerHTML=optionList(rows,x=>x.name,department.value?"Select service":"Select department first");[...provider.options].forEach(option=>{if(!option.value)return;option.hidden=Boolean(department.value&&option.dataset.department&&option.dataset.department!==department.value)});if(provider.selectedOptions[0]?.hidden)provider.value=""};department.addEventListener("change",refreshServices);refreshServices();
    const calculateBmi=()=>{const weight=Number(form.elements.weight_kg.value),height=Number(form.elements.height_cm.value)/100;form.elements.bmi.value=weight>0&&height>0?(weight/(height*height)).toFixed(1):""};form.elements.weight_kg.addEventListener("input",calculateBmi);form.elements.height_cm.addEventListener("input",calculateBmi);modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
    form.addEventListener("submit",async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form)),numberOrNull=key=>values[key]===""?null:Number(values[key]);const row={facility_id:queue.facility_id,patient_id:queue.patient_id,recorded_by:session.user.id,weight_kg:numberOrNull("weight_kg"),height_cm:numberOrNull("height_cm"),bmi:numberOrNull("bmi"),temperature_c:numberOrNull("temperature_c"),oxygen_saturation:numberOrNull("oxygen_saturation"),respiratory_rate:numberOrNull("respiratory_rate"),heart_rate:numberOrNull("heart_rate"),systolic_bp:numberOrNull("systolic_bp"),diastolic_bp:numberOrNull("diastolic_bp"),blood_glucose:numberOrNull("blood_glucose"),blood_glucose_units:values.blood_glucose_units,pain_score:numberOrNull("pain_score"),head_circumference_cm:numberOrNull("head_circumference_cm"),mid_upper_arm_circumference_cm:numberOrNull("mid_upper_arm_circumference_cm"),protocol_month:values.protocol_month||null,consciousness_level:values.consciousness_level,pregnancy_status:values.pregnancy_status,chief_complaint:values.chief_complaint,allergy_alerts:values.allergy_alerts||null,notes:values.notes||null};const {error:vitalsError}=await supabase.from("vital_sign_observations").insert(row);if(vitalsError)throw vitalsError;const {error:updateError}=await supabase.from("care_queue_entries").update({queue_stage:"consultation",priority:values.priority,department_id:values.department_id?Number(values.department_id):null,service_id:values.service_id?Number(values.service_id):null,assigned_provider_id:Number(values.assigned_provider_id)}).eq("id",queue.id);if(updateError)throw updateError;closeModal();notify("Triage completed. The patient is ready for the assigned provider.");await hydrateTriage()});
  }catch(error){notify(error.message)}
}

async function encounterForm(preselectedPatientId=null){
  try{
    const {patients,services}=await clinicalChoices();
    const canManageCatalog=["root","sysadmin"].includes(currentRoleCode);
    const alphabetically=(left,right)=>String(left?.name||"").localeCompare(String(right?.name||""),undefined,{sensitivity:"base"});
    const departments=[...new Map(services.filter(service=>service.departments?.id).map(service=>[String(service.departments.id),service.departments])).values()].sort(alphabetically);
    const sortedServices=[...services].sort(alphabetically);
    const otherOption=canManageCatalog?`<option value="__other__">Other — add new</option>`:"";
    showModal("Open encounter",`<form id="clinical-form"><label>Patient<select name="patient_id" required>${optionList(patients,p=>`${p.last_name}, ${p.first_name} · ${p.snau||"UNIN pending"}`)}</select></label><label>Encounter type<select name="encounter_type" required><option>Outpatient</option><option>Inpatient</option><option>Emergency</option><option>Observation</option><option>Telehealth</option></select></label><label>Department<select id="encounter-department" name="department_id" required>${optionList(departments,department=>department.name,"Select department")}${otherOption}</select></label>${canManageCatalog?`<label id="new-department-field" hidden>New department name<input id="new-department-name" name="new_department_name" maxlength="160"></label>`:""}<label>Service<select id="encounter-service" name="service_id" required disabled><option value="">Select department first</option></select></label>${canManageCatalog?`<label id="new-service-field" hidden>New service name<input id="new-service-name" name="new_service_name" maxlength="160"></label>`:""}<label>Start date and time<input type="datetime-local" name="start_at" required></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Open encounter</button></footer></form>`);
    const skipLabel=document.createElement("label");skipLabel.className="skip-vitals-confirmation";skipLabel.innerHTML='<span><input type="checkbox" name="skip_vitals"> Skip vital signs and go directly to the encounter</span><small>Authorized doctors or appropriate clinical personnel must explicitly confirm this exception. The action is audited.</small><input name="skip_vitals_reason" placeholder="Reason for skipping vital signs" hidden>';
    modal.querySelector("#clinical-form footer").before(skipLabel);const skipBox=skipLabel.querySelector('[name="skip_vitals"]'),skipReason=skipLabel.querySelector('[name="skip_vitals_reason"]');skipBox.addEventListener("change",()=>{skipReason.hidden=!skipBox.checked;skipReason.required=skipBox.checked;if(!skipBox.checked)skipReason.value=""});
    if(preselectedPatientId)modal.querySelector('[name="patient_id"]').value=String(preselectedPatientId);
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
      return {patient_id:Number(values.patient_id),encounter_type:values.encounter_type,service_id:Number(serviceId),start_at:new Date(values.start_at).toISOString(),attending_provider_id:currentProviderId,status:"open",triage_skipped:values.skip_vitals==="on",triage_skip_reason:values.skip_vitals_reason||null,triage_skipped_by:values.skip_vitals==="on"?session.user.id:null};
    });
  }catch(error){notify(error.message)}
}

const interpretationLabel=value=>value==="dangerously_abnormal"?"Dangerously abnormal":value==="out_of_range"?"Out of range":"Normal";
const interpretationBadge=value=>`<span class="result-interpretation ${safe(String(value||"normal").replaceAll("_","-"))}">${safe(interpretationLabel(value))}</span>`;

async function openOrderResult(orderId,orderType){
  try{
    const detailTable=orderType==="lab"?"lab_orders":orderType==="imaging"?"imaging_orders":"procedure_orders";
    const resultTable=orderType==="lab"?"lab_results":orderType==="imaging"?"imaging_results":"procedure_results";
    const detailSelect=orderType==="lab"?"id,test_code,priority,lab_results(id,analyte_code,value,numeric_value,units,reference_range,interpretation,validation_status,result_at)":orderType==="imaging"?"id,modality,body_part,imaging_results(id,report_text,interpretation,result_status,result_at)":"id,procedure_code,procedure_results(id,report_text,interpretation,result_status,performed_at)";
    const {data:detail,error}=await supabase.from(detailTable).select(detailSelect).eq("order_id",orderId).single();
    if(error)throw error;
    const existing=orderType==="lab"?(detail.lab_results||[]):orderType==="imaging"?(detail.imaging_results||[]):(detail.procedure_results||[]);
    const existingHtml=existing.length?existing.map(result=>`<div class="result-record"><div><strong>${safe(result.analyte_code||detail.modality||detail.procedure_code)}</strong><span>${safe(result.numeric_value??result.value??result.report_text??"—")} ${safe(result.units||"")}</span></div>${interpretationBadge(result.interpretation)}<small>${safe(result.validation_status||result.result_status||"recorded")}</small></div>`).join(""):'<p class="empty">No result has been recorded.</p>';
    if(orderType==="lab"){
      const canValidate=["root","lab_supervisor"].includes(currentRoleCode);
      showModal("Laboratory result",`<div class="live-banner"><strong>${safe(detail.test_code)}</strong> · Results remain hidden from prescribers and patients until laboratory-supervisor validation.</div><div class="result-list">${existingHtml}</div><form id="result-form"><label>Analyte code / name<input name="analyte_code" required value="${safe(detail.test_code)}"></label><label>Result type<select name="measurement_type" id="measurement-type"><option value="numeric">Numeric</option><option value="qualitative">Qualitative</option></select></label><div id="numeric-result-fields"><label>Numeric result<input type="number" step="any" name="numeric_value"></label><label>Units<input name="units"></label><div class="range-grid"><label>Critical low<input type="number" step="any" name="critical_low"></label><label>Normal low<input type="number" step="any" name="normal_low"></label><label>Normal high<input type="number" step="any" name="normal_high"></label><label>Critical high<input type="number" step="any" name="critical_high"></label></div></div><div id="qualitative-result-fields" hidden><label>Qualitative result<input name="value"></label><label>Interpretation<select name="qualitative_interpretation"><option value="normal">Normal</option><option value="out_of_range">Out of range</option><option value="dangerously_abnormal">Dangerously abnormal</option></select></label></div><div id="result-preview" class="order-guidance">Enter the result and the performing laboratory’s validated limits.</div><label>Workflow status<select name="validation_status"><option value="draft">Draft</option><option value="pending_validation">Awaiting supervisor validation</option>${canValidate?'<option value="validated">Validated and released</option><option value="rejected">Rejected</option>':""}</select></label><label>Validation note<textarea name="validation_note" rows="3"></textarea></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Save laboratory result</button></footer></form>`);
      const form=modal.querySelector("#result-form"),measurement=form.querySelector("#measurement-type"),numericFields=form.querySelector("#numeric-result-fields"),qualitativeFields=form.querySelector("#qualitative-result-fields"),preview=form.querySelector("#result-preview");
      const classify=()=>{if(measurement.value!=="numeric"){const value=form.elements.qualitative_interpretation.value;preview.innerHTML=interpretationBadge(value);return value;}const number=Number(form.elements.numeric_value.value),cl=Number(form.elements.critical_low.value),nl=Number(form.elements.normal_low.value),nh=Number(form.elements.normal_high.value),ch=Number(form.elements.critical_high.value);if(![number,cl,nl,nh,ch].every(Number.isFinite)){preview.textContent="Enter the result and all four validated limits.";return null;}const value=number<cl||number>ch?"dangerously_abnormal":number<nl||number>nh?"out_of_range":"normal";preview.innerHTML=interpretationBadge(value);return value};
      measurement.addEventListener("change",()=>{const numeric=measurement.value==="numeric";numericFields.hidden=!numeric;qualitativeFields.hidden=numeric;classify()});form.addEventListener("input",classify);modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
      form.addEventListener("submit",async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form)),numeric=values.measurement_type==="numeric";let rangeId=null,interpretation=classify();if(!interpretation)return notify("Complete the result and validated range values.");if(numeric){if(!values.units)return notify("Units are required for a numeric result.");const limits=["critical_low","normal_low","normal_high","critical_high"].map(key=>Number(values[key]));if(!(limits[0]<=limits[1]&&limits[1]<=limits[2]&&limits[2]<=limits[3]))return notify("Ranges must be ordered: critical low ≤ normal low ≤ normal high ≤ critical high.");const {data:range,error:rangeError}=await supabase.from("lab_reference_ranges").insert({facility_id:currentFacilityId||null,analyte_code:values.analyte_code,analyte_name:values.analyte_code,units:values.units,critical_low:limits[0],normal_low:limits[1],normal_high:limits[2],critical_high:limits[3]}).select("id").single();if(rangeError)throw rangeError;rangeId=range.id;}const validated=values.validation_status==="validated";const row={lab_order_id:detail.id,result_at:new Date().toISOString(),result_status:validated?"final":"preliminary",analyte_code:values.analyte_code,value:numeric?values.numeric_value:values.value,units:numeric?values.units:null,numeric_value:numeric?Number(values.numeric_value):null,reference_range_id:rangeId,reference_range:numeric?null:"Facility qualitative interpretation",interpretation,validation_status:values.validation_status,validation_note:values.validation_note||null,validated_by_provider_id:validated?currentProviderId:null,validated_at:validated?new Date().toISOString():null};const {error:saveError}=await supabase.from("lab_results").insert(row);if(saveError)throw saveError;if(validated)await supabase.from("orders").update({status:"completed"}).eq("id",orderId);closeModal();notify(validated?"Result validated and released.":"Laboratory result saved without release.");await hydrateClinicalView("orders")});
    }else{
      const label=orderType==="imaging"?"Imaging report":"Specialty / procedure report",code=detail.modality||detail.procedure_code;
      showModal(label,`<div class="live-banner"><strong>${safe(code)}</strong> · Imaging and specialty reports use findings and an impression, not laboratory reference ranges.</div><div class="result-list">${existingHtml}</div><form id="result-form"><label>Report / findings<textarea name="report_text" rows="9" required></textarea></label><label>Interpretation<select name="interpretation"><option value="normal">Normal</option><option value="out_of_range">Abnormal / follow-up required</option><option value="dangerously_abnormal">Critical finding</option></select></label><label>Report status<select name="result_status"><option value="preliminary">Preliminary</option><option value="final">Final</option></select></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Save report</button></footer></form>`);
      modal.querySelector("[data-cancel]").addEventListener("click",closeModal);modal.querySelector("#result-form").addEventListener("submit",async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.target));const row=orderType==="imaging"?{imaging_order_id:detail.id,result_at:new Date().toISOString(),report_text:values.report_text,interpretation:values.interpretation,result_status:values.result_status,radiologist_id:currentProviderId}:{procedure_order_id:detail.id,performed_at:new Date().toISOString(),report_text:values.report_text,interpretation:values.interpretation,result_status:values.result_status,performing_provider_id:currentProviderId};const {error:saveError}=await supabase.from(resultTable).insert(row);if(saveError)throw saveError;if(values.result_status==="final")await supabase.from("orders").update({status:"completed"}).eq("id",orderId);closeModal();notify("Report saved to the live record.");await hydrateClinicalView("orders")});
    }
  }catch(error){notify(error.message)}
}

async function orderForm(){
  try{
    const {patients,services}=await clinicalChoices();
    const {data:catalog,error:catalogError}=await supabase.from("clinical_order_catalog").select("id,order_type,code,name,use_text,reference_guidance,source_url").eq("active",true).order("name");
    if(catalogError)throw catalogError;
    showModal("Place order",`<form id="clinical-form"><label>Patient<select name="patient_id" required>${optionList(patients,p=>`${p.last_name}, ${p.first_name} · ${p.snau||"UNIN pending"}`)}</select></label><label>Destination<select name="order_type" id="order-destination" required><option value="lab">Laboratory</option><option value="imaging">Imaging</option><option value="procedure">Other specialty / procedure</option></select></label><label>Requested service<select name="service_id" id="order-service" required></select></label><label>Test / modality / procedure<select name="catalog_id" id="order-catalog" required></select></label><div class="order-guidance" id="order-guidance" role="note"></div><label id="order-custom-label" hidden>Order not listed<input name="requested_code_custom"></label><label>Priority<select name="priority"><option>Routine</option><option>Urgent</option><option>STAT</option></select></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Place order</button></footer></form>`);
    const form=modal.querySelector("#clinical-form");modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
    const destination=form.querySelector("#order-destination"),serviceSelect=form.querySelector("#order-service"),catalogSelect=form.querySelector("#order-catalog"),guidance=form.querySelector("#order-guidance"),customLabel=form.querySelector("#order-custom-label"),customInput=customLabel.querySelector("input");
    const serviceMatches=(service,type)=>{const text=`${service.departments?.name||""} ${service.name||""}`.toLowerCase();const lab=/laborator|patholog|blood bank|specimen|phlebot/.test(text),imaging=/radiolog|imaging|x-ray|xray|ultrasound|mammograph|fluoroscop|nuclear medicine|pet scan|mri|ct scan/.test(text);return type==="lab"?lab:type==="imaging"?imaging:!lab&&!imaging};
    const renderGuidance=()=>{const item=(catalog||[]).find(row=>String(row.id)===catalogSelect.value);const custom=catalogSelect.value==="__other__";customLabel.hidden=!custom;customInput.required=custom;if(!item){guidance.innerHTML=custom?"Enter the facility-approved order name or code.":"Select an order to see its clinical use and interpretation guidance.";return;}guidance.innerHTML=`<strong>${safe(item.name)}</strong><span><b>Use:</b> ${safe(item.use_text)}</span><span><b>Range / interpretation:</b> ${safe(item.reference_guidance)}</span>${item.source_url?`<a href="${safe(item.source_url)}" target="_blank" rel="noopener">Clinical reference</a>`:""}`};
    const refreshCatalog=()=>{const rows=(catalog||[]).filter(item=>item.order_type===destination.value);catalogSelect.innerHTML='<option value="">Select an order</option>'+rows.map(item=>`<option value="${item.id}">${safe(item.name)}${item.code?` · ${safe(item.code)}`:""}</option>`).join("")+'<option value="__other__">Other / facility-defined order</option>';renderGuidance()};
    const refreshServices=()=>{const rows=services.filter(service=>serviceMatches(service,destination.value)).sort((a,b)=>`${a.departments?.name||""} ${a.name}`.localeCompare(`${b.departments?.name||""} ${b.name}`));serviceSelect.innerHTML=optionList(rows,s=>`${s.departments?.name||"Department"} · ${s.name}`,`Select ${destination.selectedOptions[0]?.textContent||"service"}`);refreshCatalog()};
    destination.addEventListener("change",refreshServices);catalogSelect.addEventListener("change",renderGuidance);refreshServices();
    form.addEventListener("submit",async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form));const item=(catalog||[]).find(row=>String(row.id)===values.catalog_id);const requestedCode=values.catalog_id==="__other__"?String(values.requested_code_custom||"").trim():(item?.code||item?.name);if(!requestedCode)return notify("Select or enter an order.");const {data:order,error}=await supabase.from("orders").insert({patient_id:Number(values.patient_id),ordering_provider_id:currentProviderId,order_type:values.order_type,service_id:Number(values.service_id),status:"pending"}).select("id").single();if(error)return notify(error.message);const details=values.order_type==="lab"?{order_id:order.id,test_code:requestedCode,priority:values.priority}:values.order_type==="imaging"?{order_id:order.id,modality:requestedCode,contrast:false}:{order_id:order.id,procedure_code:requestedCode};const {error:detailError}=await supabase.from(`${values.order_type}_orders`).insert(details);if(detailError)return notify(detailError.message);closeModal();notify("Order placed and recorded.");await hydrateClinicalView("orders")});
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
  const patientLink=event.target.closest("[data-live-patient]");
  if(patientLink){event.preventDefault();event.stopImmediatePropagation();patientActionMenu(Number(patientLink.dataset.livePatient),patientLink.dataset.patientName);return}
  const profileAction=event.target.closest("[data-patient-profile]");
  if(profileAction){event.preventDefault();event.stopImmediatePropagation();selectedLivePatientId=Number(profileAction.dataset.patientProfile);closeModal();document.querySelector('#primary-nav [data-view="chart"]')?.click();return}
  const encounterAction=event.target.closest("[data-patient-encounter]");
  if(encounterAction){event.preventDefault();event.stopImmediatePropagation();encounterForm(Number(encounterAction.dataset.patientEncounter));return}
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
  if(event.detail?.view==="triage")hydrateTriage();
  if(event.detail?.view==="chart")renderLivePatientChart();
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
