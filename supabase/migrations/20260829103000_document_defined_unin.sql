-- UNIN structure implemented from "Healthcarology UNIN Registry.docx".
-- Full registry value is stored internally. patients.snau is the display value
-- and deliberately omits the country prefix (for example 10L-M972-00003).

create sequence if not exists public.unin_unique_seq as bigint start with 1 increment by 1;

create table if not exists public.unin_country_rules (
  country_id bigint primary key references public.countries(id) on delete cascade,
  country_prefix text not null check(country_prefix ~ '^[0-9]{1,4}$'),
  active boolean not null default true,
  approved_by text,
  approved_at timestamptz
);

insert into public.unin_country_rules(country_id,country_prefix,active,approved_by)
select id,'243',true,'Healthcarology UNIN Registry document'
from public.countries where iso2='CD'
on conflict(country_id) do update set country_prefix=excluded.country_prefix,active=true,approved_by=excluded.approved_by;

alter table public.patients
  add column if not exists unin_full text unique,
  add column if not exists unin_province_code text,
  add column if not exists unin_commune_code text,
  add column if not exists unin_category_code text,
  add column if not exists unin_dependent_code smallint,
  add column if not exists unin_status text not null default 'pending_registry_data';

alter table public.patients alter column snau drop not null;
alter table public.patients drop constraint if exists patients_unin_province_code_check;
alter table public.patients add constraint patients_unin_province_code_check check(unin_province_code is null or unin_province_code ~ '^[0-9]{2}$');
alter table public.patients drop constraint if exists patients_unin_commune_code_check;
alter table public.patients add constraint patients_unin_commune_code_check check(unin_commune_code is null or unin_commune_code ~ '^[A-Z]$');
alter table public.patients drop constraint if exists patients_unin_dependent_code_check;
alter table public.patients add constraint patients_unin_dependent_code_check check(unin_dependent_code is null or unin_dependent_code in (1,2));

drop trigger if exists assign_patient_unin on public.patients;
drop trigger if exists prevent_patient_unin_change on public.patients;

create or replace function private.assign_healthcarology_unin() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  prefix text;
  category_base text;
  category_segment text;
  sequence_segment text;
begin
  if tg_op='UPDATE' and old.snau is not null then
    if new.snau is distinct from old.snau or new.unin_full is distinct from old.unin_full then
      raise exception 'UNIN is permanent and cannot be changed';
    end if;
    return new;
  end if;

  new.unin_province_code=upper(btrim(new.unin_province_code));
  new.unin_commune_code=upper(btrim(new.unin_commune_code));

  if new.birth_country_id is null or new.unin_province_code is null or new.unin_commune_code is null
     or new.sex not in ('M','F') or new.date_of_birth is null then
    new.snau=null; new.unin_full=null; new.unin_status='pending_registry_data';
    return new;
  end if;

  select r.country_prefix into prefix from public.unin_country_rules r
  where r.country_id=new.birth_country_id and r.active;
  if prefix is null then
    new.snau=null; new.unin_full=null; new.unin_status='pending_country_rule';
    return new;
  end if;

  category_base=case
    when lower(coalesce(new.patient_type,'')) like '%military%' then 'M'
    when lower(coalesce(new.patient_type,'')) like '%police%' then 'P'
    when lower(coalesce(new.patient_type,'')) like '%public servant%'
      or lower(coalesce(new.patient_type,'')) like '%fonctionnaire%' then 'F'
    when upper(coalesce(new.unin_category_code,'')) in ('N','E') then upper(new.unin_category_code)
    else '0'
  end;

  if category_base in ('M','F','P') then
    new.unin_dependent_code=case when lower(coalesce(new.patient_type,'')) like '%dependent%' then 2 else 1 end;
    category_segment=category_base || new.unin_dependent_code::text;
  else
    new.unin_dependent_code=null;
    category_segment=category_base;
  end if;
  new.unin_category_code=category_base;
  sequence_segment=lpad(nextval('public.unin_unique_seq')::text,4,'0');
  new.snau=new.unin_province_code || new.unin_commune_code || '-' || new.sex || right(extract(year from new.date_of_birth)::int::text,3) || '-' || category_segment || sequence_segment;
  new.unin_full=prefix || '-' || new.snau;
  new.unin_status='assigned';
  return new;
end $$;

revoke all on function private.assign_healthcarology_unin() from public,anon,authenticated;
create trigger assign_patient_unin before insert or update of birth_country_id,unin_province_code,unin_commune_code,sex,date_of_birth,patient_type,unin_category_code on public.patients for each row execute function private.assign_healthcarology_unin();

-- Remove only the previously generated placeholder identifiers. They cannot be
-- converted to the documented format without verified registry demographics.
update public.patients
set snau=null,unin_full=null,unin_status='pending_registry_data'
where snau like 'HC-%';

create or replace function private.prevent_unin_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.snau is not null and (old.snau is distinct from new.snau or old.unin_full is distinct from new.unin_full) then
    raise exception 'UNIN is permanent and cannot be changed';
  end if;
  return new;
end $$;
revoke all on function private.prevent_unin_change() from public,anon,authenticated;
create trigger prevent_patient_unin_change before update of snau,unin_full on public.patients for each row execute function private.prevent_unin_change();

alter table public.unin_country_rules enable row level security;
drop policy if exists unin_country_rules_read on public.unin_country_rules;
create policy unin_country_rules_read on public.unin_country_rules for select to authenticated using(active);
grant select on public.unin_country_rules to authenticated;

create index if not exists patients_unin_full_idx on public.patients(unin_full) where unin_full is not null;
create index if not exists patients_unin_status_idx on public.patients(unin_status);
