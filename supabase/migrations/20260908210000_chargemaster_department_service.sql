alter table public.facility_chargemaster_items
  add column if not exists department_id bigint references public.departments(id),
  add column if not exists service_id bigint references public.services(id);

create index if not exists facility_chargemaster_scope_idx
  on public.facility_chargemaster_items(facility_id,department_id,service_id,active);

create or replace function public.validate_chargemaster_scope()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.department_id is not null and not exists(
    select 1 from public.facility_departments fd
    where fd.facility_id=new.facility_id and fd.department_id=new.department_id and fd.active
  ) then raise exception 'The department is not activated for this facility'; end if;
  if new.service_id is not null and not exists(
    select 1 from public.facility_services fs
    join public.services s on s.id=fs.service_id
    where fs.facility_id=new.facility_id and fs.service_id=new.service_id and fs.active
      and (new.department_id is null or s.department_id=new.department_id)
  ) then raise exception 'The service is not activated in the selected facility department'; end if;
  return new;
end $$;

drop trigger if exists validate_chargemaster_scope on public.facility_chargemaster_items;
create trigger validate_chargemaster_scope
before insert or update of facility_id,department_id,service_id
on public.facility_chargemaster_items
for each row execute function public.validate_chargemaster_scope();

revoke all on function public.validate_chargemaster_scope() from public,anon,authenticated;
