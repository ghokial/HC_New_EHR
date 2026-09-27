// SMART on FHIR database flow: registration, consent, code exchange, token use.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers } from "./harness.mjs";
import { pkceChallenge } from "../../supabase/functions/_shared/smart.js";

let h, ids = {};
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const asService = async (sql, params) => { await h.q(`reset role`); await h.q(`set role service_role`); try { return (await h.q(sql, params)).rows[0]; } finally { await h.q(`reset role`); } };
const redeem = (code, extra = {}) => asService(`select public.smart_redeem_code($1,$2,$3,$4,$5) as r`, [code, extra.client ?? ids.client, extra.redirect ?? "https://app.example/callback", extra.challenge ?? ids.challenge, extra.secret ?? null]).then(r => r.r);
const approve = (userId, patient, scopes = ["launch/patient", "patient/*.read"]) => h.as(userId, "aal1", () => h.q(`select public.smart_approve($1,'https://app.example/callback',$2,$3,$4) as r`, [ids.client, scopes, patient, ids.challenge])).then(r => r.rows[0].r);

before(async () => {
  h = helpers(await createDatabase());
  ids.challenge = await pkceChallenge(verifier);
  ids.root = await h.user("root@hc.test"); await h.q(`insert into public.user_roles(user_id,role_id,scope) values($1,(select id from public.roles where role_code='root'),'global')`, [ids.root]);
  ids.owner = await h.user("o@f1.test"); ids.f1 = await h.facility("f-one", ids.owner);
  ids.mum = await h.user("mum@home.test"); ids.child = await h.user("child@home.test"); ids.stranger = await h.user("x@home.test");
  const patientOf = async userId => (await h.one(`select patient_id from public.patient_accounts where user_id=$1`, [userId])).patient_id;
  ids.mumP = await patientOf(ids.mum); ids.childP = await patientOf(ids.child);
  ids.proxy = (await h.one(`insert into public.patient_proxies(proxy_patient_id,target_patient_id,relationship,can_view,active) values($1,$2,'parent',true,true) returning id`, [ids.mumP, ids.childP])).id;
});

test("only Root registers apps, and redirect URIs must be https (or localhost)", async () => {
  await assert.rejects(h.as(ids.owner, "aal2", () => h.q(`select public.register_smart_client('App',array['https://app.example/callback'])`)), /Only Healthcarology Root/);
  await assert.rejects(h.as(ids.root, "aal2", () => h.q(`select public.register_smart_client('App',array['http://app.example/callback'])`)), /must use https/);
  ids.client = (await h.as(ids.root, "aal2", () => h.q(`select public.register_smart_client('Test App',array['https://app.example/callback']) as r`))).rows[0].r.client_id;
  const conf = (await h.as(ids.root, "aal2", () => h.q(`select public.register_smart_client('Server App',array['https://srv.example/cb'],true) as r`))).rows[0].r;
  ids.confClient = conf.client_id; ids.confSecret = conf.client_secret; assert.match(ids.confSecret, /^hcsec_/);
  await assert.rejects(h.as(ids.root, "aal2", () => h.q(`select * from public.smart_clients`)), /permission denied/, "no direct table access");
});

test("the consent page can verify the app and redirect before sign-in", async () => {
  await h.q(`set role anon`);
  try {
    assert.equal((await h.q(`select public.smart_client_info($1,'https://app.example/callback') as r`, [ids.client])).rows[0].r.name, "Test App");
    assert.match((await h.q(`select public.smart_client_info($1,'https://evil.example/cb') as r`, [ids.client])).rows[0].r.error, /not registered/);
  } finally { await h.q(`reset role`); }
});

