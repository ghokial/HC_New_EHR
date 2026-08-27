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
    const {data:roleRow,error:roleError}=await caller.from("user_roles").select("roles!inner(role_code)").eq("user_id",user.id).in("roles.role_code",["root","sysadmin"]).limit(1).maybeSingle();
    if(roleError||!roleRow) throw new Error("Root or System Administrator access required");
    const body=await req.json();
    if(!body.email||!body.role_code) throw new Error("email and role_code are required");
    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:invite,error:inviteError}=await admin.auth.admin.inviteUserByEmail(body.email,{data:{display_name:body.display_name||body.email.split("@")[0]}});
    if(inviteError) throw inviteError;
    const {data:role,error:findRoleError}=await admin.from("roles").select("id").eq("role_code",body.role_code).single();
    if(findRoleError) throw findRoleError;
    const {error:assignError}=await admin.from("user_roles").insert({user_id:invite.user.id,role_id:role.id,scope:body.scope||"hospital_main"});
    if(assignError) throw assignError;
    return new Response(JSON.stringify({id:invite.user.id,email:invite.user.email,role_code:body.role_code}),{headers:{...cors,"Content-Type":"application/json"},status:201});
  } catch(error){return new Response(JSON.stringify({error:error.message}),{headers:{...cors,"Content-Type":"application/json"},status:400});}
});
