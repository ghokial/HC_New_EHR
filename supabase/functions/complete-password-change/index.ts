import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  try{
    const auth=req.headers.get("Authorization"); if(!auth) throw new Error("Authentication required");
    const url=Deno.env.get("SUPABASE_URL")!;
    const caller=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
    const {data:{user},error:userError}=await caller.auth.getUser(); if(userError||!user) throw new Error("Invalid session");
    const {password}=await req.json();
    if(typeof password!=="string"||password.length<12) throw new Error("New password must contain at least 12 characters");
    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const appMetadata={...(user.app_metadata||{}),must_change_password:false,password_changed_at:new Date().toISOString()};
    const {error}=await admin.auth.admin.updateUserById(user.id,{password,app_metadata:appMetadata}); if(error) throw error;
    return new Response(JSON.stringify({success:true}),{headers:{...cors,"Content-Type":"application/json"}});
  }catch(error){return new Response(JSON.stringify({error:error.message}),{headers:{...cors,"Content-Type":"application/json"},status:400});}
});