test("a person can authorize their own record or a linked child's, never a stranger's", async () => {
  assert.deepEqual((await h.as(ids.mum, "aal1", () => h.q(`select patient_id from public.smart_authorizable_patients() order by relationship desc`))).rows.map(r => Number(r.patient_id)).sort(), [Number(ids.mumP), Number(ids.childP)].sort());
  await assert.rejects(approve(ids.stranger, ids.mumP), /not allowed to share/);
  await assert.rejects(h.as(ids.mum, "aal1", () => h.q(`select public.smart_approve($1,'https://app.example/callback',array['patient/*.read'],$2,'weak')`, [ids.client, ids.mumP])), /PKCE/);
  const r = await approve(ids.mum, ids.mumP, ["launch/patient", "patient/*.read", "user/*.read", "patient/Patient.write"]);
  assert.deepEqual(r.scopes, ["launch/patient", "patient/*.read"], "unsupported scopes are dropped");
  ids.code = r.code;
});

test("the code is exchanged once, only with the right verifier and redirect", async () => {
  assert.equal((await redeem(ids.code, { challenge: "wrong".padEnd(43, "x") })).error, "invalid_grant", "wrong verifier burns the code");
  assert.equal((await redeem(ids.code)).error, "invalid_grant", "a used code cannot be replayed");
  const fresh = (await approve(ids.mum, ids.mumP)).code;
  assert.equal((await redeem(fresh, { redirect: "https://other.example/cb" })).error, "invalid_grant");
  const good = await redeem((await approve(ids.mum, ids.mumP)).code);
  assert.equal(good.token_type, "Bearer"); assert.equal(good.expires_in, 3600); assert.equal(good.patient, String(ids.mumP)); assert.match(good.access_token, /^hcs_/);
  ids.token = good.access_token;
});

test("confidential apps must present their secret", async () => {
  const code = (await h.as(ids.mum, "aal1", () => h.q(`select public.smart_approve($1,'https://srv.example/cb',array['patient/*.read'],$2,$3) as r`, [ids.confClient, ids.mumP, ids.challenge]))).rows[0].r.code;
  assert.equal((await redeem(code, { client: ids.confClient, redirect: "https://srv.example/cb", secret: "nope" })).error, "invalid_client");
  const code2 = (await h.as(ids.mum, "aal1", () => h.q(`select public.smart_approve($1,'https://srv.example/cb',array['patient/*.read'],$2,$3) as r`, [ids.confClient, ids.mumP, ids.challenge]))).rows[0].r.code;
  assert.match((await redeem(code2, { client: ids.confClient, redirect: "https://srv.example/cb", secret: ids.confSecret })).access_token, /^hcs_/);
});

test("each token use is audited, and withdrawal or a revoked family link stops access", async () => {
  const resolved = (await asService(`select public.smart_resolve_token($1) as r`, [ids.token])).r;
  assert.equal(Number(resolved.patient_id), Number(ids.mumP)); assert.equal(resolved.client, "Test App");
  assert.equal((await h.one(`select count(*)::int as n from public.audit_logs where context='smart:Test App' and patient_id=$1`, [ids.mumP])).n, 1);
  const active = (await h.as(ids.mum, "aal1", () => h.q(`select id from public.my_smart_authorizations() where revoked_at is null and app='Test App' and patient_id=$1`, [ids.mumP]))).rows;
  assert.equal(active.length, 1, "the person sees the app they connected");
  await h.as(ids.mum, "aal1", () => h.q(`select public.revoke_my_smart_authorization($1)`, [active[0].id]));
  assert.equal((await asService(`select public.smart_resolve_token($1) as r`, [ids.token])).r, null, "withdrawn token no longer works");
  const childToken = (await redeem((await approve(ids.mum, ids.childP)).code)).access_token;
  assert.ok((await asService(`select public.smart_resolve_token($1) as r`, [childToken])).r);
  await h.q(`update public.patient_proxies set active=false where id=$1`, [ids.proxy]);
  assert.equal((await asService(`select public.smart_resolve_token($1) as r`, [childToken])).r, null, "ending the family link ends the app's access");
  await assert.rejects(h.as(ids.mum, "aal1", () => h.q(`select public.smart_redeem_code('x','y','z','w',null)`)), /permission denied/, "users cannot call the token functions directly");
});
