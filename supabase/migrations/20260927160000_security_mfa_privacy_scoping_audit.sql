-- Security review S5-S8 and a real audit log.

-- S6 (database part). An account that still has to replace its temporary
-- password is never treated as MFA-verified, so it cannot reach staff data even
-- if someone else knows the temporary password and enrolls their own factor.
create or replace function private.is_aal2() returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select auth.jwt()->>'aal'),'')='aal2'
  and coalesce((select auth.jwt()->'app_metadata'->>'must_change_password'),'false')<>'true'
$$;

-- S5. Clinical tables that staff could read without MFA. Patients keep AAL1
-- access to their own rows, as elsewhere in the portal.
drop policy if exists mfa_required on public.encounter_clinical_workflows;
create policy mfa_required on public.encounter_clinical_workflows as restrictive for all to authenticated using(private.is_aal2()) with check(private.is_aal2());
drop policy if exists mfa_required on public.clinical_service_referrals;
create policy mfa_required on public.clinical_service_referrals as restrictive for all to authenticated using(private.is_aal2()) with check(private.is_aal2());
drop policy if exists mfa_required on public.external_record_access_requests;
create policy mfa_required on public.external_record_access_requests as restrictive for all to authenticated
 using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=external_record_access_requests.patient_id))
 with check(private.is_aal2());
drop policy if exists mfa_required on public.patient_contact_methods;
create policy mfa_required on public.patient_contact_methods as restrictive for all to authenticated
 using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=patient_contact_methods.patient_id) or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=patient_contact_methods.patient_id and px.active and px.can_view))
 with check(private.is_aal2());
-- Patients book appointments without MFA, but no account is ever given the
-- 'patient' role, so the old check hid every slot from them.
drop policy if exists mfa_required on public.provider_availability_slots;
create policy mfa_required on public.provider_availability_slots as restrictive for all to authenticated
 using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid())))
 with check(private.is_aal2());

-- Audit log ------------------------------------------------------------------
-- Records outlive the rows they describe, so the log keeps plain identifiers
-- instead of foreign keys, and nobody (including Root) can edit or delete it.
alter table public.audit_logs drop constraint if exists audit_logs_patient_id_fkey;
alter table public.audit_logs drop constraint if exists audit_logs_actor_user_id_fkey;
alter table public.audit_logs
 add column if not exists table_name text,
 add column if not exists record_id text,
 add column if not exists facility_id uuid,
 add column if not exists details jsonb not null default '{}'::jsonb;
create index if not exists audit_logs_patient_idx on public.audit_logs(patient_id,occurred_at desc);
create index if not exists audit_logs_facility_idx on public.audit_logs(facility_id,occurred_at desc);

create or replace function private.audit_log_is_append_only() returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'The audit log is append-only'; end $$;
revoke all on function private.audit_log_is_append_only() from public,anon,authenticated;
drop trigger if exists audit_log_is_append_only on public.audit_logs;
create trigger audit_log_is_append_only before update or delete on public.audit_logs for each row execute function private.audit_log_is_append_only();
revoke insert,update,delete,truncate on public.audit_logs from anon,authenticated;

