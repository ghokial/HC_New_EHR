import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const modal = document.querySelector("#live-modal");
let session = null;

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
  gate.innerHTML = `<section class="auth-card"><img class="portal-logo" src="/assets/images/healthcarology-logo.png" alt="Healthcarology"><p class="eyebrow">Secure access</p><h1>Healthcarology EHR</h1><p>Sign in with your email and password. New accounts must replace their temporary password before accessing the platform.</p><form id="login-form"><label>Language<select id="login-language"><option value="en">English</option><option value="fr">Français</option><option value="am">አማርኛ</option><option value="pt">Português</option><option value="es">Español</option><option value="bn">বাংলা</option><option value="kg">Kikongo</option><option value="lua">Tshiluba</option><option value="sw">Kiswahili</option><option value="ln">Lingála</option></select></label><input type="email" name="email" autocomplete="email" placeholder="Authorized email" required aria-label="Email"><input type="password" name="password" autocomplete="current-password" placeholder="Password" required aria-label="Password"><button class="button primary">Sign in</button><button type="button" class="button secondary" id="reset-password">Set or reset password</button></form><p id="auth-message">Authorized users only. All access is auditable.</p></section>`;
  const language=gate.querySelector("#login-language");language.value=localStorage.getItem("hc_locale")||"en";language.addEventListener("change",()=>{localStorage.setItem("hc_locale",language.value);document.documentElement.lang=language.value});
  document.body.append(gate);
  gate.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const { error } = await supabase.auth.signInWithPassword({ email: form.get("email"), password: form.get("password") });
    gate.querySelector("#auth-message").textContent = error ? error.message : "Signed in securely.";
  });
  gate.querySelector("#reset-password").addEventListener("click", async () => {
    const email = gate.querySelector('input[name="email"]').value.trim();
    if (!email) { gate.querySelector("#auth-message").textContent = "Enter your authorized email first."; return; }
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
  select.innerHTML = `<option value="">Select country</option>` + data.map(c => `<option value="${c.id}">${c.default_name} (${c.iso2})</option>`).join("");
}

async function patientForm() {
  const {data:membership}=await supabase.from("facility_memberships").select("facility_id").eq("user_id",session.user.id).eq("active",true).limit(1).maybeSingle();
  showModal("Register patient", `<form id="patient-form"><div class="live-banner">UNIN is generated automatically once and is permanent. MRN belongs to the registering facility.</div><label>Patient type<select name="patient_type" required><option>Standard Patient</option><option>Military</option><option>Military Dependent</option><option>Police</option><option>Police Dependent</option><option>Public Servant / Fonctionnaire</option><option>Public Servant / Fonctionnaire Dependent</option><option>Personnel CIVIL (PERCI) / Civilian Personnel</option><option>Personnel CIVIL (PERCI) / Civilian Personnel Dependent</option></select></label><label>First name<input name="first_name" required></label><label>Middle name<input name="middle_name"></label><label>Last name<input name="last_name" required></label><label>Facility MRN<input name="mrn"></label><label>Date of birth<input type="date" name="date_of_birth"></label><label>Gender<select name="gender_identity" id="patient-gender"><option value="">Not specified</option><option>Male</option><option>Female</option><option>Other</option></select></label><label id="patient-gender-other" hidden>Other gender<input name="gender_other"></label><label>Ethnicity<select name="ethnicity" id="patient-ethnicity"><option value="">Not specified</option><option>Black</option><option>White</option><option>Arab</option><option>Asian</option><option>Latino</option><option>Other</option></select></label><label id="patient-ethnicity-other" hidden>Other ethnicity<input name="ethnicity_other"></label><label>Preferred language<input name="preferred_language" placeholder="Language"></label><label>Primary phone<div class="phone-grid"><input name="country_calling_code" placeholder="Country code, e.g. +243"><input name="phone" type="tel"></div></label><label>Service / matricule ID<input name="service_identifier"></label><label>Rank<input name="service_rank"></label><label>Unit<input name="service_unit"></label><label>Dependent relationship<select name="dependent_relationship"><option value="">Not a dependent</option><option>Spouse</option><option>Child</option><option>Parent</option></select></label><label>Related member name<input name="related_service_member_name"></label><label>Related member service ID<input name="related_service_identifier"></label><label>Country<select name="country_id" id="country-select" required></select></label><label>Address line 1<input name="line1" required></label><label>Postal code<input name="postal_code_text"></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Create patient</button></footer></form>`);
  modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
  await loadCountries(modal.querySelector("#country-select"));
  for(const [selectId,otherId] of [["#patient-gender","#patient-gender-other"],["#patient-ethnicity","#patient-ethnicity-other"]]){const select=modal.querySelector(selectId),other=modal.querySelector(otherId),input=other.querySelector("input");select.addEventListener("change",()=>{const show=select.value==="Other";other.hidden=!show;input.required=show;if(!show)input.value=""})}
  modal.querySelector("#patient-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const { data: address, error: addressError } = await supabase.from("addresses").insert({ line1: values.line1, country_id: Number(values.country_id),postal_code_text:values.postal_code_text||null }).select("id").single();
    if (addressError) return notify(addressError.message);
    const patient = {first_name:values.first_name,last_name:values.last_name,middle_name:values.middle_name||null,date_of_birth:values.date_of_birth||null,sex:values.gender_identity==="Male"?"M":values.gender_identity==="Female"?"F":values.gender_identity?"X":null,gender_identity:values.gender_identity||null,gender_other:values.gender_other||null,ethnicity:values.ethnicity||null,ethnicity_other:values.ethnicity_other||null,preferred_language:values.preferred_language||null,patient_type:values.patient_type,service_identifier:values.service_identifier||null,service_rank:values.service_rank||null,service_unit:values.service_unit||null,dependent_relationship:values.dependent_relationship||null,related_service_member_name:values.related_service_member_name||null,related_service_identifier:values.related_service_identifier||null,primary_address_id:address.id,facility_id:membership?.facility_id||null};
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
  showModal("Create user", `<form id="user-form"><div class="live-banner">A strong temporary password will be generated and shown once.</div><label>Email<input type="email" name="email" required></label><label>Display name<input name="display_name" required></label><label>Role<select name="role_code" required>${roles.map(r=>`<option value="${r.role_code}">${r.role_name}</option>`).join("")}</select></label><label>Scope<input name="scope" value="hospital_main" required></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Create account</button></footer></form>`);
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

async function setSignedInUser() {
  if (!session) return;
  const { data: profile } = await supabase.from("profiles").select("display_name,email").eq("user_id",session.user.id).maybeSingle();
  const { data: role } = await supabase.from("user_roles").select("roles(role_name,role_code)").eq("user_id",session.user.id).limit(1).maybeSingle();
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
}, true);

document.addEventListener("hc:view-rendered", () => hydrateLivePatients());

const { data } = await supabase.auth.getSession();
session = data.session;
if (!session) authGate(); else if(session.user.app_metadata?.must_change_password===true) passwordChangeGate(); else { await setSignedInUser(); await hydrateLivePatients(); }
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
