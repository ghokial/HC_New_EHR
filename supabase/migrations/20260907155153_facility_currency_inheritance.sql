alter table public.facilities
  add column if not exists currency char(3) not null default 'USD'
  check (currency = upper(currency) and currency ~ '^[A-Z]{3}$');

create or replace function public.inherit_staff_payroll_currency()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  select f.currency into new.currency from public.facilities f where f.id = new.facility_id;
  if new.currency is null then raise exception 'The facility currency is not configured'; end if;
  return new;
end;
$$;

drop trigger if exists staff_payroll_inherit_facility_currency on public.staff_payroll_profiles;
create trigger staff_payroll_inherit_facility_currency before insert or update of facility_id, currency
on public.staff_payroll_profiles for each row execute function public.inherit_staff_payroll_currency();

update public.staff_payroll_profiles p set currency = f.currency
from public.facilities f where f.id = p.facility_id and p.currency is distinct from f.currency;

revoke all on function public.inherit_staff_payroll_currency() from public, anon, authenticated;