-- Stores who changed what and which fields changed; values are not copied.
create or replace function private.audit_row_change() returns trigger language plpgsql security definer set search_path='' as $$
declare rec jsonb; old_rec jsonb; pid bigint; fid uuid; changed text[]; extra jsonb:='{}'::jsonb;
begin
 rec:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 old_rec:=case when tg_op='UPDATE' then to_jsonb(old) else null end;
 pid:=case when tg_table_name='patients' then (rec->>'id')::bigint else nullif(rec->>'patient_id','')::bigint end;
 if pid is null then
  pid:=case tg_table_name
   when 'lab_orders' then (select o.patient_id from public.orders o where o.id=(rec->>'order_id')::bigint)
   when 'imaging_orders' then (select o.patient_id from public.orders o where o.id=(rec->>'order_id')::bigint)
   when 'procedure_orders' then (select o.patient_id from public.orders o where o.id=(rec->>'order_id')::bigint)
   when 'lab_results' then (select o.patient_id from public.lab_orders lo join public.orders o on o.id=lo.order_id where lo.id=(rec->>'lab_order_id')::bigint)
   when 'imaging_results' then (select o.patient_id from public.imaging_orders io join public.orders o on o.id=io.order_id where io.id=(rec->>'imaging_order_id')::bigint)
   when 'procedure_results' then (select o.patient_id from public.procedure_orders po join public.orders o on o.id=po.order_id where po.id=(rec->>'procedure_order_id')::bigint)
   when 'medication_administrations' then (select mo.patient_id from public.medication_orders mo where mo.id=(rec->>'medication_order_id')::bigint)
   else null end;
 end if;
 fid:=nullif(rec->>'facility_id','')::uuid;
 if fid is null and pid is not null then select p.facility_id into fid from public.patients p where p.id=pid; end if;
 if tg_op='UPDATE' then
  select array_agg(e.key order by e.key) into changed from jsonb_each(rec) e where e.value is distinct from old_rec->e.key;
  if changed is null then return null; end if;
  extra:=jsonb_build_object('changed_fields',to_jsonb(changed));
 end if;
 if tg_table_name in ('user_roles','facility_memberships') then extra:=extra||jsonb_build_object('user_id',rec->>'user_id','role_id',rec->>'role_id'); end if;
 insert into public.audit_logs(patient_id,action_type,actor_user_id,actor_type,context,table_name,record_id,facility_id,details)
 values(pid,tg_op,(select auth.uid()),case when (select auth.uid()) is null then 'system' else 'user' end,'database',tg_table_name,coalesce(rec->>'id',rec->>'encounter_id',rec->>'user_id'),fid,extra);
 return null;
end $$;
revoke all on function private.audit_row_change() from public,anon,authenticated;

do $$ declare t text; begin
 foreach t in array array['patients','patient_contact_methods','patient_insurance_enrollments','patient_record_shares','encounters','encounter_clinical_workflows','clinical_notes','diagnoses',
  'orders','lab_orders','imaging_orders','procedure_orders','lab_results','imaging_results','procedure_results','medication_orders','medication_administrations',
  'patient_allergies','immunizations','vital_sign_observations','prenatal_episodes','surgical_cases','dialysis_sessions','user_roles','facility_memberships'] loop
  execute format('drop trigger if exists audit_row_change on public.%I',t);
  execute format('create trigger audit_row_change after insert or update or delete on public.%I for each row execute function private.audit_row_change()',t);
 end loop;
end $$;

-- Chart views are logged by the application through this function.
create or replace function public.log_patient_record_view(target_patient bigint,view_context text default 'chart') returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not private.can_read_patient_record(target_patient) then raise exception 'Access to this patient record is not authorized'; end if;
 insert into public.audit_logs(patient_id,action_type,actor_user_id,actor_type,context,table_name,record_id,facility_id)
 select target_patient,'VIEW',(select auth.uid()),'user',left(coalesce(nullif(btrim(view_context),''),'chart'),100),'patients',target_patient::text,p.facility_id from public.patients p where p.id=target_patient;
end $$;
revoke all on function public.log_patient_record_view(bigint,text) from public,anon;
grant execute on function public.log_patient_record_view(bigint,text) to authenticated;

-- Who may read the log: Root, or HIM / compliance / system administrators and owners of the facility concerned.
drop policy if exists audit_oversight_read on public.audit_logs;
create policy audit_oversight_read on public.audit_logs for select to authenticated using(
 private.is_platform_root() or (facility_id is not null and private.has_facility_role(facility_id,array['him','compliance','sysadmin']))
);

-- S7. A person's own account file stays private to them. It is no longer
-- attached to the facility where they work.
create or replace function private.ensure_account_patient_file(target_user_id uuid,target_email text,target_phone text,target_display_name text) returns bigint
language plpgsql security definer set search_path='' as $$
declare existing_patient_id bigint; created_patient_id bigint; account_name text; first_part text; last_part text;
begin
 select pa.patient_id into existing_patient_id from public.patient_accounts pa where pa.user_id=target_user_id order by pa.id limit 1;
 if existing_patient_id is not null then return existing_patient_id; end if;
 account_name:=btrim(coalesce(nullif(target_display_name,''),nullif(split_part(target_email,'@',1),''),nullif(target_phone,''),target_user_id::text));
 first_part:=split_part(account_name,' ',1);
 last_part:=nullif(btrim(substr(account_name,length(first_part)+1)),'');
 if last_part is null then last_part:=first_part; end if;
 insert into public.patients(first_name,last_name,life_status,registration_source,facility_id)
 values(first_part,last_part,'active','account_bootstrap',null) returning id into created_patient_id;
 insert into public.patient_accounts(user_id,patient_id) values(target_user_id,created_patient_id);
 return created_patient_id;
