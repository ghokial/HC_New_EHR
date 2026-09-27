// SMART on FHIR authorization endpoint (standalone patient launch).
// The app sends the user here with response_type=code, client_id, redirect_uri, scope,
// state, aud, code_challenge, and code_challenge_method=S256. The person signs in,
// chooses whose record to share, and approves or denies; the page then returns to the
// app's registered redirect URI with ?code=...&state=... or ?error=access_denied.
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from "./supabase-config.js";
const supabase=globalThis.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY),app=document.querySelector("#portal-app");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const params=new URLSearchParams(location.search),expectedAud=`${SUPABASE_URL}/functions/v1/fhir`;
const request={responseType:params.get("response_type"),clientId:params.get("client_id")||"",redirectUri:params.get("redirect_uri")||"",scope:params.get("scope")||"",state:params.get("state")||"",aud:params.get("aud")||"",challenge:params.get("code_challenge")||"",method:params.get("code_challenge_method")||""};
const card=body=>{app.innerHTML=`<main class="auth-gate"><section class="auth-card"><img class="portal-logo" src="/assets/images/healthcarology-logo.png" alt="Healthcarology"><p class="eyebrow">Connect an app</p>${body}</section></main>`};
const scopeLabel=scope=>{const m=scope.match(/^patient\/(\*|[A-Za-z]+)\./);if(scope==="launch/patient")return"Know which patient record you chose";if(!m)return null;return m[1]==="*"?"Read your whole shareable health record":({Patient:"Your name, birth date, and contact details",Encounter:"Your visits and hospital stays",Observation:"Your validated laboratory results",Condition:"Your diagnoses",MedicationRequest:"Your medications",AllergyIntolerance:"Your allergies",Immunization:"Your immunizations"})[m[1]]};
// Errors are returned to the app only after its redirect URI has been verified.
const back=(query)=>{const target=new URL(request.redirectUri);for(const [k,v] of Object.entries(query))target.searchParams.set(k,v);if(request.state)target.searchParams.set("state",request.state);location.assign(target.toString())};

async function start(){
  if(request.responseType!=="code")return card(`<h1>Request not supported</h1><p>Only response_type=code is supported.</p>`);
  const {data:info,error}=await supabase.rpc("smart_client_info",{target_client:request.clientId,requested_redirect:request.redirectUri});
  if(error||info?.error)return card(`<h1>Unknown application</h1><p>${esc(error?.message||info.error)}</p><p class="muted">For your safety you have not been sent back to the app.</p>`);
  if(request.aud.replace(/\/$/,"")!==expectedAud)return back({error:"invalid_request",error_description:"aud must be the Healthcarology FHIR base URL"});
  if(request.method!=="S256"||!request.challenge)return back({error:"invalid_request",error_description:"PKCE with code_challenge_method=S256 is required"});
  const {data:{session}}=await supabase.auth.getSession();
  if(!session)return signIn(info.name);
  await consent(info.name);
}

function signIn(appName){
  card(`<h1>Sign in to connect ${esc(appName)}</h1><form><input name="identifier" autocomplete="username" placeholder="Email or phone (+country code)" required><input name="password" type="password" autocomplete="current-password" placeholder="Password" required><button class="button">Sign in</button></form><p id="message"></p>`);
  app.querySelector("form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),id=String(f.get("identifier")).trim(),password=f.get("password");const {error}=await supabase.auth.signInWithPassword(id.includes("@")?{email:id.toLowerCase(),password}:{phone:id.replace(/[\s().-]/g,""),password});if(error){app.querySelector("#message").textContent=error.message;return}await consent(appName)};
}

async function consent(appName){
  const {data:patients,error}=await supabase.rpc("smart_authorizable_patients");
  if(error)return card(`<h1>Could not load your records</h1><p>${esc(error.message)}</p>`);
  if(!(patients||[]).length)return card(`<h1>No patient record</h1><p>This account has no patient record that can be shared.</p><button class="button secondary" id="deny">Return to the app</button>`),app.querySelector("#deny").onclick=()=>back({error:"access_denied"});
  const requested=request.scope.split(/\s+/).filter(Boolean),shown=[...new Set(requested.map(scopeLabel).filter(Boolean))],ignored=requested.filter(s=>!scopeLabel(s)&&!["openid","fhirUser","offline_access","online_access"].includes(s));
  card(`<h1>${esc(appName)} wants to read your health record</h1><p>It will be able to:</p><ul>${shown.map(x=>`<li>${esc(x)}</li>`).join("")||"<li>Nothing that Healthcarology supports</li>"}</ul>${ignored.length?`<p class="muted">Not granted: ${esc(ignored.join(", "))}</p>`:""}<p class="muted">Read only. Access lasts one hour, is recorded in the audit log, and can be withdrawn from your portal.</p><form><label>Whose record?<select name="patient">${patients.map(p=>`<option value="${esc(p.patient_id)}">${esc(p.display_name)}${p.relationship==="self"?" (you)":` (${esc(p.relationship)})`}</option>`).join("")}</select></label><button class="button">Allow</button> <button type="button" class="button secondary" id="deny">Deny</button><p id="message"></p></form>`);
  app.querySelector("#deny").onclick=()=>back({error:"access_denied"});
  app.querySelector("form").onsubmit=async e=>{e.preventDefault();const {data,error:approveError}=await supabase.rpc("smart_approve",{target_client:request.clientId,requested_redirect:request.redirectUri,requested_scopes:requested,target_patient:Number(new FormData(e.target).get("patient")),pkce_challenge:request.challenge});if(approveError){app.querySelector("#message").textContent=approveError.message;return}back({code:data.code})};
}

start();
