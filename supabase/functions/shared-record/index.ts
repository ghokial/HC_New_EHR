import {createClient} from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"};
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const digest=async(v:string)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v))));
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  if(req.method!=="POST")throw new Error("POST required");
  const body=await req.json(),admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if(!body.token||!body.username||!body.password)throw new Error("Link token, username, and temporary password are required");
  const tokenHash=await digest(String(body.token)),passwordHash=await digest(String(body.password));
  const {data:share}=await admin.from("patient_record_shares").select("*").eq("token_hash",tokenHash).maybeSingle();
  const valid=share&&share.password_hash===passwordHash&&String(share.grantee_identifier).toLowerCase()===String(body.username).trim().toLowerCase()&&share.status==="active"&&new Date(share.expires_at)>new Date();
  const ip=req.headers.get("x-forwarded-for")?.split(",")[0]||"";
  if(!valid){if(share)await admin.from("shared_record_access_audit").insert({share_id:share.id,action:"failed_login",grantee_identifier:String(body.username).slice(0,200),ip_hash:await digest(ip+tokenHash),user_agent:req.headers.get("user-agent")?.slice(0,500)});throw new Error("Shared access credentials are invalid or expired")}
  const action=body.action||"read";
  if(action==="request_extension"){
   const until=new Date(body.requested_until);if(!Number.isFinite(until.getTime())||until<=new Date(share.expires_at))throw new Error("Requested date must be later than the current expiration");
   await admin.from("share_extension_requests").insert({share_id:share.id,requested_until:until.toISOString(),reason:String(body.reason||"").slice(0,2000)});
   await admin.from("shared_record_access_audit").insert({share_id:share.id,action:"extension_request",grantee_identifier:share.grantee_identifier,ip_hash:await digest(ip+tokenHash),user_agent:req.headers.get("user-agent")?.slice(0,500)});
   return response({ok:true,message:"Extension request sent to the grantor."});
  }
  if(action==="contribute"){
   if(share.access_level!=="read_write")throw new Error("This share is read only");
   const entryType=["note","document_reference","correction_request","clinical_update"].includes(body.entry_type)?body.entry_type:"note";
   if(!String(body.content||"").trim())throw new Error("Contribution content is required");
   await admin.from("shared_record_contributions").insert({share_id:share.id,patient_id:share.patient_id,contributor_identifier:share.grantee_identifier,entry_type:entryType,content:String(body.content).trim().slice(0,20000)});
   await admin.from("shared_record_access_audit").insert({share_id:share.id,action:"contribute",grantee_identifier:share.grantee_identifier,ip_hash:await digest(ip+tokenHash),user_agent:req.headers.get("user-agent")?.slice(0,500)});
   return response({ok:true,message:"Contribution recorded for provider review."});
  }
  const allowed=share.share_scope==="complete"?["demographics","diagnoses","encounters","medications","labs","notes"]:share.included_elements;
  const range=(q:any)=>{if(share.period_start)q=q.gte("created_at",share.period_start);if(share.period_end)q=q.lte("created_at",`${share.period_end}T23:59:59.999Z`);return q};
  const result:any={share:{access_level:share.access_level,share_scope:share.share_scope,period_start:share.period_start,period_end:share.period_end,included_elements:allowed,expires_at:share.expires_at}};
  if(allowed.includes("demographics"))result.demographics=(await admin.from("patients").select("snau,first_name,middle_name,last_name,sex,date_of_birth,life_status").eq("id",share.patient_id).single()).data;
  if(allowed.includes("diagnoses")){let q=admin.from("diagnoses").select("display,code,clinical_status,onset_at,closed_at,diagnosing_provider_name,closing_provider_name").eq("patient_id",share.patient_id);if(share.period_start)q=q.gte("onset_at",share.period_start);if(share.period_end)q=q.lte("onset_at",`${share.period_end}T23:59:59.999Z`);result.diagnoses=(await q).data||[]}
  if(allowed.includes("encounters")){let q=admin.from("encounters").select("encounter_type,start_at,end_at,status").eq("patient_id",share.patient_id);if(share.period_start)q=q.gte("start_at",share.period_start);if(share.period_end)q=q.lte("start_at",`${share.period_end}T23:59:59.999Z`);result.encounters=(await q).data||[]}
  if(allowed.includes("medications"))result.medications=(await admin.from("medication_orders").select("dose,route,frequency,start_at,end_at,status,medications(name,generic_name,strength,form)").eq("patient_id",share.patient_id)).data||[];
  if(allowed.includes("labs")){const orderIds=((await admin.from("orders").select("id").eq("patient_id",share.patient_id).eq("order_type","lab")).data||[]).map(x=>x.id),labOrders=orderIds.length?(await admin.from("lab_orders").select("id,test_code").in("order_id",orderIds)).data||[]:[],labIds=labOrders.map(x=>x.id),released=labIds.length?(await admin.from("lab_results").select("lab_order_id,result_at,analyte_code,value,numeric_value,units,reference_range,interpretation").in("lab_order_id",labIds).eq("validation_status","validated")).data||[]:[];result.labs=labOrders.map(order=>({...order,results:released.filter(x=>x.lab_order_id===order.id)}))}
  if(allowed.includes("notes")){let q=admin.from("clinical_notes").select("note_type,content,created_at,signed_at,status").eq("patient_id",share.patient_id).eq("status","signed");result.notes=(await q).data||[]}
  await admin.from("shared_record_access_audit").insert({share_id:share.id,action:"view",grantee_identifier:share.grantee_identifier,ip_hash:await digest(ip+tokenHash),user_agent:req.headers.get("user-agent")?.slice(0,500),details:{elements:allowed}});
  return response(result);
 }catch(error){return response({error:error.message},400)}
});
function response(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}})}
