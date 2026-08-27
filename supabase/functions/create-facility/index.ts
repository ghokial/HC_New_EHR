import {createClient} from "npm:@supabase/supabase-js@2.112.4";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
Deno.serve(async req=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const auth=req.headers.get("Authorization");
    if(!auth) throw new Error("Authentication required");
    const url=Deno.env.get("SUPABASE_URL")!;
    const caller=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:{user},error:userError}=await caller.auth.getUser();
    if(userError||!user) throw new Error("Invalid session");
    const {data:root}=await caller.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).eq("roles.role_code","root").maybeSingle();
    if(!root) throw new Error("Root Administrator access required");
    const body=await req.json();
    if(!body.name||!body.slug||!body.owner_email) throw new Error("Facility name, URL name, and owner email are required");
    const departmentIds=(body.department_ids||[]).map(Number).filter(Number.isFinite);
    const serviceIds=(Array.isArray(body.service_ids)?body.service_ids:String(body.service_ids||"").split(",")).map(Number).filter(Number.isFinite);
    const random=new Uint8Array(18);crypto.getRandomValues(random);
    const password=`Hc!${Array.from(random,b=>b.toString(36).padStart(2,"0")).join("")}9a`;
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:body.owner_email,password,email_confirm:true,user_metadata:{display_name:body.owner_name||body.owner_email.split("@")[0]},app_metadata:{must_change_password:true}});
    if(createError) throw createError;
    const {data:facility,error:facilityError}=await admin.from("facilities").insert({name:body.name,slug:body.slug,owner_user_id:created.user.id}).select("id,slug").single();
    if(facilityError){await admin.auth.admin.deleteUser(created.user.id);throw facilityError}
    const {data:role}=await admin.from("roles").select("id").eq("role_code","sysadmin").single();
    await admin.from("facility_memberships").insert({facility_id:facility.id,user_id:created.user.id,role_id:role.id,is_owner:true});
    await admin.from("user_roles").insert({user_id:created.user.id,role_id:role.id,scope:facility.slug});
    if(departmentIds.length) await admin.from("facility_departments").insert(departmentIds.map(department_id=>({facility_id:facility.id,department_id})));
    if(serviceIds.length) await admin.from("facility_services").insert(serviceIds.map(service_id=>({facility_id:facility.id,service_id})));
    return new Response(JSON.stringify({facility_id:facility.id,slug:facility.slug,owner_email:created.user.email,temporary_password:password}),{status:201,headers:{...cors,"Content-Type":"application/json"}});
  }catch(error){return new Response(JSON.stringify({error:error.message}),{status:400,headers:{...cors,"Content-Type":"application/json"}})}
});
