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
  body: `globalThis.supabase={createClient(){const user={id:"diagnostic-user",email:"diagnostic@example.test",app_metadata:{}};const chain=new Proxy({}, {get(_t,p){if(p==="maybeSingle"||p==="single")return async()=>({data:null,error:null});if(p==="then")return undefined;return()=>chain}});return{auth:{getSession:async()=>({data:{session:{user}}}),onAuthStateChange(cb){setTimeout(()=>cb("INITIAL_SESSION",{user}),20);return{data:{subscription:{unsubscribe(){}}}}},signOut:async()=>{}},from(){return chain},functions:{invoke:async()=>({data:null,error:null})}}}};`
}));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded", timeout: 15000 });
await page.locator("#view h1").waitFor({ timeout: 5000 });
await page.waitForTimeout(250);
const before = await page.locator("#view h1").textContent();
await page.locator('#primary-nav [data-view="patients"]').click();
await page.waitForTimeout(500);
const after = await page.locator("#view h1").textContent();
const sourceMode = await page.locator(".source-note strong").textContent();
const userState = await page.locator(".user-menu small").textContent();
console.log(JSON.stringify({ before, after, sourceMode, userState, documentLoads, messages }, null, 2));
await browser.close().catch(() => {});
process.exit(0);
