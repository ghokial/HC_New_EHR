import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const stringList=(value:unknown,fallback:unknown=null)=>{try{const parsed=typeof value==="string"&&value.trim().startsWith("[")?JSON.parse(value):value,list=Array.isArray(parsed)?parsed:parsed==null?[]:[parsed],source=list.length?list:fallback==null?[]:[fallback];return [...new Set(source.map((item:unknown)=>String(item||"").trim()).filter(Boolean))]}catch{return fallback==null?[]:[String(fallback).trim()].filter(Boolean)}};
const professionalFields=["date_of_birth","gender","personal_email","personal_phone","languages_spoken","employee_id","contract_type","primary_department","primary_service","npi","license_expirations","dea_registration","board_certifications","education","postgraduate_training","clinical_specialties","accepted_insurance","professional_bio","work_history","liability_insurance","hospital_privileges","clinical_certifications","scheduling_logic"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  try {
    const auth=req.headers.get("Authorization");
    if(!auth) throw new Error("Authentication required");
    const url=Deno.env.get("SUPABASE_URL")!;
    const caller=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:userError}=await caller.auth.getUser();
    if(userError||!user) throw new Error("Invalid session");
    const body=await req.json();
    const displayName=[body.first_name,body.middle_name,body.last_name].filter(Boolean).join(" ").trim()||String(body.display_name||"").trim(),phone=String(body.phone||"").replace(/[\s().-]/g,"");
    const username=String(body.username||body.email||body.phone||"").trim();
    const roleCodes=stringList(body.role_codes_json||body.role_codes,body.role_code),staffGroups=stringList(body.staff_groups_json||body.staff_groups,body.staff_group),staffSubgroups=stringList(body.staff_subgroups_json||body.staff_subgroups,body.staff_subgroup);
    if(!username||!body.email||!roleCodes.length||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email))||!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("username, email for delivery, international phone number, and at least one role are required");
    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const email=String(body.email).trim().toLowerCase(), normalizedUsername=username.toLowerCase(), normalizedPhone=phone;
    const {data:profileMatch}=await admin.from("profiles").select("user_id,email,username").or(`email.ilike.${email},username.ilike.${normalizedUsername}`).limit(1).maybeSingle();
    let phoneMatch:any=null;
    for(let page=1;page<=10&&!phoneMatch;page++){const listed=await admin.auth.admin.listUsers({page,perPage:1000});if(listed.error)throw listed.error;phoneMatch=(listed.data.users||[]).find((u:any)=>String(u.phone||"").replace(/[\s().-]/g,"")===normalizedPhone);if((listed.data.users||[]).length<1000)break}
    let releasedPhone=false;
    if(phoneMatch){
      const cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-6);
      const lastLogin=phoneMatch.last_sign_in_at?new Date(phoneMatch.last_sign_in_at):null;
      if(lastLogin&&lastLogin<cutoff&&(!profileMatch||profileMatch.user_id===phoneMatch.id)){
        const released=await admin.auth.admin.updateUserById(phoneMatch.id,{phone:null,user_metadata:{...(phoneMatch.user_metadata||{}),username_reassignment_required:true}});
        if(released.error)throw released.error;
        await admin.from("profiles").update({username:null}).eq("user_id",phoneMatch.id).ilike("username",normalizedPhone);
        releasedPhone=true;
      }
    }
    const existingUserId=profileMatch?.user_id||(phoneMatch&&!releasedPhone?phoneMatch.id:null);
    const existingIdentifier=profileMatch?.email||(profileMatch?.username&&!releasedPhone?profileMatch.username:null)||(phoneMatch&&!releasedPhone&&"phone number");
    if(existingIdentifier&&!body.confirm_existing_account) throw new Error(`This ${existingIdentifier.includes("@")?"email":existingIdentifier==="phone number"?"phone number":"username"} is already used. Confirm that it is the correct account to use across multiple facilities or portals, then try again with confirmation.`);
    const {data:rootRole}=await admin.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).eq("roles.role_code","root").maybeSingle();
    const {data:membership}=body.facility_id?await admin.from("facility_memberships").select("is_owner,roles!inner(role_code)").eq("facility_id",body.facility_id).eq("user_id",user.id).eq("active",true).maybeSingle():{data:null};
    const isRoot=Boolean(rootRole),healthRole=roleCodes.some(code=>["health_department_admin","health_department_analyst"].includes(code)),platformRole=roleCodes.some(code=>["platform_agent","compliance","support_agent","community_moderator"].includes(code));
    if(!isRoot&&!membership?.is_owner&&!(["sysadmin"].includes(membership?.roles?.role_code))) throw new Error("Facility owner or administrator access required");
    if(roleCodes.includes("root")) throw new Error("Root accounts cannot be created from this service");
    if((healthRole||platformRole)&&!isRoot) throw new Error("Healthcarology Root access required for this role");
    if(healthRole&&!body.jurisdiction_id) throw new Error("A health-department jurisdiction is required");
    if(!displayName)throw new Error("First and last name are required");
    let accountUserId:string,invite:any=null;
    const staffProfile={display_name,staff_group:staffGroups.join("\n")||null,staff_subgroup:staffSubgroups.join("\n")||null,job_title:String(body.job_title||"").trim()||null,credentials:String(body.credentials||"").trim()||null};
    if(existingUserId){accountUserId=existingUserId;const {error:profileError}=await admin.from("profiles").update(staffProfile).eq("user_id",accountUserId);if(profileError)throw profileError}
    // New people receive an emailed invitation and choose their own password; no shared or administrator-visible password exists.
    else {const created=await admin.auth.admin.inviteUserByEmail(email,{data:{display_name},redirectTo:req.headers.get("origin")||undefined});if(created.error)throw created.error;invite=created.data;accountUserId=invite.user.id;const {error:metaError}=await admin.auth.admin.updateUserById(accountUserId,{phone,phone_confirm:true,app_metadata:{must_change_password:true}});if(metaError){await admin.auth.admin.deleteUser(accountUserId);throw metaError}const {error:profileError}=await admin.from("profiles").update({...staffProfile,username}).eq("user_id",accountUserId);if(profileError)throw profileError}
    const {data:roles,error:findRoleError}=await admin.from("roles").select("id,role_code,access_level").in("role_code",roleCodes);
    if(findRoleError) throw findRoleError;
    if((roles||[]).length!==roleCodes.length)throw new Error("One or more selected roles are unavailable");
    const {error:assignError}=await admin.from("user_roles").upsert((roles||[]).map(role=>({user_id:accountUserId,role_id:role.id,scope:body.scope||"hospital_main"})),{onConflict:"user_id,role_id,scope"});
    if(assignError) throw assignError;
    const membershipRole=[...(roles||[])].sort((a,b)=>Number(b.access_level||0)-Number(a.access_level||0))[0];
    if(body.facility_id){const {error:memberError}=await admin.from("facility_memberships").upsert({facility_id:body.facility_id,user_id:accountUserId,role_id:membershipRole.id,active:true},{onConflict:"facility_id,user_id"});if(memberError)throw memberError;}
    if(healthRole){const healthMembershipRole=(roles||[]).find(role=>["health_department_admin","health_department_analyst"].includes(role.role_code))!;const {error:healthError}=await admin.from("health_department_memberships").upsert({jurisdiction_id:body.jurisdiction_id,user_id:accountUserId,role_id:healthMembershipRole.id,active:true},{onConflict:"jurisdiction_id,user_id"});if(healthError)throw healthError;}
    if(body.facility_id&&!String(body.primary_department||'').trim())throw new Error('A primary department is required for every facility staff member');
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
    const professional:any={user_id:accountUserId,updated_by:user.id,updated_at:new Date().toISOString()};
    for(const field of professionalFields)professional[field]=field==='date_of_birth'?(body[field]||null):(String(body[field]??'').trim()||null);
    const {error:professionalError}=await admin.from('staff_professional_profiles').upsert(professional,{onConflict:'user_id'});
    if(professionalError)throw professionalError;
    if(body.facility_id&&body.contract_type){
      const {data:currencyRow,error:currencyError}=await admin.from('facilities').select('currency').eq('id',body.facility_id).single();
      if(currencyError||!currencyRow?.currency)throw new Error('The facility currency is not configured');
      const currency=String(currencyRow.currency).trim().toUpperCase();
      const amount=value=>body[value]===''||body[value]==null?null:Number(body[value]);
      const basePayAmount=amount('base_pay_amount'),baseHourlyRate=body.base_pay_type==='Hourly Rate'?basePayAmount:amount('base_hourly_rate'),baseSalary=body.base_pay_type==='Base Salary'?basePayAmount:amount('annual_salary');
      const payroll={facility_id:body.facility_id,user_id:accountUserId,contract_type:body.contract_type,currency,pay_frequency:body.pay_frequency,base_hourly_rate:baseHourlyRate,annual_salary:baseSalary,contractor_rate:body.contract_type==='Contractor'?basePayAmount:amount('contractor_rate'),overtime_method:body.overtime_method||'Not configured',overtime_multiplier:amount('overtime_multiplier'),night_differential:amount('night_differential'),weekend_differential:amount('weekend_differential'),holiday_differential:amount('holiday_differential'),on_call_rate:amount('on_call_rate'),hazard_rate:amount('hazard_rate'),rvu_rate:amount('rvu_rate'),credential_blocking_enabled:body.credential_blocking_enabled==='on',aca_tracking_enabled:body.aca_tracking_enabled==='on',pbj_tracking_enabled:body.pbj_tracking_enabled==='on',mobile_self_service_enabled:body.mobile_self_service_enabled==='on',earned_wage_access_enabled:body.earned_wage_access_enabled==='on',effective_from:body.payroll_effective_from,created_by:user.id,updated_by:user.id,updated_at:new Date().toISOString()};
      const requiredAmount=body.contract_type==='Hourly staff'?payroll.base_hourly_rate:body.contract_type==='Salaried'?payroll.annual_salary:body.contract_type==='Contractor'?payroll.contractor_rate:null;
      if(requiredAmount==null)throw new Error('Enter the compensation amount required by the selected contract type');
      const {error:payrollError}=await admin.from('staff_payroll_profiles').upsert(payroll,{onConflict:'facility_id,user_id'});if(payrollError)throw payrollError;
      const integrationTypes=['Biometric clock','Mobile time app','Payroll processor','Tax filing','ACA reporting','PBJ reporting','Earned wage access'];
      const {error:integrationError}=await admin.from('payroll_integrations').upsert(integrationTypes.map(integration_type=>({facility_id:body.facility_id,integration_type,status:'unconfigured',created_by:user.id})),{onConflict:'facility_id,integration_type',ignoreDuplicates:true});if(integrationError)throw integrationError;
    }
    return new Response(JSON.stringify({id:accountUserId,email:invite?.user?.email||profileMatch?.email||body.email,phone:invite?.user?.phone||phoneMatch?.phone||phone,username,role_codes:roleCodes,staff_groups:staffGroups,staff_subgroups:staffSubgroups,invitation_sent:!existingUserId,existing_account:Boolean(existingUserId),login_url:`${url.replace(/\/\/$/,"")}/login`,released_inactive_phone:releasedPhone}),{headers:{...cors,"Content-Type":"application/json"},status:201});
  } catch(error){return new Response(JSON.stringify({error:error.message}),{headers:{...cors,"Content-Type":"application/json"},status:400});}
});
