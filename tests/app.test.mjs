import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("prototype exposes every source-defined core module", async () => {
  const js = await read("app.js");
  for (const module of ["Patients","Encounters","Orders & results","Medications","Clinical notes","UNIN registry","Departments","Access control","Audit trail"]) assert.match(js, new RegExp(module.replace(/[&]/g,"\\&"),"i"));
});

test("migration enables RLS and avoids deprecated auth.role policies", async () => {
  const sql = await read("supabase/migrations/20260826000000_healthcarology_ehr.sql");
  assert.match(sql,/alter table public\.patients enable row level security/i);
  assert.match(sql,/auth\.jwt\(\)->'app_metadata'/i);
  assert.doesNotMatch(sql,/auth\.role\(\)/i);
});

test("UI declares demonstration-data boundary", async () => {
  const html = await read("index.html");
  const js = await read("app.js");
  assert.match(html,/Demonstration data only/i);
  assert.match(js,/Demonstration only/i);
});

test("live authentication enforces temporary-password replacement", async () => {
  const live = await read("live.js");
  const createUser = await read("supabase/functions/create-user/index.ts");
  const changePassword = await read("supabase/functions/complete-password-change/index.ts");
  assert.match(createUser, /crypto\.getRandomValues/);
  assert.match(createUser, /must_change_password:true/);
  assert.match(live, /signInWithPassword/);
  assert.match(live, /passwordChangeGate/);
  assert.match(live, /resetPasswordForEmail/);
  assert.match(live, /PASSWORD_RECOVERY/);
  assert.match(changePassword, /updateUserById/);
  assert.match(changePassword, /must_change_password:false/);
});

test("direct file opening provides launcher guidance", async () => {
  const html = await read("index.html");
  const launcher = await read("Start Healthcarology EHR.cmd");
  assert.match(html, /location\.protocol === "file:"/);
  assert.match(html, /Start Healthcarology EHR\.cmd/);
  assert.match(launcher, /http:\/\/127\.0\.0\.1:4173\//);
});
