import {createClient} from "npm:@supabase/supabase-js@2.112.4";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const professionalFields=["legal_name","aliases","date_of_birth","gender","citizenship_work_authorization","home_address","mailing_address","personal_email","personal_phone","emergency_contact","languages_spoken","employee_id","contract_type","primary_department","npi","state_licenses","license_expirations","dea_registration","board_certifications","education","postgraduate_training","clinical_specialties","accepted_insurance","professional_bio","work_history","liability_insurance","hospital_privileges","clinical_certifications","scheduling_logic"];
const jurisdictionVisibleFields=new Set(["legal_name","languages_spoken","employee_id","primary_department","npi","state_licenses","license_expirations","board_certifications","education","postgraduate_training","clinical_specialties","hospital_privileges","clinical_certifications"]);

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
    if(!body.user_id)throw new Error("A staff account is required");
    const isSelf=body.user_id===user.id;
    if(isSelf&&(body.access_permanently_denied||body.access_suspended_until))throw new Error("Administrators cannot suspend or deny their own access");
    if(!body.facility_id&&!body.jurisdiction_id)throw new Error("Facility or health-department scope is required");

    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:actorRoles,error:actorRoleError}=await admin.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).in("roles.role_code",["root","sysadmin","health_department_admin"]);
    if(actorRoleError)throw actorRoleError;
    const roleCodes=(actorRoles||[]).map((entry:any)=>entry.roles.role_code);
    const isRoot=roleCodes.includes("root"),isSysadmin=roleCodes.includes("sysadmin"),isHealthAdmin=roleCodes.includes("health_department_admin");
    if(!isRoot&&!isSysadmin&&!isHealthAdmin)throw new Error("Administrator access required");

    const {data:targetRoot}=await admin.from("user_roles").select("user_id,roles!inner(role_code)").eq("user_id",body.user_id).eq("roles.role_code","root").maybeSingle();
    if(targetRoot&&!isSelf)throw new Error("Root account access cannot be changed here");

    if(body.facility_id){
      const {data:actorMembership}=await admin.from("facility_memberships").select("is_owner").eq("facility_id",body.facility_id).eq("user_id",user.id).eq("active",true).maybeSingle();
      if(!isRoot&&!actorMembership?.is_owner)throw new Error("Facility owner access required");
      const {data:targetMembership}=await admin.from("facility_memberships").select("user_id").eq("facility_id",body.facility_id).eq("user_id",body.user_id).eq("active",true).maybeSingle();
      if(!targetMembership&&!(isRoot&&isSelf))throw new Error("Staff account is not assigned to this facility");
    }else{
      if(!isRoot&&!isHealthAdmin)throw new Error("Health-department administrator access required");
      if(!isRoot){
        const {data:actorMembership}=await admin.from("health_department_memberships").select("user_id").eq("jurisdiction_id",body.jurisdiction_id).eq("user_id",user.id).eq("active",true).maybeSingle();
        if(!actorMembership)throw new Error("Health-department administrator access required");
      }
      const {data:targetMembership}=await admin.from("health_department_memberships").select("user_id").eq("jurisdiction_id",body.jurisdiction_id).eq("user_id",body.user_id).eq("active",true).maybeSingle();
      if(!targetMembership&&!(isRoot&&isSelf))throw new Error("Staff account is not assigned to this health department");
    }

    if(body.action==="get"){
      const [{data:account,error:accountError},{data:professional,error:professionalError}]=await Promise.all([
        admin.from("profiles").select("user_id,email,display_name,username,staff_group,staff_subgroup,job_title,credentials,access_suspended_until,access_permanently_denied").eq("user_id",body.user_id).single(),
        admin.from("staff_professional_profiles").select("*").eq("user_id",body.user_id).maybeSingle()
      ]);
      if(accountError)throw accountError;
      if(professionalError)throw professionalError;
      const visibleProfessional={...(professional||{})};
      if(body.jurisdiction_id&&!isSelf)for(const field of professionalFields)if(!jurisdictionVisibleFields.has(field))delete visibleProfessional[field];
      return new Response(JSON.stringify({profile:{...account,...visibleProfessional}}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
    }

    const until=body.access_suspended_until?new Date(body.access_suspended_until).toISOString():null;
    const profile={job_title:body.job_title||null,credentials:body.credentials||null,staff_subgroup:body.staff_subgroup||null,access_suspended_until:body.access_permanently_denied?null:until,access_permanently_denied:Boolean(body.access_permanently_denied)};
    const {error:updateError}=await admin.from("profiles").update(profile).eq("user_id",body.user_id);
    if(updateError)throw updateError;
    if(body.gender&&!['M','F'].includes(body.gender))throw new Error('Gender assigned at birth must be Male or Female');
    if(!body.employee_id&&body.engagement_date&&body.gender){
      const match=String(body.engagement_date).match(/^(\d{4})-(\d{2})-\d{2}$/);
      if(!match)throw new Error('A valid date of engagement is required to generate the employee identification');
      const prefix=`${match[2]}${match[1]}-${body.gender}`;
      const {data:existing,error:idError}=await admin.from('staff_professional_profiles').select('employee_id').like('employee_id',`${prefix}-%`);
      if(idError)throw idError;
      const next=Math.max(0,...(existing||[]).map((row:any)=>Number(String(row.employee_id||'').split('-').at(-1))||0))+1;
      body.employee_id=`${prefix}-${String(next).padStart(5,'0')}`;
    }
    const professional:any={user_id:body.user_id,updated_by:user.id,updated_at:new Date().toISOString()};
    const writableFields=body.jurisdiction_id&&!isSelf?professionalFields.filter(field=>jurisdictionVisibleFields.has(field)):professionalFields;
    for(const field of writableFields)professional[field]=field==="date_of_birth"?(body[field]||null):(String(body[field]??"").trim()||null);
    const {error:professionalError}=await admin.from("staff_professional_profiles").upsert(professional,{onConflict:"user_id"});
    if(professionalError)throw professionalError;
    const banDuration=body.access_permanently_denied?"876000h":until?`${Math.max(1,Math.ceil((new Date(until).getTime()-Date.now())/3600000))}h`:"none";
    const accessResult=await admin.auth.admin.updateUserById(body.user_id,{ban_duration:banDuration});
    if(accessResult.error)throw accessResult.error;
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{...cors,"Content-Type":"application/json"}});
  }catch(error){
    return new Response(JSON.stringify({error:error.message}),{status:400,headers:{...cors,"Content-Type":"application/json"}});
  }
});
