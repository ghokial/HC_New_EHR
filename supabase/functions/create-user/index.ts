import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
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
    if(!username||!body.email||!body.role_code||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email))||!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("username, email for delivery, international phone number, and role_code are required");
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
    const existingIdentifier=profileMatch?.email||(profileMatch?.username&&!releasedPhone?profileMatch.username:null)||(phoneMatch&&!releasedPhone&&"phone number");
    if(existingIdentifier&&!body.confirm_existing_account) throw new Error(`This ${existingIdentifier.includes("@")?"email":existingIdentifier==="phone number"?"phone number":"username"} is already used. Confirm that it is the correct account to use across multiple facilities or portals, then try again with confirmation.`);
    const {data:rootRole}=await admin.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).eq("roles.role_code","root").maybeSingle();
    const {data:membership}=body.facility_id?await admin.from("facility_memberships").select("is_owner,roles!inner(role_code)").eq("facility_id",body.facility_id).eq("user_id",user.id).eq("active",true).maybeSingle():{data:null};
    const isRoot=Boolean(rootRole),healthRole=["health_department_admin","health_department_analyst"].includes(body.role_code),platformRole=["platform_agent","compliance","support_agent","community_moderator"].includes(body.role_code);
    if(!isRoot&&!membership?.is_owner&&!(["sysadmin"].includes(membership?.roles?.role_code))) throw new Error("Facility owner or administrator access required");
    if(body.role_code==="root") throw new Error("Root accounts cannot be created from this service");
    if((healthRole||platformRole)&&!isRoot) throw new Error("Healthcarology Root access required for this role");
    if(healthRole&&!body.jurisdiction_id) throw new Error("A health-department jurisdiction is required");
    const random=new Uint8Array(1);crypto.getRandomValues(random); // keep a per-request nonce for audit correlation; password is fixed by onboarding policy
    const temporaryPassword="Temp#123";
    if(!displayName)throw new Error("First and last name are required");
    const {data:invite,error:inviteError}=await admin.auth.admin.createUser({email:body.email,phone,password:temporaryPassword,email_confirm:true,phone_confirm:true,user_metadata:{display_name:displayName},app_metadata:{must_change_password:true}});
    if(inviteError) throw inviteError;
    await admin.from("profiles").update({username}).eq("user_id",invite.user.id);
    const {data:role,error:findRoleError}=await admin.from("roles").select("id").eq("role_code",body.role_code).single();
    if(findRoleError) throw findRoleError;
    const {error:assignError}=await admin.from("user_roles").insert({user_id:invite.user.id,role_id:role.id,scope:body.scope||"hospital_main"});
    if(assignError) throw assignError;
    if(body.facility_id){const {error:memberError}=await admin.from("facility_memberships").insert({facility_id:body.facility_id,user_id:invite.user.id,role_id:role.id});if(memberError)throw memberError;}
    if(healthRole){const {error:healthError}=await admin.from("health_department_memberships").insert({jurisdiction_id:body.jurisdiction_id,user_id:invite.user.id,role_id:role.id});if(healthError)throw healthError;}
    return new Response(JSON.stringify({id:invite.user.id,email:invite.user.email,phone:invite.user.phone,username,role_code:body.role_code,temporary_password:temporaryPassword,login_url:`${url.replace(/\/\/$/,"")}/login`,released_inactive_phone:releasedPhone}),{headers:{...cors,"Content-Type":"application/json"},status:201});
  } catch(error){return new Response(JSON.stringify({error:error.message}),{headers:{...cors,"Content-Type":"application/json"},status:400});}
});
