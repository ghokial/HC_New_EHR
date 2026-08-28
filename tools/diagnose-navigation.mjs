import { chromium } from "file:///C:/Users/ghoki/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const page = await browser.newPage();
const messages = [];
let documentLoads = 0;
page.on("domcontentloaded", () => documentLoads++);
page.on("console", message => messages.push(`console:${message.type()}:${message.text()}`));
page.on("pageerror", error => messages.push(`pageerror:${error.stack || error.message}`));
await page.route("**/vendor/supabase.js", route => route.fulfill({
  contentType: "application/javascript",
  body: `globalThis.supabase={createClient(){const user={id:"diagnostic-user",email:"diagnostic@example.test",app_metadata:{}};const chain=new Proxy({}, {get(_t,p){if(p==="maybeSingle"||p==="single")return async()=>({data:null,error:null});if(p==="then")return resolve=>resolve({data:[],error:null});return()=>chain}});return{auth:{getSession:async()=>({data:{session:{user}}}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal2"},error:null})},onAuthStateChange(cb){setTimeout(()=>cb("INITIAL_SESSION",{user}),20);return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},from(){return chain},functions:{invoke:async()=>({data:null,error:null})}}}};`
}));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 15000 });
await page.locator("#view h1").waitFor({ timeout: 5000 });
await page.waitForTimeout(250);
const before = await page.locator("#view h1").textContent();
const routeTitles={patients:"Patients",chart:"Patient chart",encounters:"Encounters",orders:"Orders & results",medications:"Medications",notes:"Clinical notes",registry:"UNIN registry",departments:"Departments & services",access:"Access control",audit:"Audit trail"};
const routes={};
for(const [route,expected] of Object.entries(routeTitles)){
  await page.locator(`#primary-nav [data-view="${route}"]`).click();
  await page.waitForTimeout(60);
  routes[route]={expected,actual:await page.locator("#view h1").textContent()};
}
const after=routes.patients.actual;
const sourceMode = await page.locator(".source-note strong").textContent();
const userState = await page.locator(".user-menu small").textContent();
console.log(JSON.stringify({ before, after, routes, sourceMode, userState, documentLoads, messages }, null, 2));
await browser.close().catch(() => {});
const failed=Object.values(routes).some(route=>route.actual!==route.expected)||documentLoads!==1||messages.some(message=>message.startsWith("pageerror:"));
process.exit(failed?1:0);
