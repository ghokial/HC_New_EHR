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
    const {data:agent}=await caller.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).in("roles.role_code",["root","platform_agent"]).limit(1).maybeSingle();
    if(!agent) throw new Error("Healthcarology Agent access required");
    const body=await req.json();
    const facilityTypes=["Hospital","Health Center","Pharmacy","Laboratory (Labs)","Imaging Center","Research Center","Other"];
    const ownerPhone=String(body.owner_phone||"").replace(/[\s().-]/g,"");
    if(!body.name||!body.slug||!body.owner_name||!body.owner_email||!/^\+[1-9]\d{7,14}$/.test(ownerPhone)||!body.emergency_contact_name||!body.emergency_contact_email||!body.emergency_contact_phone||!body.street_address||!body.city_name||!body.state_province||!body.postal_code||!body.country_name||!facilityTypes.includes(body.facility_type)) throw new Error("Complete facility, type, owner, international owner phone, emergency contact, and address information is required");
    if(body.facility_type==="Other"&&!String(body.facility_type_other||"").trim()) throw new Error("Enter the other facility type");
    const departmentIds=(body.department_ids||[]).map(Number).filter(Number.isFinite);
    const serviceIds=(Array.isArray(body.service_ids)?body.service_ids:String(body.service_ids||"").split(",")).map(Number).filter(Number.isFinite);
    const random=new Uint8Array(18);crypto.getRandomValues(random);
    const password=`Hc!${Array.from(random,b=>b.toString(36).padStart(2,"0")).join("")}9a`;
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:body.owner_email,phone:ownerPhone,password,email_confirm:true,phone_confirm:true,user_metadata:{display_name:body.owner_name||body.owner_email.split("@")[0]},app_metadata:{must_change_password:true}});
    if(createError) throw createError;
    const triageMode=["common","department"].includes(body.triage_mode)?body.triage_mode:"common";
    const {data:facility,error:facilityError}=await admin.from("facilities").insert({name:body.name,slug:body.slug,facility_type:body.facility_type,facility_type_other:body.facility_type==="Other"?String(body.facility_type_other).trim():null,triage_mode:triageMode,owner_user_id:created.user.id,owner_name:body.owner_name,owner_email:body.owner_email,owner_phone:body.owner_phone,emergency_contact_name:body.emergency_contact_name,emergency_contact_email:body.emergency_contact_email,emergency_contact_phone:body.emergency_contact_phone,street_address:body.street_address,city_name:body.city_name,state_province:body.state_province,postal_code:body.postal_code,country_name:body.country_name}).select("id,slug,facility_number").single();
    if(facilityError){await admin.auth.admin.deleteUser(created.user.id);throw facilityError}
    const {data:role}=await admin.from("roles").select("id").eq("role_code","sysadmin").single();
    await admin.from("facility_memberships").insert({facility_id:facility.id,user_id:created.user.id,role_id:role.id,is_owner:true});
    await admin.from("user_roles").insert({user_id:created.user.id,role_id:role.id,scope:facility.slug});
    if(departmentIds.length) await admin.from("facility_departments").insert(departmentIds.map(department_id=>({facility_id:facility.id,department_id})));
    if(serviceIds.length) await admin.from("facility_services").insert(serviceIds.map(service_id=>({facility_id:facility.id,service_id})));
    return new Response(JSON.stringify({facility_id:facility.id,facility_number:facility.facility_number,slug:facility.slug,owner_email:created.user.email,temporary_password:password,must_change_password:true}),{status:201,headers:{...cors,"Content-Type":"application/json"}});
  }catch(error){return new Response(JSON.stringify({error:error.message}),{status:400,headers:{...cors,"Content-Type":"application/json"}})}
});
