import {createClient} from "npm:@supabase/supabase-js@2.112.4";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const auth=req.headers.get("Authorization");
    if(!auth)throw new Error("Authentication required");
    const url=Deno.env.get("SUPABASE_URL")!;
    const caller=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const {data:{user}}=await caller.auth.getUser();
    if(!user)throw new Error("Invalid session");
    const body=await req.json();
    if(!body.user_id||body.user_id===user.id)throw new Error("A different staff account is required");
    if(!body.facility_id&&!body.jurisdiction_id)throw new Error("Facility or health-department scope is required");

    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:actorRoles,error:actorRoleError}=await admin.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).in("roles.role_code",["root","sysadmin","health_department_admin"]);
    if(actorRoleError)throw actorRoleError;
    const roleCodes=(actorRoles||[]).map((entry:any)=>entry.roles.role_code);
    const isRoot=roleCodes.includes("root"),isSysadmin=roleCodes.includes("sysadmin"),isHealthAdmin=roleCodes.includes("health_department_admin");
    if(!isRoot&&!isSysadmin&&!isHealthAdmin)throw new Error("Administrator access required");

    const {data:targetRoot}=await admin.from("user_roles").select("user_id,roles!inner(role_code)").eq("user_id",body.user_id).eq("roles.role_code","root").maybeSingle();
    if(targetRoot)throw new Error("Root account access cannot be changed here");

    if(body.facility_id){
      const {data:actorMembership}=await admin.from("facility_memberships").select("is_owner").eq("facility_id",body.facility_id).eq("user_id",user.id).eq("active",true).maybeSingle();
      if(!isRoot&&!isSysadmin&&!actorMembership?.is_owner)throw new Error("Facility administrator access required");
      const {data:targetMembership}=await admin.from("facility_memberships").select("user_id").eq("facility_id",body.facility_id).eq("user_id",body.user_id).eq("active",true).maybeSingle();
      if(!targetMembership)throw new Error("Staff account is not assigned to this facility");
    }else{
      if(!isRoot&&!isHealthAdmin)throw new Error("Health-department administrator access required");
      if(!isRoot){
        const {data:actorMembership}=await admin.from("health_department_memberships").select("user_id").eq("jurisdiction_id",body.jurisdiction_id).eq("user_id",user.id).eq("active",true).maybeSingle();
        if(!actorMembership)throw new Error("Health-department administrator access required");
      }
      const {data:targetMembership}=await admin.from("health_department_memberships").select("user_id").eq("jurisdiction_id",body.jurisdiction_id).eq("user_id",body.user_id).eq("active",true).maybeSingle();
      if(!targetMembership)throw new Error("Staff account is not assigned to this health department");
    }

    const until=body.access_suspended_until?new Date(body.access_suspended_until).toISOString():null;
    const profile={job_title:body.job_title||null,credentials:body.credentials||null,staff_subgroup:body.staff_subgroup||null,access_suspended_until:body.access_permanently_denied?null:until,access_permanently_denied:Boolean(body.access_permanently_denied)};
    const {error:updateError}=await admin.from("profiles").update(profile).eq("user_id",body.user_id);
    if(updateError)throw updateError;
    const banDuration=body.access_permanently_denied?"876000h":until?`${Math.max(1,Math.ceil((new Date(until).getTime()-Date.now())/3600000))}h`:"none";
    const accessResult=await admin.auth.admin.updateUserById(body.user_id,{ban_duration:banDuration});
    if(accessResult.error)throw accessResult.error;
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
  }catch(error){
    return new Response(JSON.stringify({error:error.message}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
  }
});
