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
    const ownerName=[body.owner_first_name,body.owner_middle_name,body.owner_last_name].filter(Boolean).join(" ").trim()||String(body.owner_name||"").trim();
    const emergencyName=[body.emergency_contact_first_name,body.emergency_contact_middle_name,body.emergency_contact_last_name].filter(Boolean).join(" ").trim()||String(body.emergency_contact_name||"").trim();
    const ownerPhone=String(body.owner_phone||"").replace(/[\s().-]/g,""),emergencyPhone=String(body.emergency_contact_phone||"").replace(/[\s().-]/g,"");
    if(!body.name||!ownerName||!body.owner_email||!/^\+[1-9]\d{7,14}$/.test(ownerPhone)||!emergencyName||!body.emergency_contact_email||!/^\+[1-9]\d{7,14}$/.test(emergencyPhone)||!body.street_address||!body.city_name||!body.state_province||!body.postal_code||!body.country_name||!facilityTypes.includes(body.facility_type)) throw new Error("Complete facility, type, owner, international phone numbers, emergency contact, and address information is required");
    if(body.facility_type==="Other"&&!String(body.facility_type_other||"").trim()) throw new Error("Enter the other facility type");
    const departmentIds=(body.department_ids||[]).map(Number).filter(Number.isFinite);
    const serviceIds=(Array.isArray(body.service_ids)?body.service_ids:String(body.service_ids||"").split(",")).map(Number).filter(Number.isFinite);
    const slugBase=String(body.slug||body.name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"facility";let slug=slugBase;const {data:slugMatch}=await admin.from("facilities").select("id").eq("slug",slug).maybeSingle();if(slugMatch)slug=`${slugBase}-${crypto.randomUUID().slice(0,6)}`;
    const password="Temp#123",email=String(body.owner_email).trim().toLowerCase(),username=String(body.owner_username||email).trim();
    const {data:existingProfile}=await admin.from("profiles").select("user_id").or(`email.ilike.${email},username.ilike.${username}`).maybeSingle();let ownerUserId:string|undefined=existingProfile?.user_id;const existingAccount=Boolean(ownerUserId);let createdUserId:string|null=null;
    if(!ownerUserId){const result=await admin.auth.admin.createUser({email,phone:ownerPhone,password,email_confirm:true,phone_confirm:true,user_metadata:{display_name:ownerName,username},app_metadata:{must_change_password:true}});if(result.error)throw result.error;ownerUserId=result.data.user.id;createdUserId=ownerUserId;await admin.from("profiles").update({username}).eq("user_id",ownerUserId)}
    const triageMode=["common","department"].includes(body.triage_mode)?body.triage_mode:"common";
    const {data:facility,error:facilityError}=await admin.from("facilities").insert({name:body.name,slug,facility_type:body.facility_type,facility_type_other:body.facility_type==="Other"?String(body.facility_type_other).trim():null,triage_mode:triageMode,owner_user_id:ownerUserId,owner_name:ownerName,owner_email:email,owner_phone:ownerPhone,emergency_contact_name:emergencyName,emergency_contact_email:String(body.emergency_contact_email).trim().toLowerCase(),emergency_contact_phone:emergencyPhone,street_address:body.street_address,city_name:body.city_name,state_province:body.state_province,postal_code:body.postal_code,country_name:body.country_name}).select("id,slug,facility_number").single();
    if(facilityError){if(createdUserId)await admin.auth.admin.deleteUser(createdUserId);throw facilityError}
    const {data:role}=await admin.from("roles").select("id").eq("role_code","sysadmin").single();
    await admin.from("facility_memberships").upsert({facility_id:facility.id,user_id:ownerUserId,role_id:role.id,is_owner:true},{onConflict:"facility_id,user_id"});
    await admin.from("user_roles").upsert({user_id:ownerUserId,role_id:role.id,scope:facility.slug},{onConflict:"user_id,role_id",ignoreDuplicates:true});
    if(departmentIds.length) await admin.from("facility_departments").insert(departmentIds.map(department_id=>({facility_id:facility.id,department_id})));
    if(serviceIds.length) await admin.from("facility_services").insert(serviceIds.map(service_id=>({facility_id:facility.id,service_id})));
    const portalOrigin=Deno.env.get("PORTAL_ORIGIN")||"http://127.0.0.1:4173";
    return new Response(JSON.stringify({facility_id:facility.id,facility_number:facility.facility_number,slug:facility.slug,owner_email:email,owner_username:username,temporary_password:existingAccount?null:password,must_change_password:!existingAccount,login_url:`${portalOrigin.replace(/\/\/$/,"")}/${facility.slug}`,existing_account:existingAccount}),{status:201,headers:{...cors,"Content-Type":"application/json"}});
  }catch(error){return new Response(JSON.stringify({error:error.message}),{status:400,headers:{...cors,"Content-Type":"application/json"}})}
});
