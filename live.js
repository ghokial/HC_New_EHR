import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
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
  gate.innerHTML = `<section class="auth-card"><p class="eyebrow">Secure access</p><h1>Healthcarology EHR</h1><p>Sign in with your email and password. New accounts must replace their temporary password before accessing the platform.</p><form id="login-form"><input type="email" name="email" autocomplete="email" placeholder="Authorized email" required aria-label="Email"><input type="password" name="password" autocomplete="current-password" placeholder="Password" required aria-label="Password"><button class="button primary">Sign in</button><button type="button" class="button secondary" id="reset-password">Set or reset password</button></form><p id="auth-message">Authorized users only. All access is auditable.</p></section>`;
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
  showModal("Register patient", `<form id="patient-form"><div class="live-banner">Writes directly to the live Healthcarology PostgreSQL database.</div><label>First name<input name="first_name" required></label><label>Middle name<input name="middle_name"></label><label>Last name<input name="last_name" required></label><label>MRN<input name="mrn"></label><label>UNIN / SNAU<input name="snau"></label><label>Date of birth<input type="date" name="date_of_birth"></label><label>Sex<select name="sex"><option value="">Not specified</option><option value="M">Male</option><option value="F">Female</option><option value="X">Other / X</option></select></label><label>Country<select name="country_id" id="country-select" required></select></label><label>Address line 1<input name="line1" required></label><footer><button type="button" class="button secondary" data-cancel>Cancel</button><button class="button primary">Create patient</button></footer></form>`);
  modal.querySelector("[data-cancel]").addEventListener("click",closeModal);
  await loadCountries(modal.querySelector("#country-select"));
  modal.querySelector("#patient-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    const { data: address, error: addressError } = await supabase.from("addresses").insert({ line1: values.line1, country_id: Number(values.country_id) }).select("id").single();
    if (addressError) return notify(addressError.message);
    const patient = {first_name:values.first_name,last_name:values.last_name,middle_name:values.middle_name||null,mrn:values.mrn||null,snau:values.snau||null,date_of_birth:values.date_of_birth||null,sex:values.sex||null,primary_address_id:address.id};
    const { error } = await supabase.from("patients").insert(patient);
    if (error) return notify(error.message);
    closeModal(); notify("Patient created in the live database."); await hydrateLivePatients();
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

new MutationObserver(() => hydrateLivePatients()).observe(document.querySelector("#view"), {childList:true,subtree:true});

const { data } = await supabase.auth.getSession();
session = data.session;
if (!session) authGate(); else if(session.user.app_metadata?.must_change_password===true) passwordChangeGate(); else { await setSignedInUser(); await hydrateLivePatients(); }
supabase.auth.onAuthStateChange((event,newSession)=>{session=newSession;if(event==="PASSWORD_RECOVERY"){document.querySelector(".auth-gate")?.remove();passwordChangeGate();return;}if(newSession) location.reload()});
