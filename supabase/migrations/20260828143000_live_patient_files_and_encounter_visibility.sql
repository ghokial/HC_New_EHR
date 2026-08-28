-- Make every authenticated account a patient-portal-capable identity without
-- fabricating demographics that were not supplied by that account.

create or replace function private.ensure_account_patient_file(
  target_user_id uuid,
  target_email text,
  target_phone text,
  target_display_name text
) returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  existing_patient_id bigint;
  created_patient_id bigint;
  account_name text;
  first_part text;
  last_part text;
  primary_facility uuid;
begin
  select pa.patient_id into existing_patient_id
  from public.patient_accounts pa
  where pa.user_id=target_user_id
  order by pa.id
  limit 1;
  if existing_patient_id is not null then return existing_patient_id; end if;

  account_name:=btrim(coalesce(nullif(target_display_name,''),nullif(split_part(target_email,'@',1),''),nullif(target_phone,''),target_user_id::text));
  first_part:=split_part(account_name,' ',1);
  last_part:=nullif(btrim(substr(account_name,length(first_part)+1)),'');
  if last_part is null then last_part:=first_part; end if;
  select fm.facility_id into primary_facility from public.facility_memberships fm where fm.user_id=target_user_id and fm.active order by fm.created_at limit 1;

  insert into public.patients(first_name,last_name,life_status,registration_source,facility_id)
  values(first_part,last_part,'active','account_bootstrap',primary_facility)
  returning id into created_patient_id;
  insert into public.patient_accounts(user_id,patient_id) values(target_user_id,created_patient_id);
  return created_patient_id;
end $$;
revoke all on function private.ensure_account_patient_file(uuid,text,text,text) from public,anon,authenticated;

create or replace function private.bootstrap_healthcarology_account()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare profile_email text;
begin
  profile_email:=coalesce(new.email,new.phone||'@phone.healthcarology.invalid',new.id::text||'@account.healthcarology.invalid');
  insert into public.profiles(user_id,email,display_name)
  values(new.id,profile_email,coalesce(nullif(new.raw_user_meta_data->>'display_name',''),nullif(split_part(new.email,'@',1),''),new.phone,new.id::text))
  on conflict(user_id) do nothing;
  if lower(profile_email)=lower(coalesce((select setting_value from private.platform_settings where setting_key='root_email'),'')) then
    insert into public.user_roles(user_id,role_id,scope)
    select new.id,id,'global' from public.roles where role_code='root' on conflict do nothing;
  end if;
  perform private.ensure_account_patient_file(new.id,new.email,new.phone,new.raw_user_meta_data->>'display_name');
  return new;
end $$;
revoke all on function private.bootstrap_healthcarology_account() from public,anon,authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.bootstrap_healthcarology_account();
drop function if exists public.bootstrap_profile();

create or replace function private.attach_account_patient_to_first_facility()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.patients p set facility_id=new.facility_id
  where p.facility_id is null and p.registration_source='account_bootstrap'
    and exists(select 1 from public.patient_accounts pa where pa.patient_id=p.id and pa.user_id=new.user_id);
  return new;
end $$;
revoke all on function private.attach_account_patient_to_first_facility() from public,anon,authenticated;
drop trigger if exists attach_account_patient_to_first_facility on public.facility_memberships;
create trigger attach_account_patient_to_first_facility after insert on public.facility_memberships for each row execute function private.attach_account_patient_to_first_facility();

do $$
declare account record;
begin
  for account in select u.id,u.email,u.phone,u.raw_user_meta_data->>'display_name' as display_name from auth.users u loop
    perform private.ensure_account_patient_file(account.id,account.email,account.phone,account.display_name);
  end loop;
end $$;

create or replace function private.can_read_patient_record(target_patient_id bigint)
returns boolean language sql stable security invoker set search_path='' as $$
  select private.is_platform_root()
    or exists(select 1 from public.patients p where p.id=target_patient_id and p.facility_id is not null and private.has_facility_role(p.facility_id,array['registration','physician','resident','advanced_practice','nurse','pharmacist','therapist','lab_tech','lab_supervisor','rad_tech','billing','case_manager','him','compliance','clinical_informatics','sysadmin','executive']))
    or exists(select 1 from public.patient_accounts pa where pa.patient_id=target_patient_id and pa.user_id=(select auth.uid()))
    or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=target_patient_id and px.active and px.can_view)
$$;
revoke all on function private.can_read_patient_record(bigint) from public,anon;
grant execute on function private.can_read_patient_record(bigint) to authenticated;

drop policy if exists encounters_staff_read on public.encounters;
drop policy if exists encounters_portal_read on public.encounters;
drop policy if exists encounters_authorized_read on public.encounters;
create policy encounters_authorized_read on public.encounters for select to authenticated using(private.can_read_patient_record(patient_id));

drop policy if exists clinical_notes_staff_read on public.clinical_notes;
drop policy if exists clinical_notes_authorized_read on public.clinical_notes;
create policy clinical_notes_authorized_read on public.clinical_notes for select to authenticated using(private.can_read_patient_record(patient_id));

drop policy if exists contacts_access on public.patient_contact_methods;
drop policy if exists contacts_authorized_read on public.patient_contact_methods;
create policy contacts_authorized_read on public.patient_contact_methods for select to authenticated using(private.can_read_patient_record(patient_id));
drop policy if exists contacts_authorized_insert on public.patient_contact_methods;
create policy contacts_authorized_insert on public.patient_contact_methods for insert to authenticated with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['registration','physician','resident','advanced_practice','nurse','him']));
drop policy if exists contacts_authorized_update on public.patient_contact_methods;
create policy contacts_authorized_update on public.patient_contact_methods for update to authenticated using(private.is_aal2() and private.can_write_patient_record(patient_id,array['registration','physician','resident','advanced_practice','nurse','him'])) with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['registration','physician','resident','advanced_practice','nurse','him']));

create index if not exists encounters_patient_start_idx on public.encounters(patient_id,start_at desc);
create index if not exists clinical_notes_patient_created_idx on public.clinical_notes(patient_id,created_at desc);
create index if not exists patient_accounts_user_idx on public.patient_accounts(user_id,patient_id);
