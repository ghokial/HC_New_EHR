// Facility setting for the image archive (PACS) reached over DICOMweb QIDO-RS.
// Stored in integration_endpoints (facility administrators only, enforced by the database).
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

export async function renderImagingArchiveSettings(supabase,app,facilityId){
  if(!facilityId)return;
  app.querySelector("#imaging-archive-settings")?.remove();
  const {data,error}=await supabase.from("integration_endpoints").select("id,base_url,enabled,configuration").eq("facility_id",facilityId).eq("integration_type","dicomweb_qido").maybeSingle();
  if(error)return; // Only facility administrators can see and change this.
  const cfg=data?.configuration||{};
  const section=document.createElement("section");section.id="imaging-archive-settings";section.className="card feature-card";
  section.innerHTML=`<h2>Image archive (DICOMweb)</h2><p class="muted">Imaging staff can search this archive for the study matching an order's accession number and link it to the order. Healthcarology stores the study reference, not the images.</p><form><label>QIDO-RS base URL<input name="base_url" type="url" required placeholder="https://pacs.example/dicom-web" value="${esc(data?.base_url||"")}"></label><label>Viewer URL template (optional)<input name="viewer" placeholder="https://viewer.example/viewer?StudyInstanceUIDs={StudyInstanceUID}" value="${esc(cfg.viewer_url_template||"")}"></label><label>Name of the Edge Function secret holding the archive's bearer token (optional)<input name="auth_env" pattern="[A-Z][A-Z0-9_]*" placeholder="PACS_TOKEN" value="${esc(cfg.auth_env||"")}"></label><label><input type="checkbox" name="enabled" ${data?.enabled!==false?"checked":""}> Enabled</label><button class="button">Save archive</button><p class="form-result"></p></form>`;
  (app.querySelector("#lab-interfaces")||app.querySelector("#laboratory-department")||app.querySelector("main.portal"))?.after?.(section);
  if(!section.isConnected)app.querySelector("main.portal")?.append(section);
  section.querySelector("form").onsubmit=async event=>{
    event.preventDefault();const f=new FormData(event.target),out=event.target.querySelector(".form-result");
    const row={facility_id:facilityId,integration_type:"dicomweb_qido",base_url:String(f.get("base_url")).trim(),enabled:f.get("enabled")==="on",configuration:{...(f.get("viewer")?{viewer_url_template:String(f.get("viewer")).trim()}:{}),...(f.get("auth_env")?{auth_env:String(f.get("auth_env")).trim()}:{})}};
    const {error:saveError}=data?await supabase.from("integration_endpoints").update(row).eq("id",data.id):await supabase.from("integration_endpoints").insert(row);
    out.textContent=saveError?saveError.message:"Saved.";
  };
}
