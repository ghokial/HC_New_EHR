// Consent-based record exchange between facilities (staff and patient screens).
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const when=value=>value?new Date(value).toLocaleString():"—";
export const SECTIONS={encounters:"Visits and stays",diagnoses:"Diagnoses",medications:"Medications",allergies:"Allergies",immunizations:"Immunizations",labs:"Validated lab results",notes:"Signed clinical notes"};
const statusLabel={requested:"Waiting for the patient",approved:"Approved",denied:"Denied",revoked:"Revoked",emergency:"Emergency access"};
const active=g=>["approved","emergency"].includes(g.status)&&new Date(g.expires_at)>new Date();

function renderRecord(record){
  const list=(title,items,line)=>items?`<h3>${esc(title)}</h3>${items.length?`<div class="compact-list">${items.map(item=>`<div class="data-row">${line(item)}</div>`).join("")}</div>`:'<p class="empty">None recorded.</p>'}`:"";
  return `<div class="live-banner"><strong>${esc(record.patient?.name)}</strong> · UNIN ${esc(record.patient?.unin||"—")} · born ${esc(record.patient?.date_of_birth||"—")} · ${esc(statusLabel[record.grant.status])} until ${esc(when(record.grant.expires_at))}</div>
   ${list("Allergies",record.allergies,x=>`<span>${esc(x.substance)}${x.reaction?` · ${esc(x.reaction)}`:""}</span><strong>${esc(x.severity)} · ${esc(x.verification)}</strong>`)}
   ${list("Diagnoses",record.diagnoses,x=>`<span>${esc(x.code)} · ${esc(x.display)}</span><strong>${esc(x.status)}</strong>`)}
   ${list("Medications",record.medications,x=>`<span>${esc(x.medication)} ${esc(x.strength||"")} · ${esc(x.dose)} ${esc(x.route||"")} ${esc(x.frequency||"")}</span><strong>${esc(x.status)}</strong>`)}
   ${list("Immunizations",record.immunizations,x=>`<span>${esc(x.vaccine)}${x.dose?` · dose ${esc(x.dose)}`:""}</span><strong>${esc(when(x.date))}</strong>`)}
   ${list("Validated lab results",record.labs,x=>`<span>${esc(x.test)} · ${esc(x.value)} ${esc(x.units||"")}${x.range?` (${esc(x.range)})`:""}</span><strong>${esc(x.interpretation||"")} · ${esc(when(x.date))}</strong>`)}
   ${list("Visits and stays",record.encounters,x=>`<span>${esc(x.type)} · ${esc(x.facility||"")}</span><strong>${esc(x.status)} · ${esc(when(x.start))}</strong>`)}
   ${list("Signed clinical notes",record.notes,x=>`<span>${esc(x.type)}<small>${esc(x.content)}</small></span><strong>${esc(when(x.signed))}</strong>`)}`;
}

