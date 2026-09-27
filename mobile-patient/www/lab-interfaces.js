// Laboratory HL7 interfaces: register an analyzer or interface engine, show its key
// once, deactivate it, and review the message log. Visible to facility administrators
// and laboratory supervisors (the database enforces this).
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const when=value=>value?new Date(value).toLocaleString():"—";

export async function renderLabInterfaces(supabase,app,facilityId){
  if(!facilityId)return;
  app.querySelector("#lab-interfaces")?.remove();
  const [{data:interfaces,error},{data:messages}]=await Promise.all([
    supabase.from("lab_interfaces").select("id,name,active,created_at,last_message_at").eq("facility_id",facilityId).order("created_at"),
    supabase.from("hl7_messages").select("id,control_id,message_type,status,error,results_created,received_at,interface_id").eq("facility_id",facilityId).order("received_at",{ascending:false}).limit(50)
  ]);
  if(error)return; // Not an administrator or supervisor: nothing to show.
  const section=document.createElement("section");section.id="lab-interfaces";section.className="card feature-card";
  const endpoint=`${supabase.supabaseUrl||""}/functions/v1/hl7-lab`;
  const names=new Map((interfaces||[]).map(x=>[x.id,x.name]));
  section.innerHTML=`<h2>Laboratory HL7 interfaces</h2><p class="muted">Lab analyzers or an interface engine send HL7 v2 ORU^R01 results to <code>${esc(endpoint)}</code> with the header <code>X-Interface-Key</code>, and can fetch pending orders as ORM^O01 from <code>${esc(endpoint)}/orders</code>. Received results wait for laboratory-supervisor validation before anyone else sees them.</p>
  <div class="compact-list">${(interfaces||[]).map(x=>`<div class="data-row"><span><strong>${esc(x.name)}</strong><small>Created ${esc(when(x.created_at))} · last message ${esc(when(x.last_message_at))}</small></span><strong>${x.active?`Active <button type="button" class="button secondary" data-deactivate-interface="${esc(x.id)}">Deactivate</button>`:"Inactive"}</strong></div>`).join("")||'<p class="empty">No interfaces registered.</p>'}</div>
  <form id="lab-interface-form"><label>New interface name<input name="name" required maxlength="80" placeholder="e.g. Chemistry analyzer"></label><button class="button">Register interface</button><p class="form-result"></p></form>
  <h3>Recent HL7 messages</h3><div class="compact-list">${(messages||[]).map(m=>`<div class="data-row"><span>${esc(m.control_id)} · ${esc(m.message_type)} · ${esc(names.get(m.interface_id)||"")}<small>${esc(when(m.received_at))}${m.error?` · ${esc(m.error)}`:""}</small></span><strong>${esc(m.status)}${m.status==="accepted"?` · ${esc(m.results_created)} result(s)`:""}</strong></div>`).join("")||'<p class="empty">No messages received yet.</p>'}</div>`;
  (app.querySelector("#laboratory-department")||app.querySelector("main.portal"))?.after?.(section);
  if(!section.isConnected)app.querySelector("main.portal")?.append(section);
  section.querySelector("#lab-interface-form").onsubmit=async event=>{
    event.preventDefault();const out=event.target.querySelector(".form-result");
    const {data,error:createError}=await supabase.rpc("create_lab_interface",{target_facility:facilityId,interface_name:new FormData(event.target).get("name")});
    if(createError){out.textContent=createError.message;return}
    out.innerHTML=`Interface registered. Copy this key into the lab system now; it is shown only once and cannot be recovered:<br><code>${esc(data.secret_key)}</code>`;
  };
  section.querySelectorAll("[data-deactivate-interface]").forEach(button=>button.onclick=async()=>{
    if(!confirm("Deactivate this interface? It will be unable to send results until a new interface is registered."))return;
    const {error:updateError}=await supabase.from("lab_interfaces").update({active:false}).eq("id",button.dataset.deactivateInterface);
    if(updateError)return alert(updateError.message);
    await renderLabInterfaces(supabase,app,facilityId);
  });
}
