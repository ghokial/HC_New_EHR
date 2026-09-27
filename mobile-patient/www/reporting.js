// Facility reports (aggregate metrics), audited CSV export, and DHIS2 export settings.
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const LABELS={new_patients:"New patients registered",outpatient_encounters:"Outpatient and emergency encounters",inpatient_admissions:"Inpatient admissions",discharges:"Discharges",average_length_of_stay_days:"Average length of stay (days)",beds_active:"Active beds",beds_occupied_now:"Beds occupied now",lab_results_validated:"Lab results validated",lab_median_turnaround_hours:"Median lab turnaround (hours, order to validation)",appointments_completed:"Appointments completed",appointments_no_show:"Appointment no-shows",emergency_accesses:"Emergency (break-glass) record accesses"};
const MAPPABLE=["new_patients","outpatient_encounters","inpatient_admissions","discharges","lab_results_validated","appointments_completed","appointments_no_show","emergency_accesses"];
const iso=d=>d.toISOString().slice(0,10);

export function reportCsv(report){
  const rows=[["metric","value"],...Object.keys(LABELS).map(k=>[LABELS[k],report[k]??""]),...Object.entries(report.encounters_by_type||{}).map(([k,v])=>[`Encounters: ${k}`,v]),...Object.entries(report.appointments_by_status||{}).map(([k,v])=>[`Appointments: ${k}`,v]),...(report.top_diagnoses||[]).map(d=>[`Diagnosis ${d.code} ${d.display}`,d.count])];
  return rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\r\n");
}

