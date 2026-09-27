create table public.facility_chargemaster_items(
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  revenue_code char(4) not null check(revenue_code ~ '^[0-9]{4}$'),
  charge_code text not null check(charge_code ~ '^[0-9]+$'),
  charge_description varchar(36) not null check(length(btrim(charge_description)) between 1 and 36),
  item_type text not null check(item_type in ('Procedure','Service','Medication','Supply','Equipment','Accommodation','Other')),
  unit_of_service text not null,
  unit_price numeric(14,2) not null check(unit_price>=0),
  currency char(3) not null check(currency=upper(currency) and currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(facility_id,charge_code)
);

create table public.facility_charge_lines(
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  chargemaster_item_id uuid not null references public.facility_chargemaster_items(id),
  patient_id bigint references public.patients(id),
  encounter_id bigint references public.encounters(id),
  source_reference text,
  service_date date not null,
  units_of_service numeric(12,3) not null check(units_of_service>0),
  billed_charge numeric(14,2) not null check(billed_charge>=0),
  expected_charge numeric(14,2) not null default 0,
  duplicate_charge boolean not null default false,
  inflated_price boolean not null default false,
  check_reasons text[] not null default '{}',
  review_status text not null default 'pending' check(review_status in ('pending','reviewed','approved','corrected','entered_in_error')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create or replace function public.check_facility_charge_line()
returns trigger language plpgsql security invoker set search_path='' as $$
declare item public.facility_chargemaster_items%rowtype; reasons text[]:='{}';
begin
  select * into item from public.facility_chargemaster_items where id=new.chargemaster_item_id and facility_id=new.facility_id and active=true;
  if item.id is null then raise exception 'An active chargemaster item from this facility is required'; end if;
  new.expected_charge=round(item.unit_price*new.units_of_service,2);
  new.inflated_price=new.billed_charge>new.expected_charge;
  new.duplicate_charge=exists(select 1 from public.facility_charge_lines x where x.facility_id=new.facility_id and x.chargemaster_item_id=new.chargemaster_item_id and x.patient_id is not distinct from new.patient_id and x.encounter_id is not distinct from new.encounter_id and x.service_date=new.service_date and x.units_of_service=new.units_of_service and x.billed_charge=new.billed_charge and x.review_status<>'entered_in_error' and x.id is distinct from new.id);
  if new.duplicate_charge then reasons=array_append(reasons,'Possible duplicate: same facility, item, patient, encounter, service date, units, and billed charge'); end if;
  if new.inflated_price then reasons=array_append(reasons,'Billed charge exceeds the active chargemaster unit price multiplied by units'); end if;
  new.check_reasons=reasons;
  return new;
end $$;

create or replace function public.inherit_chargemaster_currency()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  select currency into new.currency from public.facilities where id=new.facility_id;
  if new.currency is null then raise exception 'The facility currency is not configured'; end if;
  return new;
end $$;

create trigger chargemaster_currency before insert or update of facility_id,currency on public.facility_chargemaster_items for each row execute function public.inherit_chargemaster_currency();
create trigger charge_line_checks before insert or update of facility_id,chargemaster_item_id,patient_id,encounter_id,service_date,units_of_service,billed_charge,review_status on public.facility_charge_lines for each row execute function public.check_facility_charge_line();

alter table public.facility_chargemaster_items enable row level security;
alter table public.facility_charge_lines enable row level security;
create policy chargemaster_read on public.facility_chargemaster_items for select to authenticated using(private.is_platform_root() or private.is_facility_member(facility_id));
create policy chargemaster_write on public.facility_chargemaster_items for all to authenticated using(private.is_platform_root() or private.has_facility_role(facility_id,array['sysadmin','billing'])) with check(private.is_platform_root() or private.has_facility_role(facility_id,array['sysadmin','billing']));
create policy charge_lines_read on public.facility_charge_lines for select to authenticated using(private.is_platform_root() or private.is_facility_member(facility_id));
create policy charge_lines_write on public.facility_charge_lines for all to authenticated using(private.is_platform_root() or private.has_facility_role(facility_id,array['sysadmin','billing'])) with check(private.is_platform_root() or private.has_facility_role(facility_id,array['sysadmin','billing']));
grant select,insert,update,delete on public.facility_chargemaster_items,public.facility_charge_lines to authenticated;
revoke all on function public.check_facility_charge_line(),public.inherit_chargemaster_currency() from public,anon,authenticated;
create index chargemaster_facility_active_idx on public.facility_chargemaster_items(facility_id,active,charge_description);
create index charge_lines_duplicate_check_idx on public.facility_charge_lines(facility_id,chargemaster_item_id,patient_id,encounter_id,service_date);
create index charge_lines_review_idx on public.facility_charge_lines(facility_id,review_status,created_at desc);
