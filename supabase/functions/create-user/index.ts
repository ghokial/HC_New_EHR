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
    const phone=String(body.phone||"").replace(/[\s().-]/g,"");
    if(!body.email||!body.role_code||!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("email, international phone number, and role_code are required");
    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:rootRole}=await admin.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).eq("roles.role_code","root").maybeSingle();
    const {data:membership}=body.facility_id?await admin.from("facility_memberships").select("is_owner,roles!inner(role_code)").eq("facility_id",body.facility_id).eq("user_id",user.id).eq("active",true).maybeSingle():{data:null};
    const isRoot=Boolean(rootRole),healthRole=["health_department_admin","health_department_analyst"].includes(body.role_code),platformRole=["platform_agent","compliance","support_agent","community_moderator"].includes(body.role_code);
    if(!isRoot&&!membership?.is_owner&&!(["sysadmin"].includes(membership?.roles?.role_code))) throw new Error("Facility owner or administrator access required");
    if(body.role_code==="root") throw new Error("Root accounts cannot be created from this service");
    if((healthRole||platformRole)&&!isRoot) throw new Error("Healthcarology Root access required for this role");
    if(healthRole&&!body.jurisdiction_id) throw new Error("A health-department jurisdiction is required");
    const random=new Uint8Array(18); crypto.getRandomValues(random);
    const temporaryPassword=`Hc!${Array.from(random,b=>b.toString(36).padStart(2,"0")).join("")}9a`;
    const {data:invite,error:inviteError}=await admin.auth.admin.createUser({email:body.email,phone,password:temporaryPassword,email_confirm:true,phone_confirm:true,user_metadata:{display_name:body.display_name||body.email.split("@")[0]},app_metadata:{must_change_password:true}});
    if(inviteError) throw inviteError;
    const {data:role,error:findRoleError}=await admin.from("roles").select("id").eq("role_code",body.role_code).single();
    if(findRoleError) throw findRoleError;
    const {error:assignError}=await admin.from("user_roles").insert({user_id:invite.user.id,role_id:role.id,scope:body.scope||"hospital_main"});
    if(assignError) throw assignError;
    if(body.facility_id){const {error:memberError}=await admin.from("facility_memberships").insert({facility_id:body.facility_id,user_id:invite.user.id,role_id:role.id});if(memberError)throw memberError;}
    if(healthRole){const {error:healthError}=await admin.from("health_department_memberships").insert({jurisdiction_id:body.jurisdiction_id,user_id:invite.user.id,role_id:role.id});if(healthError)throw healthError;}
    return new Response(JSON.stringify({id:invite.user.id,email:invite.user.email,phone:invite.user.phone,role_code:body.role_code,temporary_password:temporaryPassword}),{headers:{...cors,"Content-Type":"application/json"},status:201});
  } catch(error){return new Response(JSON.stringify({error:error.message}),{headers:{...cors,"Content-Type":"application/json"},status:400});}
});
