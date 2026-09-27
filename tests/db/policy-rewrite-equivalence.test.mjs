// The per-statement policy rewrite (20260928100000) must not change who can read what.
// Every public table is read by a range of users, with and without MFA, before and
// after the migration, and the visible rows must be identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase, helpers, applyMigration } from "./harness.mjs";

const MIGRATION = "20260928100000_policy_per_statement_checks.sql";

test("policy rewrite leaves every user's visible rows unchanged", async () => {
  const db = await createDatabase({ stopBefore: MIGRATION });
  const h = helpers(db), ids = {};
  const u = async name => (ids[name] = await h.user(`${name}@eq.test`));
  for (const n of ["owner1", "owner2", "doc1", "nurse2", "billing1", "him1", "patient", "proxy", "multi", "former", "root", "outsider"]) await u(n);
  ids.f1 = await h.facility("eq-one", ids.owner1); ids.f2 = await h.facility("eq-two", ids.owner2);
  const sysadmin = `(select id from public.roles where role_code='sysadmin')`;
  await h.q(`insert into public.facility_memberships(facility_id,user_id,role_id,is_owner) values($1,$2,${sysadmin},true),($3,$4,${sysadmin},true) on conflict do nothing`, [ids.f1, ids.owner1, ids.f2, ids.owner2]);
  await h.q(`insert into public.active_facility_context(user_id,facility_id) values($1,$2),($3,$4) on conflict(user_id) do nothing`, [ids.owner1, ids.f1, ids.owner2, ids.f2]);
  await h.member(ids.f1, ids.doc1, "physician"); await h.member(ids.f2, ids.nurse2, "nurse");
  await h.member(ids.f1, ids.billing1, "billing"); await h.member(ids.f1, ids.him1, "him");
  // Member of both facilities, working in the second.
  await h.member(ids.f2, ids.multi, "physician"); await h.member(ids.f1, ids.multi, "nurse");
  // A membership that has been ended.
  await h.member(ids.f1, ids.former, "physician"); await h.q(`update public.facility_memberships set active=false where user_id=$1`, [ids.former]);
  await h.q(`insert into public.user_roles(user_id,role_id) values($1,(select id from public.roles where role_code='root'))`, [ids.root]);

  // Clinical rows, loaded without triggers (visibility is what is compared).
  await db.exec(`set session_replication_role = replica`);
  // Columns defaulting to auth.uid() record the physician as author.
  await db.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: ids.doc1 })]);
  const one = h.one;
  const pat = async (first, fid) => (await one(`insert into public.patients(first_name,last_name,facility_id) values($1,'Eq',$2) returning id`, [first, fid])).id;
  ids.p1 = await pat("A", ids.f1); ids.p2 = await pat("B", ids.f2); ids.p3 = await pat("Proxy", ids.f2); ids.p4 = await pat("Unassigned", null);
  await h.q(`insert into public.patient_accounts(user_id,patient_id) values($1,$2),($3,$4)`, [ids.patient, ids.p1, ids.proxy, ids.p3]);
  await h.q(`insert into public.patient_proxies(proxy_patient_id,target_patient_id,relationship,active,can_view) values($1,$2,'parent',true,true)`, [ids.p3, ids.p1]);
  for (const p of [ids.p1, ids.p2, ids.p3, ids.p4]) {
    await h.q(`insert into public.encounters(patient_id,encounter_type,start_at,status) values($1,'Outpatient',now(),'closed')`, [p]);
    await h.q(`insert into public.clinical_notes(patient_id,note_type,content,status) values($1,'progress','Eq note','signed')`, [p]);
    await h.q(`insert into public.patient_allergies(patient_id,allergen_type,substance,recorded_by) values($1,'food','peanut',$2)`, [p, ids.doc1]);
    await h.q(`insert into public.immunizations(patient_id,vaccine_name,administered_at) values($1,'Eq vaccine',now())`, [p]);
    await h.q(`insert into public.patient_contact_methods(patient_id,contact_type,contact_value) values($1,'phone','+10000000000')`, [p]);
    const order = (await one(`insert into public.orders(patient_id,order_type) values($1,'imaging') returning id`, [p])).id;
    await h.q(`insert into public.imaging_orders(order_id,modality) values($1,'CT')`, [order]);
  }
  await h.q(`insert into public.audit_logs(action_type,actor_type,facility_id,patient_id) values('VIEW','user',$1,$2),('VIEW','user',$3,$4)`, [ids.f1, ids.p1, ids.f2, ids.p2]);
  await db.exec(`set session_replication_role = origin`);

  const tables = (await h.q(`select tablename from pg_tables where schemaname='public' order by 1`)).rows.map(r => r.tablename);
  const snapshot = async () => {
    const out = {};
    for (const [name, id] of Object.entries(ids)) {
      if (!["owner1", "owner2", "doc1", "nurse2", "billing1", "him1", "patient", "proxy", "multi", "former", "root", "outsider"].includes(name)) continue;
      for (const aal of ["aal1", "aal2"]) for (const t of tables) {
        out[`${name}/${aal}/${t}`] = await h.as(id, aal, () => db.query(`select count(*)::int n, md5(coalesce(string_agg(x::text,'|' order by x::text),'')) h from public.${t} x`))
          .then(r => `${r.rows[0].n}:${r.rows[0].h}`, e => `error:${e.message}`);
      }
    }
    return out;
  };
  const before = await snapshot();
  await applyMigration(db, MIGRATION);
  const after = await snapshot();
  const differences = Object.keys(before).filter(k => before[k] !== after[k]).map(k => `${k}: ${before[k]} -> ${after[k]}`);
  assert.deepEqual(differences, []);
  // The fixture exercises the rewritten rules (not an empty comparison).
  assert.match(after["doc1/aal2/encounters"], /^1:/); assert.match(after["patient/aal2/encounters"], /^1:/);
  assert.match(after["nurse2/aal2/encounters"], /^2:/); assert.match(after["multi/aal2/encounters"], /^2:/, "only the facility being worked in");
  assert.match(after["former/aal2/encounters"], /^0:/); assert.match(after["doc1/aal1/encounters"], /^0:/, "no clinical data without MFA");
  assert.match(after["him1/aal2/audit_logs"], /^[1-9]/); assert.match(after["doc1/aal2/audit_logs"], /^0:/);
  // Rewritten policies no longer call the per-row helpers.
  const left = (await h.q(`select count(*)::int n from pg_policies where schemaname='public' and tablename not in ('facility_memberships','user_roles','roles','active_facility_context','clinical_service_referrals') and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'can_read_patient_record|has_facility_role|is_facility_member|is_active_facility'`)).rows[0].n;
  assert.equal(left, 0);
});

test("no table's access rules loop back on themselves for any command", async () => {
  const db = await createDatabase(), h = helpers(db);
  const u = await h.user("scan@eq.test"), f = await h.facility("scan-one", u); await h.member(f, u, "physician");
  const tables = (await db.query(`select c.relname t,(select attname from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped order by attnum limit 1) col from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity`)).rows;
  const loops = [];
  // EXPLAIN applies the access rules without running the statement.
  for (const { t, col } of tables) for (const sql of [`select * from public.${t}`, `update public.${t} set ${col}=${col}`, `delete from public.${t}`, `insert into public.${t} select (r).* from (select null::public.${t} as r) s`]) {
    await h.as(u, "aal2", () => db.query(`explain ${sql}`)).catch(e => { if (/recursion/.test(e.message)) loops.push(`${sql}: ${e.message}`); });
  }
  assert.ok(tables.length > 100);
  assert.deepEqual(loops, []);
});
