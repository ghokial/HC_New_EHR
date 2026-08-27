import {createClient} from "npm:@supabase/supabase-js@2.112.4";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const encode=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
const digest=async(value:string)=>encode(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))));
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const auth=req.headers.get("Authorization");if(!auth)throw new Error("Authentication required");
  const token=auth.replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!;
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userError}=await caller.auth.getUser(token);if(userError||!user)throw new Error("Invalid session");
  const payload=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));if(payload.aal!=="aal2")throw new Error("MFA confirmation required");
  const body=await req.json(),expires=new Date(body.expires_at);if(!body.patient_id||!body.grantee_identifier||!Number.isFinite(expires.getTime())||expires<=new Date())throw new Error("Patient, grantee, and a future expiration are required");
  if(!["complete","partial"].includes(body.share_scope)||!["read_only","read_write"].includes(body.access_level))throw new Error("Invalid share scope or access level");
  const random=new Uint8Array(24);crypto.getRandomValues(random);const rawToken=encode(random),password=`HC-${rawToken.slice(0,6).toUpperCase()}-${rawToken.slice(6,12).toUpperCase()}`;
  const record={patient_id:Number(body.patient_id),grantor_user_id:user.id,grantee_identifier:String(body.grantee_identifier).trim(),grantee_identifier_type:body.grantee_identifier_type==="phone"?"phone":"email",access_level:body.access_level,share_scope:body.share_scope,period_start:body.period_start||null,period_end:body.period_end||null,included_elements:Array.isArray(body.included_elements)?body.included_elements:[],token_hash:await digest(rawToken),password_hash:await digest(password),expires_at:expires.toISOString(),mfa_confirmed_at:new Date().toISOString()};
  const {data,error}=await caller.from("patient_record_shares").insert(record).select("id").single();if(error)throw error;
  const origin=req.headers.get("origin")||"https://healthcarology.com";
  return new Response(JSON.stringify({share_id:data.id,share_url:`${origin}/shared-record?token=${rawToken}`,temporary_password:password,username:record.grantee_identifier,expires_at:record.expires_at}),{status:201,headers:{...cors,"Content-Type":"application/json"}});
 }catch(error){return new Response(JSON.stringify({error:error.message}),{status:400,headers:{...cors,"Content-Type":"application/json"}})}
});
