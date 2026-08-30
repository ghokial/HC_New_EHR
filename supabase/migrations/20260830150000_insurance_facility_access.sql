alter table public.facilities drop constraint if exists facilities_facility_type_check;
alter table public.facilities add constraint facilities_facility_type_check check(facility_type in ('Hospital','Health Center','Pharmacy','Laboratory (Labs)','Imaging Center','Research Center','Insurance','Health Department','Other'));
create table public.insurance_patient_access_grants(
 id uuid primary key default gen_random_uuid(),insurance_facility_id uuid not null references public.facilities(id) on delete cascade,patient_id bigint not null references public.patients(id) on delete cascade,granted_by uuid references auth.users(id),status text not null default 'pending' check(status in('pending','active','declined','revoked')),granted_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(insurance_facility_id,patient_id)
);
alter table public.insurance_patient_access_grants enable row level security;
create policy insurance_grants_access on public.insurance_patient_access_grants for select to authenticated using(private.is_facility_member(insurance_facility_id) or exists(select 1 from public.patient_accounts a where a.patient_id=insurance_patient_access_grants.patient_id and a.user_id=auth.uid()));
create policy insurance_grants_patient_update on public.insurance_patient_access_grants for update to authenticated using(exists(select 1 from public.patient_accounts a where a.patient_id=insurance_patient_access_grants.patient_id and a.user_id=auth.uid())) with check(exists(select 1 from public.patient_accounts a where a.patient_id=insurance_patient_access_grants.patient_id and a.user_id=auth.uid()));
grant select,update on public.insurance_patient_access_grants to authenticated;
create or replace function public.request_insurance_patient_access(target_last_name text,target_unin text,target_insurance_facility uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare pid bigint;gid uuid;
begin
 if not private.is_facility_member(target_insurance_facility) then raise exception 'Not authorized for this insurance facility'; end if;
 select id into pid from public.patients where lower(last_name)=lower(btrim(target_last_name)) and snau=btrim(target_unin) limit 1;
 if pid is null then raise exception 'Patient was not found'; end if;
 insert into public.insurance_patient_access_grants(insurance_facility_id,patient_id) values(target_insurance_facility,pid) on conflict(insurance_facility_id,patient_id) do update set status='pending',updated_at=now() returning id into gid;
 return gid;
end $$;
create or replace function public.respond_insurance_access(grant_id uuid,accept_access boolean) returns void language plpgsql security definer set search_path='' as $$
begin update public.insurance_patient_access_grants g set status=case when accept_access then 'active' else 'declined' end,granted_by=(select auth.uid()),granted_until=case when accept_access then now()+interval '1 year' else null end,updated_at=now() where g.id=grant_id and exists(select 1 from public.patient_accounts a where a.patient_id=g.patient_id and a.user_id=(select auth.uid())); if not found then raise exception 'Not authorized'; end if; end $$;
revoke all on function public.request_insurance_patient_access(text,text,uuid),public.respond_insurance_access(uuid,boolean) from public,anon;grant execute on function public.request_insurance_patient_access(text,text,uuid),public.respond_insurance_access(uuid,boolean) to authenticated;
