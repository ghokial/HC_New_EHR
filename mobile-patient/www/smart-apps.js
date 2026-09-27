// SMART on FHIR app management: Root registers apps (admin portal); patients see and
// withdraw the apps they have connected (patient portal).
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const when=value=>value?new Date(value).toLocaleString():"—";

export async function renderSmartApps(supabase,app){
  app.querySelector("#smart-apps")?.remove();
  const {data,error}=await supabase.rpc("list_smart_clients");
  if(error)return;
  const fhirBase=`${supabase.supabaseUrl||""}/functions/v1/fhir`;
  const section=document.createElement("section");section.id="smart-apps";section.className="card";
  section.innerHTML=`<h2>SMART on FHIR apps</h2><p class="muted">Registered apps let patients connect their record through the standard SMART App Launch (authorization code with PKCE). FHIR base URL: <code>${esc(fhirBase)}</code>. Discovery: <code>${esc(fhirBase)}/.well-known/smart-configuration</code>.</p>
  <div class="compact-list">${(data||[]).map(c=>`<div class="row"><span><strong>${esc(c.name)}</strong><small>${esc(c.client_id)} · ${c.confidential?"confidential":"public"} · ${esc((c.redirect_uris||[]).join(", "))}</small></span><button type="button" class="button secondary" data-smart-toggle="${esc(c.client_id)}" data-active="${c.active}">${c.active?"Deactivate":"Reactivate"}</button></div>`).join("")||'<p class="muted">No apps registered.</p>'}</div>
  <form id="smart-app-form"><label>App name<input name="name" required maxlength="120"></label><label>Redirect URIs (one per line; https, or http for localhost)<textarea name="uris" required></textarea></label><label><input type="checkbox" name="confidential"> Confidential app (can keep a client secret on a server)</label><button class="button">Register app</button><p class="form-result"></p></form>`;
  app.querySelector("main.portal")?.append(section);
  section.querySelector("#smart-app-form").onsubmit=async event=>{event.preventDefault();const f=new FormData(event.target),out=event.target.querySelector(".form-result");const uris=String(f.get("uris")).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);const {data:created,error:createError}=await supabase.rpc("register_smart_client",{app_name:f.get("name"),app_redirect_uris:uris,is_confidential:f.get("confidential")==="on"});if(createError){out.textContent=createError.message;return}out.innerHTML=`Registered. Client ID: <code>${esc(created.client_id)}</code>${created.client_secret?`<br>Client secret (shown only once): <code>${esc(created.client_secret)}</code>`:""}`};
  section.querySelectorAll("[data-smart-toggle]").forEach(button=>button.onclick=async()=>{const activate=button.dataset.active!=="true";if(!activate&&!confirm("Deactivate this app? All of its access tokens are revoked immediately."))return;const {error:toggleError}=await supabase.rpc("set_smart_client_active",{target_client:button.dataset.smartToggle,is_active:activate});if(toggleError)return alert(toggleError.message);await renderSmartApps(supabase,app)});
}

export async function renderMyConnectedApps(supabase,app){
  app.querySelector("#my-connected-apps")?.remove();
  const {data,error}=await supabase.rpc("my_smart_authorizations");
  if(error||!(data||[]).length)return;
  const section=document.createElement("section");section.id="my-connected-apps";section.className="card";
  section.innerHTML=`<h2>Connected apps</h2><p class="muted">Apps you allowed to read your record. Each access lasts one hour and every use is recorded.</p><div class="compact-list">${data.map(t=>{const active=!t.revoked_at&&new Date(t.expires_at)>new Date();return `<div class="row"><span><strong>${esc(t.app)}</strong><small>Allowed ${esc(when(t.created_at))} · ${active?`until ${esc(when(t.expires_at))}`:t.revoked_at?"withdrawn":"expired"}</small></span>${active?`<button type="button" class="button secondary" data-revoke-app="${esc(t.id)}">Withdraw</button>`:""}</div>`}).join("")}</div>`;
  app.querySelector("main.portal")?.append(section);
  section.querySelectorAll("[data-revoke-app]").forEach(button=>button.onclick=async()=>{const {error:revokeError}=await supabase.rpc("revoke_my_smart_authorization",{target_token:button.dataset.revokeApp});if(revokeError)return alert(revokeError.message);await renderMyConnectedApps(supabase,app)});
}
