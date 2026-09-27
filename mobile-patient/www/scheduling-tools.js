// Staff scheduling tools shown on the facility appointment calendar:
// create repeating provider availability, and book a slot for a registered patient.
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const when=value=>new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(value));
const weekdayNames=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

export function attachSchedulingTools(supabase,section,{facilityId,departments,services,providers}){
 if(section.querySelector("[data-scheduling-tools]"))return;
 const bar=document.createElement("div");bar.className="appointment-toolbar";bar.dataset.schedulingTools="";
 bar.innerHTML='<button type="button" class="button" data-create-availability>Create availability</button><button type="button" class="button secondary" data-book-for-patient>Book for a patient</button>';
 section.querySelector("h2")?.after(bar);
 const dialog=()=>{let d=document.querySelector("#scheduling-dialog");if(!d){d=document.createElement("dialog");d.id="scheduling-dialog";d.className="appointment-dialog";document.body.append(d)}return d};
 const options=(rows,label,empty)=>`<option value="">${esc(empty)}</option>`+rows.map(row=>`<option value="${esc(row.id)}">${esc(label(row))}</option>`).join("");

 bar.querySelector("[data-create-availability]").onclick=()=>{
  const d=dialog(),today=new Date().toISOString().slice(0,10),zone=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
  d.innerHTML=`<form method="dialog"><h3>Create provider availability</h3><label>Department<select name="department" required>${options(departments,x=>x.name,"Select department")}</select></label><label>Service<select name="service">${options([],x=>x.name,"Any service")}</select></label><label>Provider<select name="provider">${options(providers,x=>x.name,"No specific provider")}</select></label><div class="grid"><label>First day<input type="date" name="first" required value="${today}"></label><label>Last day<input type="date" name="last" required value="${today}"></label></div><fieldset><legend>Days of the week</legend>${weekdayNames.map((name,i)=>`<label><input type="checkbox" name="weekday" value="${i+1}" ${i<5?"checked":""}> ${name}</label>`).join(" ")}</fieldset><div class="grid"><label>Start time<input type="time" name="start" required value="08:00"></label><label>End time<input type="time" name="end" required value="12:00"></label><label>Slot length (minutes)<input type="number" name="minutes" min="5" max="480" required value="20"></label></div><label>Time zone<input name="tz" required value="${esc(zone)}"></label><button class="button">Create slots</button> <button type="button" class="button secondary" data-close>Close</button><p class="form-result"></p></form>`;
  const form=d.querySelector("form"),service=form.elements.service;
  form.elements.department.onchange=()=>{service.innerHTML=options(services.filter(x=>String(x.department_id)===form.elements.department.value),x=>x.name,"Any service")};
  d.querySelector("[data-close]").onclick=()=>d.close();
  form.onsubmit=async event=>{event.preventDefault();const v=new FormData(form),weekdays=v.getAll("weekday").map(Number);const {data,error}=await supabase.rpc("generate_availability_slots",{target_facility:facilityId,target_provider:v.get("provider")?Number(v.get("provider")):null,target_department:Number(v.get("department")),target_service:v.get("service")?Number(v.get("service")):null,first_day:v.get("first"),last_day:v.get("last"),weekdays,day_start:v.get("start"),day_end:v.get("end"),slot_minutes:Number(v.get("minutes")),tz_name:v.get("tz")});
   form.querySelector(".form-result").textContent=error?error.message:`${data.created} slot(s) created${data.skipped_overlaps?`; ${data.skipped_overlaps} skipped because the provider was already booked at that time`:""}.`;if(!error&&data.created)setTimeout(()=>location.reload(),900)};
  d.showModal();
 };

 bar.querySelector("[data-book-for-patient]").onclick=async()=>{
  const d=dialog();d.innerHTML='<p>Loading…</p>';d.showModal();
  const [{data:patients,error:pe},{data:slots,error:se}]=await Promise.all([
   supabase.from("patients").select("id,first_name,last_name,snau").eq("facility_id",facilityId).order("last_name").limit(1000),
   supabase.from("provider_availability_slots").select("id,starts_at,department_id,service_id,provider_id").eq("facility_id",facilityId).eq("status","available").gt("starts_at",new Date().toISOString()).order("starts_at").limit(500)
  ]);
  if(pe||se){d.innerHTML=`<p class="form-result">${esc((pe||se).message)}</p><button class="button secondary" data-close>Close</button>`;d.querySelector("[data-close]").onclick=()=>d.close();return}
  const name=(rows,id)=>rows.find(x=>String(x.id)===String(id))?.name||"";
  d.innerHTML=`<form method="dialog"><h3>Book for a patient</h3><label>Patient<select name="patient" required>${options(patients||[],x=>`${x.last_name}, ${x.first_name} · ${x.snau||"UNIN pending"}`,"Select patient")}</select></label><label>Available time<select name="slot" required>${options(slots||[],x=>[when(x.starts_at),name(departments,x.department_id),name(services,x.service_id),name(providers,x.provider_id)].filter(Boolean).join(" · "),(slots||[]).length?"Select a time":"No availability — create it first")}</select></label><label>Reason<input name="reason"></label><label><input type="checkbox" name="sooner"> Notify if a sooner time becomes available</label><button class="button">Book</button> <button type="button" class="button secondary" data-close>Close</button><p class="form-result"></p></form>`;
  const form=d.querySelector("form");d.querySelector("[data-close]").onclick=()=>d.close();
  form.onsubmit=async event=>{event.preventDefault();const v=new FormData(form);const {error}=await supabase.rpc("book_available_slot",{slot_to_book:Number(v.get("slot")),patient_to_book:Number(v.get("patient")),booking_reason:v.get("reason")||null,notify_if_sooner:v.get("sooner")==="on"});form.querySelector(".form-result").textContent=error?error.message:"Appointment booked.";if(!error)setTimeout(()=>location.reload(),700)};
 };
}