export function attachStaffRecordExchange({supabase,showModal,closeModal,notify,getFacilityId}){
  async function open(){
    const facilityId=getFacilityId();
    const {data,error}=await supabase.from("facility_record_access_grants").select("id,status,purpose,sections,requested_at,expires_at,emergency_reason,patient_id").eq("requesting_facility_id",facilityId).order("requested_at",{ascending:false}).limit(100);
    if(error)return notify(error.message);
    showModal("Records from other facilities",`<div class="live-banner">Ask for a patient's record held at other Healthcarology facilities. The patient approves or denies in their portal, chooses how long, and can revoke at any time.</div>
     <form id="exchange-request"><label>UNIN<input name="unin" required></label><label>Last name<input name="last" required></label><label>Date of birth<input type="date" name="dob" required></label><label>Purpose<input name="purpose" required placeholder="e.g. Referral for cardiology follow-up"></label><fieldset><legend>Sections requested</legend>${Object.entries(SECTIONS).map(([k,v])=>`<label><input type="checkbox" name="sections" value="${k}" ${["diagnoses","medications","allergies"].includes(k)?"checked":""}> ${esc(v)}</label>`).join(" ")}</fieldset><footer><button class="button primary">Send request to the patient</button></footer></form>
     <details><summary>Emergency access (break-glass)</summary><form id="exchange-emergency"><p class="alert">For emergencies when the patient cannot consent. Physicians, residents, and advanced practice clinicians only. Access lasts 24 hours, covers all sections, is flagged to compliance at both facilities, and is shown to the patient.</p><label>UNIN<input name="unin" required></label><label>Last name<input name="last" required></label><label>Date of birth<input type="date" name="dob" required></label><label>Describe the emergency<textarea name="reason" required minlength="10"></textarea></label><footer><button class="button primary">Open emergency access</button></footer></form></details>
     <h3>Requests from this facility</h3><div class="compact-list">${(data||[]).map(g=>`<div class="data-row"><span>${esc(g.purpose)}<small>Requested ${esc(when(g.requested_at))} · ${esc((g.sections||[]).map(s=>SECTIONS[s]||s).join(", "))}${g.emergency_reason?` · ${esc(g.emergency_reason)}`:""}</small></span><strong>${esc(statusLabel[g.status]||g.status)}${active(g)?` until ${esc(when(g.expires_at))} <button type="button" class="button ghost" data-read-grant="${esc(g.id)}">Open record</button>`:""}</strong></div>`).join("")||'<p class="empty">No requests yet.</p>'}</div>`);
    const facility=facilityId;
    modal().querySelector("#exchange-request").onsubmit=async event=>{event.preventDefault();const f=new FormData(event.target),sections=f.getAll("sections");if(!sections.length)return notify("Choose at least one section.");const {error:reqError}=await supabase.rpc("request_facility_record_access",{requesting_facility:facility,unin:f.get("unin"),last_name:f.get("last"),birth:f.get("dob"),request_purpose:f.get("purpose"),requested_sections:sections});if(reqError)return notify(reqError.message);notify("Request sent. The patient will see it in their portal.");await open()};
    modal().querySelector("#exchange-emergency").onsubmit=async event=>{event.preventDefault();if(!confirm("Open emergency access? This is flagged to compliance and shown to the patient."))return;const f=new FormData(event.target);const {data:grant,error:emError}=await supabase.rpc("emergency_facility_record_access",{requesting_facility:facility,unin:f.get("unin"),last_name:f.get("last"),birth:f.get("dob"),reason:f.get("reason")});if(emError)return notify(emError.message);await read(grant)};
    modal().querySelectorAll("[data-read-grant]").forEach(button=>button.onclick=()=>read(button.dataset.readGrant));
  }
  async function read(grantId){
    const {data,error}=await supabase.rpc("read_shared_facility_record",{target_grant:grantId});
    if(error)return notify(error.message);
    showModal("Shared record (read only)",renderRecord(data));
  }
  const modal=()=>document.querySelector("#live-modal");
  return {open};
}

export async function renderPatientRecordRequests(supabase,app){
  app.querySelector("#record-requests")?.remove();
  const {data,error}=await supabase.from("facility_record_access_grants").select("id,status,purpose,sections,requested_at,expires_at,emergency_reason,requesting_facility_name").order("requested_at",{ascending:false}).limit(50);
  if(error||!(data||[]).length)return;
  const section=document.createElement("section");section.id="record-requests";section.className="card";
  section.innerHTML=`<h2>Requests to see your record</h2><p class="muted">Other facilities can read your record only with your approval, or in an emergency, which is always shown here.</p><div class="compact-list">${data.map(g=>`<div class="row"><span><strong>${esc(g.requesting_facility_name)}</strong><small>${esc(g.purpose)} · ${esc((g.sections||[]).map(s=>SECTIONS[s]||s).join(", "))}${g.emergency_reason?` · Emergency: ${esc(g.emergency_reason)}`:""}</small><small>${esc(statusLabel[g.status]||g.status)}${g.expires_at?` · until ${esc(when(g.expires_at))}`:""}</small></span><span>${g.status==="requested"?`<select data-days="${esc(g.id)}"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option><option value="90">90 days</option></select> <button type="button" class="button" data-approve="${esc(g.id)}">Approve</button> <button type="button" class="button secondary" data-deny="${esc(g.id)}">Deny</button>`:active(g)?`<button type="button" class="button secondary" data-revoke="${esc(g.id)}">Revoke</button>`:""}</span></div>`).join("")}</div>`;
  app.querySelector("main.portal")?.append(section);
  const refresh=()=>renderPatientRecordRequests(supabase,app);
  section.querySelectorAll("[data-approve]").forEach(b=>b.onclick=async()=>{const days=Number(section.querySelector(`[data-days="${b.dataset.approve}"]`).value);const {error:e}=await supabase.rpc("respond_facility_record_access",{target_grant:b.dataset.approve,approve:true,days});if(e)return alert(e.message);refresh()});
  section.querySelectorAll("[data-deny]").forEach(b=>b.onclick=async()=>{const {error:e}=await supabase.rpc("respond_facility_record_access",{target_grant:b.dataset.deny,approve:false,days:null});if(e)return alert(e.message);refresh()});
  section.querySelectorAll("[data-revoke]").forEach(b=>b.onclick=async()=>{if(!confirm("Revoke this facility's access now?"))return;const {error:e}=await supabase.rpc("revoke_facility_record_access",{target_grant:b.dataset.revoke});if(e)return alert(e.message);refresh()});
}
