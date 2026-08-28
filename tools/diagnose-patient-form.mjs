import { chromium } from "file:///C:/Users/ghoki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});
const page=await browser.newPage();
page.setDefaultTimeout(5000);
const errors=[];page.on("pageerror",error=>errors.push(error.message));
await page.route("**/vendor/supabase.js",route=>route.fulfill({contentType:"application/javascript",body:`globalThis.supabase={createClient(){const user={id:"diagnostic-user",email:"diagnostic@example.test",app_metadata:{}};const rows={countries:[{id:1,iso2:"CD",default_name:"Democratic Republic of the Congo"},{id:2,iso2:"GA",default_name:"Gabon"},{id:3,iso2:"BJ",default_name:"Benin"},{id:4,iso2:"NG",default_name:"Nigeria"}],service_affiliation_catalog:[{entry_type:"rank",name:"CAPITAINE"},{entry_type:"unit",name:"CORPS DE SANTE MILITAIRE"}]};return{auth:{getSession:async()=>({data:{session:{user}}}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal2"},error:null})},onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}},from(table){const chain=new Proxy({}, {get(_t,p){if(p==="maybeSingle"||p==="single")return async()=>({data:null,error:null});if(p==="then")return resolve=>resolve({data:rows[table]||[],error:null});return()=>chain}});return chain},functions:{invoke:async()=>({data:null,error:null})}}}};`}));
await page.goto("http://127.0.0.1:4173/?register=patient",{waitUntil:"domcontentloaded"});
await page.locator("#patient-form").waitFor();
const initialRankHidden=await page.locator("#rank-label").evaluate(element=>getComputedStyle(element).display==="none");
const dependentRelationship=page.locator('[name="dependent_relationship"]').locator("..");
const initialDependentHidden=await dependentRelationship.evaluate(element=>getComputedStyle(element).display==="none");
await page.locator("#country-select").selectOption("1");
await page.locator("#patient-type").selectOption({label:"Military"});
await page.waitForTimeout(100);
await page.locator("#patient-province").selectOption({label:"Kinshasa"});
await page.locator("#patient-type").selectOption({label:"Military Dependent"});
const provinceOptions=await page.locator("#patient-province option").allTextContents(),cityOptions=await page.locator("#patient-city option").allTextContents(),world={};
for(const [id,country,expected] of [["2","Gabon","Estuaire"],["3","Benin","Alibori"],["4","Nigeria","Abia"]]){await page.locator("#country-select").selectOption(id);await page.locator("#patient-province option",{hasText:expected}).waitFor({state:"attached"});world[country]=await page.locator("#patient-province option").allTextContents()}
const result={initialRankHidden,initialDependentHidden,dependentVisible:await dependentRelationship.evaluate(element=>getComputedStyle(element).display!=="none"),provinceOptions,cityOptions,world,militaryRankVisible:await page.locator("#rank-label").evaluate(element=>getComputedStyle(element).display!=="none"),customRankHidden:await page.locator("#rank-custom-label").evaluate(element=>getComputedStyle(element).display==="none"),errors};
console.log(JSON.stringify(result,null,2));await browser.close();
process.exit(result.initialRankHidden&&result.initialDependentHidden&&result.dependentVisible&&result.militaryRankVisible&&result.customRankHidden&&result.provinceOptions.includes("Kinshasa")&&result.cityOptions.includes("Kinshasa")&&result.world.Gabon.includes("Estuaire")&&result.world.Benin.includes("Alibori")&&result.world.Nigeria.includes("Abia")&&result.errors.length===0?0:1);
