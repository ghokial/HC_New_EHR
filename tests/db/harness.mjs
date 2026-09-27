// In-memory Postgres (PGlite) with minimal Supabase stand-ins, every migration
// applied in order, and helpers to run SQL as a signed-in user.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";

const migrations = new URL("../../supabase/migrations/", import.meta.url);

// stopBefore: apply only migrations whose file name sorts before this value.
export async function createDatabase({ stopBefore } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key default gen_random_uuid(), email text, phone text, raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant usage on schema public to anon,authenticated; grant usage on schema extensions to anon,authenticated;
    grant execute on all functions in schema auth to anon,authenticated;
    -- Supabase's standard default privileges; RLS decides which rows are visible.
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    -- Supabase Storage stand-ins used by the profile-photo migration.
    create schema storage;
    create table storage.buckets(id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    create function storage.extension(name text) returns text language sql immutable as $$ select lower(split_part(name,'.',array_length(string_to_array(name,'.'),1))) $$;
    grant usage on schema storage to anon,authenticated;
    -- pg_cron is not available in PGlite; schedules are accepted and ignored.
    create schema cron;
    create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 1::bigint $$;
  `);
  const files = (await readdir(migrations)).filter(name => name.endsWith(".sql") && (!stopBefore || name < stopBefore)).sort();
  for (const name of files) {
    try { await db.exec(forPglite(await readFile(new URL(name, migrations), "utf8"))); }
    catch (error) { throw new Error(`Migration ${name} failed: ${error.message}`); }
    // The country catalog is loaded by scripts/seed-countries.mjs; the DRC geography migration needs its row.
    if (name.startsWith("20260826000000")) await db.exec(`insert into public.countries(iso2,iso3,numeric_code,default_name) values('CD','COD',180,'Congo, Democratic Republic of the')`);
  }
  return db;
}

// pg_cron cannot be installed in PGlite; the cron schema above stands in for it.
const forPglite = sql => sql.replace(/create extension if not exists pg_cron;/gi, "");

export async function applyMigration(db, name) {
  await db.exec(forPglite(await readFile(new URL(name, migrations), "utf8")));
}

export function helpers(db) {
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const user = async email => (await one(`insert into auth.users(email,raw_user_meta_data) values($1::text,jsonb_build_object('display_name',$1::text)) returning id`, [email])).id;
  const role = async code => (await one(`select id from public.roles where role_code=$1`, [code])).id;
  const facility = async (slug, ownerId, type = "Hospital") => (await one(`insert into public.facilities(name,slug,owner_user_id,facility_type) values($1,$1,$2,$3) returning id`, [slug, ownerId, type])).id;
  // Adds a membership and, as the staff app does at sign-in, makes the first facility the user's active one.
  const member = async (facilityId, userId, roleCode) => {
    await db.query(`insert into public.facility_memberships(facility_id,user_id,role_id) values($1,$2,$3)`, [facilityId, userId, await role(roleCode)]);
    await db.query(`insert into public.active_facility_context(user_id,facility_id) values($1,$2) on conflict(user_id) do nothing`, [userId, facilityId]);
  };
  // Runs fn as `userId` through the authenticated role, with the given MFA level.
  const as = async (userId, aal, fn) => {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claims',$1,false)`, [JSON.stringify({ sub: userId, aal, role: "authenticated" })]);
    await db.exec(`set role authenticated`);
    try { return await fn(); } finally { await db.exec(`reset role`); }
  };
  const q = (sql, params = []) => db.query(sql, params);
  return { one, user, role, facility, member, as, q };
}
