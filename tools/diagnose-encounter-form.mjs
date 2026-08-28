import { chromium } from "file:///C:/Users/ghoki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const page = await browser.newPage();
const messages = [];
page.on("console", message => messages.push(`console:${message.type()}:${message.text()}`));
page.on("pageerror", error => messages.push(`pageerror:${error.stack || error.message}`));
await page.route("**/vendor/supabase.js", route => route.fulfill({
  contentType: "application/javascript",
  body: `globalThis.supabase={createClient(){
    const user={id:"diagnostic-user",email:"diagnostic@example.test",app_metadata:{}};
    const rows={
      patients:[{id:1,first_name:"Ada",last_name:"Patient",snau:"TEST-1"}],
      services:[
        {id:12,name:"Zulu Service",department_id:2,departments:{id:2,name:"Cardiology"}},
        {id:11,name:"Alpha Service",department_id:2,departments:{id:2,name:"Cardiology"}},
        {id:21,name:"Beta Service",department_id:1,departments:{id:1,name:"Anesthesiology"}}
      ],
      medications:[]
    };
    const chainFor=table=>{let chain;chain=new Proxy({}, {get(_target,property){
      if(property==="maybeSingle"||property==="single")return async()=>({data:table==="providers"?{id:8}:table==="facility_memberships"?{facility_id:9}:table==="user_roles"?{roles:{role_name:"System Administrator",role_code:"sysadmin"}}:null,error:null});
      if(property==="then")return resolve=>resolve({data:rows[table]||[],error:null});
      return()=>chain;
    }});return chain};
    return{auth:{getSession:async()=>({data:{session:{user}}}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal2"},error:null})},onAuthStateChange(callback){setTimeout(()=>callback("INITIAL_SESSION",{user}),20);return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},from:chainFor,functions:{invoke:async()=>({data:null,error:null})}};
  }};`
}));

await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 15000 });
await page.locator("#view h1").waitFor({ timeout: 5000 });
await page.locator(".user-menu small").filter({hasText:"System Administrator"}).waitFor({timeout:5000});
await page.locator('#primary-nav [data-view="encounters"]').click();
await page.locator('[data-action="module-create"]').click();
await page.locator("#encounter-department").waitFor({ timeout: 5000 });

const departmentNames = await page.locator("#encounter-department option").allTextContents();
const initiallyDisabled = await page.locator("#encounter-service").isDisabled();
const initialServiceText = await page.locator("#encounter-service option").allTextContents();
await page.locator("#encounter-department").selectOption("2");
const serviceNames = await page.locator("#encounter-service option").allTextContents();
const serviceValues = await page.locator("#encounter-service option").evaluateAll(options => options.map(option => option.value));
const enabledAfterSelection = await page.locator("#encounter-service").isEnabled();
await page.locator("#encounter-department").selectOption("__other__");
const departmentFieldVisible=await page.locator("#new-department-field").isVisible();
const serviceFieldVisible=await page.locator("#new-service-field").isVisible();
const newServiceRequired=await page.locator("#new-service-name").getAttribute("required");

const result={departmentNames,initiallyDisabled,initialServiceText,serviceNames,serviceValues,enabledAfterSelection,departmentFieldVisible,serviceFieldVisible,newServiceRequired,messages};
console.log(JSON.stringify(result,null,2));
await browser.close().catch(()=>{});
const passed=JSON.stringify(departmentNames)==='["Select department","Anesthesiology","Cardiology","Other — add new"]'
  && initiallyDisabled
  && JSON.stringify(initialServiceText)==='["Select department first"]'
  && JSON.stringify(serviceNames)==='["Select service","Alpha Service","Zulu Service","Other — add new"]'
  && JSON.stringify(serviceValues)==='["","11","12","__other__"]'
  && enabledAfterSelection
  && departmentFieldVisible
  && serviceFieldVisible
  && newServiceRequired!==null
  && !messages.some(message=>message.startsWith("pageerror:"));
process.exit(passed?0:1);
