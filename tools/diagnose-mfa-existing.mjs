import { chromium } from "file:///C:/Users/ghoki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const page=await browser.newPage();const errors=[];page.on("pageerror",error=>errors.push(error.message));
await page.route("**/vendor/supabase.js",route=>route.fulfill({contentType:"application/javascript",body:`globalThis.supabase={createClient(){const user={id:"mfa-user",app_metadata:{}};const factors={totp:[{id:"totp-1",factor_type:"totp",status:"verified",friendly_name:"Microsoft Authenticator"}],phone:[{id:"phone-1",factor_type:"phone",status:"verified",friendly_name:"Healthcarology SMS",phone:"+1•••5555"}]};return{auth:{getSession:async()=>({data:{session:{user}}}),refreshSession:async()=>({data:{session:{user}},error:null}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal1"},error:null}),listFactors:async()=>({data:factors,error:null}),challenge:async()=>({data:{id:"challenge-1"},error:null}),verify:async()=>({data:{},error:null})}},from(){const chain=new Proxy({}, {get(_t,p){if(p==="maybeSingle"||p==="single")return async()=>({data:null,error:null});if(p==="then")return resolve=>resolve({data:[],error:null});return()=>chain}});return chain}}}};`}));
await page.goto("http://127.0.0.1:4173/admin",{waitUntil:"domcontentloaded"});
await page.getByRole("heading",{name:"Choose a verification method"}).waitFor();
const methods=await page.locator("[data-factor]").allTextContents();
await page.locator('[data-factor="totp-1"]').click();
await page.getByRole("heading",{name:"Enter verification code"}).waitFor();
await page.getByRole("button",{name:"Choose another enrolled method"}).click();
const returned=await page.getByRole("heading",{name:"Choose a verification method"}).isVisible();
const result={methods,returned,errors};console.log(JSON.stringify(result,null,2));await browser.close();
process.exit(methods.length===2&&returned&&errors.length===0?0:1);