export async function renderFacilityReports(supabase,app,facilityId){
  if(!facilityId)return;
  app.querySelector("#facility-reports")?.remove();
  const today=new Date(),first=new Date(today.getFullYear(),today.getMonth(),1);
  const probe=await supabase.rpc("facility_report",{target_facility:facilityId,period_start:iso(first),period_end:iso(today)});
  if(probe.error)return; // Not permitted to view reports.
  const section=document.createElement("section");section.id="facility-reports";section.className="card feature-card";
  app.querySelector("main.portal")?.append(section);
  const draw=report=>{
    const metric=k=>`<article class="metric"><span class="metric-label">${esc(LABELS[k])}</span><strong>${esc(report[k]??"—")}</strong></article>`;
    section.innerHTML=`<h2>Facility reports</h2><form class="appointment-toolbar" id="report-period"><label>From<input type="date" name="from" value="${esc(report.period_start)}" required></label><label>To<input type="date" name="to" value="${esc(report.period_end)}" required></label><button class="button">Update</button><button type="button" class="button secondary" data-report-csv>Download CSV</button></form>
     <div class="metrics">${Object.keys(LABELS).map(metric).join("")}</div>
     <div class="grid"><div><h3>Encounters by type</h3>${Object.entries(report.encounters_by_type||{}).map(([k,v])=>`<div class="row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")||'<p class="muted">None.</p>'}</div><div><h3>Appointments by status</h3>${Object.entries(report.appointments_by_status||{}).map(([k,v])=>`<div class="row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("")||'<p class="muted">None.</p>'}</div><div><h3>Top diagnoses</h3>${(report.top_diagnoses||[]).map(d=>`<div class="row"><span>${esc(d.code)} · ${esc(d.display)}</span><strong>${esc(d.count)}</strong></div>`).join("")||'<p class="muted">None.</p>'}</div></div>
     <details id="dhis2-export"><summary>DHIS2 export</summary><p class="muted">Loading…</p></details>`;
    section.querySelector("#report-period").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const {data,error}=await supabase.rpc("facility_report",{target_facility:facilityId,period_start:f.get("from"),period_end:f.get("to")});if(error)return alert(error.message);draw(data)};
    section.querySelector("[data-report-csv]").onclick=async()=>{const {error}=await supabase.from("data_export_audit").insert({facility_id:facilityId,exported_by:(await supabase.auth.getUser()).data.user.id,export_type:"CSV",module:"facility_report",filter_parameters:{from:report.period_start,to:report.period_end}});if(error)return alert(`The export could not be recorded, so it was not downloaded: ${error.message}`);const blob=new Blob([reportCsv(report)],{type:"text/csv"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`facility-report-${report.period_start}-to-${report.period_end}.csv`;a.click();URL.revokeObjectURL(a.href)};
    section.querySelector("#dhis2-export").addEventListener("toggle",event=>{if(event.target.open)drawDhis2(event.target)},{once:true});
  };
  const drawDhis2=async host=>{
    const [{data:settings,error},{data:mappings},{data:endpoint}]=await Promise.all([
      supabase.from("facility_dhis2_settings").select("org_unit_uid,data_set_uid").eq("facility_id",facilityId).maybeSingle(),
      supabase.from("dhis2_data_element_mappings").select("id,metric_code,data_element_uid,category_option_combo_uid").eq("facility_id",facilityId),
      supabase.from("integration_endpoints").select("id,base_url,enabled,configuration").eq("facility_id",facilityId).eq("integration_type","dhis2_web_api").maybeSingle()
    ]);
    if(error){host.innerHTML=`<summary>DHIS2 export</summary><p class="muted">Only facility administrators manage DHIS2 export.</p>`;return}
    const byMetric=new Map((mappings||[]).map(m=>[m.metric_code,m]));
    const lastMonth=new Date(today.getFullYear(),today.getMonth()-1,1),period=`${lastMonth.getFullYear()}${String(lastMonth.getMonth()+1).padStart(2,"0")}`;
    host.innerHTML=`<summary>DHIS2 export</summary><p class="muted">Enter the identifiers from your own DHIS2 instance (11-character UIDs). Only mapped metrics are sent. Nothing is sent until you press Send.</p>
     <form id="dhis2-settings"><div class="grid"><label>DHIS2 Web API base URL<input name="base_url" type="url" placeholder="https://dhis2.example.org" value="${esc(endpoint?.base_url||"")}"></label><label>Token secret name (Edge Function secret)<input name="auth_env" pattern="[A-Z][A-Z0-9_]*" placeholder="DHIS2_TOKEN" value="${esc(endpoint?.configuration?.auth_env||"")}"></label><label>Organisation unit UID<input name="org_unit" required pattern="[A-Za-z][A-Za-z0-9]{10}" value="${esc(settings?.org_unit_uid||"")}"></label><label>Data set UID (optional)<input name="data_set" pattern="[A-Za-z][A-Za-z0-9]{10}" value="${esc(settings?.data_set_uid||"")}"></label></div>
     <h4>Metric → data element</h4>${MAPPABLE.map(k=>`<div class="grid"><span>${esc(LABELS[k])}</span><input name="de_${k}" pattern="[A-Za-z][A-Za-z0-9]{10}" placeholder="Data element UID" value="${esc(byMetric.get(k)?.data_element_uid||"")}"><input name="coc_${k}" pattern="[A-Za-z][A-Za-z0-9]{10}" placeholder="Category option combo UID (optional)" value="${esc(byMetric.get(k)?.category_option_combo_uid||"")}"></div>`).join("")}
     <button class="button">Save DHIS2 settings</button><p class="form-result"></p></form>
     <form id="dhis2-send" class="appointment-toolbar"><label>Month (YYYYMM)<input name="period" pattern="[0-9]{4}(0[1-9]|1[0-2])" value="${period}" required></label><button type="button" class="button secondary" data-dhis2-preview>Preview payload</button><button class="button">Send to DHIS2</button></form><pre class="record-json" id="dhis2-output"></pre>`;
    const out=host.querySelector("#dhis2-output");
    host.querySelector("#dhis2-settings").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),result=e.target.querySelector(".form-result");
      const s=await supabase.from("facility_dhis2_settings").upsert({facility_id:facilityId,org_unit_uid:f.get("org_unit"),data_set_uid:f.get("data_set")||null,updated_at:new Date().toISOString()});if(s.error)return result.textContent=s.error.message;
      for(const k of MAPPABLE){const de=String(f.get(`de_${k}`)||"").trim(),coc=String(f.get(`coc_${k}`)||"").trim()||null,existing=byMetric.get(k);const r=de?existing?await supabase.from("dhis2_data_element_mappings").update({data_element_uid:de,category_option_combo_uid:coc}).eq("id",existing.id):await supabase.from("dhis2_data_element_mappings").insert({facility_id:facilityId,metric_code:k,data_element_uid:de,category_option_combo_uid:coc}):existing?await supabase.from("dhis2_data_element_mappings").delete().eq("id",existing.id):{error:null};if(r.error)return result.textContent=`${LABELS[k]}: ${r.error.message}`}
      if(f.get("base_url")){const row={facility_id:facilityId,integration_type:"dhis2_web_api",base_url:String(f.get("base_url")).trim(),enabled:true,configuration:f.get("auth_env")?{auth_env:String(f.get("auth_env")).trim()}:{}};const r=endpoint?await supabase.from("integration_endpoints").update(row).eq("id",endpoint.id):await supabase.from("integration_endpoints").insert(row);if(r.error)return result.textContent=r.error.message}
      result.textContent="Saved.";};
    const run=async dry=>{const period=new FormData(host.querySelector("#dhis2-send")).get("period");const {data,error:sendError}=await supabase.functions.invoke("dhis2-push",{body:{facility_id:facilityId,period,dry_run:dry}});out.textContent=JSON.stringify(sendError?{error:sendError.message}:data,null,2)};
    host.querySelector("[data-dhis2-preview]").onclick=()=>run(true);
    host.querySelector("#dhis2-send").onsubmit=e=>{e.preventDefault();if(confirm("Send this month's aggregate figures to DHIS2?"))run(false)};
  };
  draw(probe.data);
}