end $$;
revoke all on function private.ensure_account_patient_file(uuid,text,text,text) from public,anon,authenticated;
drop trigger if exists attach_account_patient_to_first_facility on public.facility_memberships;
drop function if exists private.attach_account_patient_to_first_facility();

-- Detach existing account files that the facility never used clinically, and
-- close the triage-queue entries that were created for them automatically.
with detach as (
 select p.id from public.patients p
 where p.registration_source='account_bootstrap' and p.facility_id is not null
  and not exists(select 1 from public.encounters x where x.patient_id=p.id)
  and not exists(select 1 from public.orders x where x.patient_id=p.id)
  and not exists(select 1 from public.medication_orders x where x.patient_id=p.id)
  and not exists(select 1 from public.clinical_notes x where x.patient_id=p.id)
  and not exists(select 1 from public.diagnoses x where x.patient_id=p.id)
  and not exists(select 1 from public.vital_sign_observations x where x.patient_id=p.id)
  and not exists(select 1 from public.facility_patient_mrns x where x.patient_id=p.id)
), closed_queue as (
 update public.care_queue_entries set queue_stage='cancelled',ended_at=now()
 where patient_id in (select id from detach) and queue_stage in ('reception','triage') and encounter_id is null
 returning id
)
update public.patients set facility_id=null where id in (select id from detach);

-- S8. Facility administrators no longer hold platform-wide powers.
create or replace function private.shares_facility_with(target_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.facility_memberships me join public.facility_memberships them on them.facility_id=me.facility_id
  where me.user_id=(select auth.uid()) and me.active and them.user_id=target_user and them.active)
$$;
revoke all on function private.shares_facility_with(uuid) from public,anon;
grant execute on function private.shares_facility_with(uuid) to authenticated;

-- Profiles: yourself, colleagues at a facility you work at, or Root. Only Root edits.
drop policy if exists profiles_self_read on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated using(user_id=(select auth.uid()) or private.is_platform_root() or private.shares_facility_with(user_id));
create policy profiles_admin_update on public.profiles for update to authenticated using(private.is_platform_root()) with check(private.is_platform_root());

-- The department, service, and country catalogs are shared by every facility: Root only.
drop policy if exists departments_admin_write on public.departments;
create policy departments_admin_write on public.departments for all to authenticated using(private.is_platform_root()) with check(private.is_platform_root());
drop policy if exists services_admin_write on public.services;
create policy services_admin_write on public.services for all to authenticated using(private.is_platform_root()) with check(private.is_platform_root());
drop policy if exists countries_admin_write on public.countries;
create policy countries_admin_write on public.countries for all to authenticated using(private.is_platform_root()) with check(private.is_platform_root());

-- Addresses: readable through a patient you may read, or by the person who just
-- created it (registration inserts the address before the patient row).
alter table public.addresses add column if not exists created_by uuid default auth.uid();
drop policy if exists addresses_staff_read on public.addresses;
drop policy if exists addresses_staff_insert on public.addresses;
drop policy if exists addresses_staff_update on public.addresses;
create policy addresses_staff_read on public.addresses for select to authenticated using(
 private.is_platform_root() or created_by=(select auth.uid())
 or exists(select 1 from public.patients p where (p.primary_address_id=addresses.id or p.mailing_address_id=addresses.id) and private.can_read_patient_record(p.id))
);
create policy addresses_staff_insert on public.addresses for insert to authenticated with check(
 private.is_aal2() and created_by=(select auth.uid())
 and (private.is_platform_root() or exists(select 1 from public.facility_memberships fm join public.roles r on r.id=fm.role_id where fm.user_id=(select auth.uid()) and fm.active and (fm.is_owner or r.role_code in ('registration','physician','resident','advanced_practice','nurse','him','sysadmin'))))
);
create policy addresses_staff_update on public.addresses for update to authenticated using(
 private.is_platform_root()
 or exists(select 1 from public.patients p where (p.primary_address_id=addresses.id or p.mailing_address_id=addresses.id) and private.can_write_patient_record(p.id,array['registration','physician','resident','advanced_practice','nurse','him','sysadmin']))
) with check(private.is_aal2());
