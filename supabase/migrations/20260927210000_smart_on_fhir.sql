-- Phase 3: SMART on FHIR (App Launch, standalone patient launch).
-- Authorization code flow with PKCE (S256). Patient-context scopes only:
-- patient/<Type>.read or .rs (v1/v2 syntax), patient/*.read, patient/*.rs, launch/patient.
-- Tokens are opaque, stored only as SHA-256 hashes, valid for one hour, and re-checked
-- against the user's current right to see the patient on every use. No refresh tokens.

create table public.smart_clients(
 client_id text primary key default ('hcapp_'||encode(extensions.gen_random_bytes(12),'hex')),
 name text not null check(nullif(btrim(name),'') is not null),
 redirect_uris text[] not null check(cardinality(redirect_uris)>0),
 confidential boolean not null default false,
 secret_hash text,
 active boolean not null default true,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 check(not confidential or secret_hash is not null)
);
create table public.smart_authorization_codes(
 code_hash text primary key,
 client_id text not null references public.smart_clients(client_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 patient_id bigint not null references public.patients(id) on delete cascade,
 scopes text[] not null,
 redirect_uri text not null,
 code_challenge text not null,
 expires_at timestamptz not null,
 used_at timestamptz
);
create table public.smart_access_tokens(
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 client_id text not null references public.smart_clients(client_id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 patient_id bigint not null references public.patients(id) on delete cascade,
 scopes text[] not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz
);
alter table public.smart_clients enable row level security;
alter table public.smart_authorization_codes enable row level security;
alter table public.smart_access_tokens enable row level security;
-- No direct table access; everything goes through the functions below.
revoke all on public.smart_clients,public.smart_authorization_codes,public.smart_access_tokens from anon,authenticated;

create or replace function private.sha256_hex(value text) returns text language sql immutable set search_path='' as $$ select encode(extensions.digest(value,'sha256'),'hex') $$;
revoke all on function private.sha256_hex(text) from public,anon,authenticated;

-- The signed-in user may authorize access to their own record or to a family member's
-- record they are allowed to view as a proxy (the same rule the patient portal uses).
create or replace function private.smart_user_may_view(target_user uuid,target_patient bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.patient_accounts pa where pa.user_id=target_user and pa.patient_id=target_patient)
  or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=target_user and px.target_patient_id=target_patient and px.active and px.can_view)
$$;
revoke all on function private.smart_user_may_view(uuid,bigint) from public,anon,authenticated;

create or replace function private.smart_supported_scopes(requested text[]) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct s order by s),'{}') from unnest(requested) s
 where s='launch/patient'
    or s ~ '^patient/(\*|Patient|Encounter|Observation|Condition|MedicationRequest|AllergyIntolerance|Immunization)\.(read|rs|r|s)$'
$$;
revoke all on function private.smart_supported_scopes(text[]) from public,anon,authenticated;

-- Root registers applications. The client secret (confidential apps) is shown once.
create or replace function public.register_smart_client(app_name text,app_redirect_uris text[],is_confidential boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare secret text; created text; u text;
begin
 if not private.is_aal2() or not private.is_platform_root() then raise exception 'Only Healthcarology Root can register SMART apps'; end if;
 foreach u in array app_redirect_uris loop
  if u !~ '^https://[^\s#]+$' and u !~ '^http://(localhost|127\.0\.0\.1)(:\d+)?(/[^\s#]*)?$' then raise exception 'Redirect URI % must use https (http is allowed only for localhost)',u; end if;
 end loop;
 if is_confidential then secret:='hcsec_'||encode(extensions.gen_random_bytes(32),'hex'); end if;
 insert into public.smart_clients(name,redirect_uris,confidential,secret_hash) values(btrim(app_name),app_redirect_uris,is_confidential,case when secret is not null then private.sha256_hex(secret) end) returning client_id into created;
 return jsonb_build_object('client_id',created,'client_secret',secret);
end $$;
revoke all on function public.register_smart_client(text,text[],boolean) from public,anon;
grant execute on function public.register_smart_client(text,text[],boolean) to authenticated;

create or replace function public.list_smart_clients() returns table(client_id text,name text,redirect_uris text[],confidential boolean,active boolean,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select c.client_id,c.name,c.redirect_uris,c.confidential,c.active,c.created_at from public.smart_clients c where private.is_aal2() and private.is_platform_root() order by c.created_at
$$;
create or replace function public.set_smart_client_active(target_client text,is_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_aal2() or not private.is_platform_root() then raise exception 'Only Healthcarology Root can manage SMART apps'; end if;
 update public.smart_clients set active=is_active where client_id=target_client;
 if not is_active then update public.smart_access_tokens set revoked_at=now() where client_id=target_client and revoked_at is null; end if;
end $$;
revoke all on function public.list_smart_clients(),public.set_smart_client_active(text,boolean) from public,anon;
grant execute on function public.list_smart_clients(),public.set_smart_client_active(text,boolean) to authenticated;

-- Used by the consent page before sign-in: confirms the app and redirect URI.
create or replace function public.smart_client_info(target_client text,requested_redirect text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when c.client_id is null then jsonb_build_object('error','Unknown or inactive application')
             when not (requested_redirect = any(c.redirect_uris)) then jsonb_build_object('error','The redirect URI is not registered for this application')
             else jsonb_build_object('name',c.name) end
 from (select 1) one left join public.smart_clients c on c.client_id=target_client and c.active
$$;
revoke all on function public.smart_client_info(text,text) from public;
grant execute on function public.smart_client_info(text,text) to anon,authenticated;

create or replace function public.smart_authorizable_patients() returns table(patient_id bigint,display_name text,relationship text) language sql stable security definer set search_path='' as $$
 select p.id,concat_ws(' ',p.first_name,p.last_name),'self' from public.patient_accounts pa join public.patients p on p.id=pa.patient_id where pa.user_id=(select auth.uid())
 union
 select p.id,concat_ws(' ',p.first_name,p.last_name),coalesce(px.relationship,'linked') from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id and px.active and px.can_view join public.patients p on p.id=px.target_patient_id where pa.user_id=(select auth.uid())
$$;
revoke all on function public.smart_authorizable_patients() from public,anon;
grant execute on function public.smart_authorizable_patients() to authenticated;

-- The user approves: returns a one-time code valid for 60 seconds.
create or replace function public.smart_approve(target_client text,requested_redirect text,requested_scopes text[],target_patient bigint,pkce_challenge text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.smart_clients%rowtype; granted text[]; code text;
begin
 if (select auth.uid()) is null then raise exception 'Sign in to authorize an application'; end if;
 select * into c from public.smart_clients where client_id=target_client and active;
 if c.client_id is null then raise exception 'Unknown or inactive application'; end if;
 if not (requested_redirect = any(c.redirect_uris)) then raise exception 'The redirect URI is not registered for this application'; end if;
 if coalesce(pkce_challenge,'') !~ '^[A-Za-z0-9_-]{43,128}$' then raise exception 'A PKCE S256 code_challenge is required'; end if;
 if not private.smart_user_may_view((select auth.uid()),target_patient) then raise exception 'You are not allowed to share this patient''s record'; end if;
 granted:=private.smart_supported_scopes(requested_scopes);
 if not exists(select 1 from unnest(granted) s where s like 'patient/%') then raise exception 'No supported patient/ scopes were requested'; end if;
 code:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.smart_authorization_codes(code_hash,client_id,user_id,patient_id,scopes,redirect_uri,code_challenge,expires_at)
 values(private.sha256_hex(code),c.client_id,(select auth.uid()),target_patient,granted,requested_redirect,pkce_challenge,now()+interval '60 seconds');
 return jsonb_build_object('code',code,'scopes',granted);
end $$;
revoke all on function public.smart_approve(text,text,text[],bigint,text) from public,anon;
grant execute on function public.smart_approve(text,text,text[],bigint,text) to authenticated;

-- Token endpoint (service role only). The Edge Function computes the S256 challenge
-- from the code_verifier; the code is single-use.
create or replace function public.smart_redeem_code(presented_code text,target_client text,presented_redirect text,verifier_challenge text,presented_secret text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.smart_authorization_codes%rowtype; c public.smart_clients%rowtype; token text; lifetime integer:=3600;
begin
 select * into a from public.smart_authorization_codes where code_hash=private.sha256_hex(coalesce(presented_code,'')) for update;
 if a.code_hash is null or a.used_at is not null or a.expires_at<now() then return jsonb_build_object('error','invalid_grant','error_description','The code is invalid, expired, or already used'); end if;
 update public.smart_authorization_codes set used_at=now() where code_hash=a.code_hash;
 select * into c from public.smart_clients where client_id=a.client_id and active;
 if c.client_id is null or a.client_id<>target_client then return jsonb_build_object('error','invalid_client'); end if;
 if c.confidential and (presented_secret is null or private.sha256_hex(presented_secret)<>c.secret_hash) then return jsonb_build_object('error','invalid_client','error_description','Client authentication failed'); end if;
 if a.redirect_uri<>presented_redirect then return jsonb_build_object('error','invalid_grant','error_description','redirect_uri does not match'); end if;
 if a.code_challenge<>verifier_challenge then return jsonb_build_object('error','invalid_grant','error_description','PKCE verification failed'); end if;
 if not private.smart_user_may_view(a.user_id,a.patient_id) then return jsonb_build_object('error','invalid_grant','error_description','Access to this patient has been withdrawn'); end if;
 token:='hcs_'||encode(extensions.gen_random_bytes(32),'hex');
 insert into public.smart_access_tokens(token_hash,client_id,user_id,patient_id,scopes,expires_at) values(private.sha256_hex(token),c.client_id,a.user_id,a.patient_id,a.scopes,now()+make_interval(secs=>lifetime));
 return jsonb_build_object('access_token',token,'token_type','Bearer','expires_in',lifetime,'scope',array_to_string(a.scopes,' '),'patient',a.patient_id::text);
end $$;
revoke all on function public.smart_redeem_code(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.smart_redeem_code(text,text,text,text,text) to service_role;

-- FHIR API (service role only): resolves a SMART token, re-checks the user's right to
-- the patient, and records the access in the audit log.
create or replace function public.smart_resolve_token(presented_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.smart_access_tokens%rowtype; client_name text;
begin
 select * into t from public.smart_access_tokens where token_hash=private.sha256_hex(coalesce(presented_token,''));
 if t.id is null or t.revoked_at is not null or t.expires_at<now() then return null; end if;
 if not private.smart_user_may_view(t.user_id,t.patient_id) or not exists(select 1 from public.smart_clients c where c.client_id=t.client_id and c.active) then return null; end if;
 select name into client_name from public.smart_clients where client_id=t.client_id;
 insert into public.audit_logs(patient_id,action_type,actor_user_id,actor_type,context,table_name,record_id,facility_id)
 select t.patient_id,'VIEW',t.user_id,'user',left('smart:'||client_name,100),'patients',t.patient_id::text,p.facility_id from public.patients p where p.id=t.patient_id;
 return jsonb_build_object('user_id',t.user_id,'patient_id',t.patient_id,'scopes',to_jsonb(t.scopes),'client',client_name);
end $$;
revoke all on function public.smart_resolve_token(text) from public,anon,authenticated;
grant execute on function public.smart_resolve_token(text) to service_role;

-- People can see and withdraw the apps they have authorized.
create or replace function public.my_smart_authorizations() returns table(id uuid,app text,patient_id bigint,scopes text[],created_at timestamptz,expires_at timestamptz,revoked_at timestamptz)
language sql stable security definer set search_path='' as $$
 select t.id,c.name,t.patient_id,t.scopes,t.created_at,t.expires_at,t.revoked_at from public.smart_access_tokens t join public.smart_clients c on c.client_id=t.client_id where t.user_id=(select auth.uid()) order by t.created_at desc
$$;
create or replace function public.revoke_my_smart_authorization(target_token uuid) returns void language sql security definer set search_path='' as $$
 update public.smart_access_tokens set revoked_at=now() where id=target_token and user_id=(select auth.uid()) and revoked_at is null
$$;
revoke all on function public.my_smart_authorizations(),public.revoke_my_smart_authorization(uuid) from public,anon;
grant execute on function public.my_smart_authorizations(),public.revoke_my_smart_authorization(uuid) to authenticated;
