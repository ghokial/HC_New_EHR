import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const reply=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const {username,password}=await req.json();
    const identifier=String(username||"").trim();
    if(!identifier||typeof password!=="string")return reply({error:"Invalid login credentials"},400);
    const url=Deno.env.get("SUPABASE_URL")!,anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const {data:profile}=await admin.from("profiles").select("email").ilike("username",identifier).limit(1).maybeSingle();
    if(!profile?.email)return reply({error:"Invalid login credentials"},401);
    const auth=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await auth.auth.signInWithPassword({email:profile.email,password});
    if(error||!data.session)return reply({error:"Invalid login credentials"},401);
    return reply({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
  }catch{return reply({error:"Invalid login credentials"},401)}
});
