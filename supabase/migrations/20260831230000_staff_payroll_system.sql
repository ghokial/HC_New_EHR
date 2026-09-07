create table public.staff_payroll_profiles(
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_type text not null check(contract_type in ('Hourly staff','Salaried','Contractor')),
  currency char(3) not null check(currency=upper(currency)),
  pay_frequency text not null check(pay_frequency in ('Weekly','Biweekly','Semimonthly','Monthly')),
  base_hourly_rate numeric(12,2) check(base_hourly_rate>=0),
  annual_salary numeric(14,2) check(annual_salary>=0),
  contractor_rate numeric(12,2) check(contractor_rate>=0),
  overtime_method text check(overtime_method in ('40-hour','8-and-80','Not configured')),
  overtime_multiplier numeric(6,3) check(overtime_multiplier>=0),
  night_differential numeric(12,2) check(night_differential>=0),
  weekend_differential numeric(12,2) check(weekend_differential>=0),
  holiday_differential numeric(12,2) check(holiday_differential>=0),
  on_call_rate numeric(12,2) check(on_call_rate>=0),
  hazard_rate numeric(12,2) check(hazard_rate>=0),
  rvu_rate numeric(12,4) check(rvu_rate>=0),
  credential_blocking_enabled boolean not null default false,
  aca_tracking_enabled boolean not null default false,
  pbj_tracking_enabled boolean not null default false,
  mobile_self_service_enabled boolean not null default false,
  earned_wage_access_enabled boolean not null default false,
  effective_from date not null,
  effective_to date,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(facility_id,user_id),
  check(effective_to is null or effective_to>=effective_from)
);

create table public.payroll_time_entries(
  id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities(id) on delete cascade,
  staff_user_id uuid not null references auth.users(id) on delete cascade,source text not null check(source in ('Manual','Biometric clock','Mobile app','Shift schedule','Imported')),
  clock_in timestamptz not null,clock_out timestamptz,break_minutes integer not null default 0 check(break_minutes>=0),shift_category text check(shift_category in ('Day','Night','Weekend','Holiday','On call','Hazard')),
  status text not null default 'pending' check(status in ('pending','approved','rejected','processed')),external_reference text,approved_by uuid references auth.users(id),created_at timestamptz not null default now(),check(clock_out is null or clock_out>clock_in)
);

create table public.payroll_compensation_events(
  id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities(id) on delete cascade,staff_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check(event_type in ('RVU','Bonus','On call','Hazard','Shift differential','Correction')),service_date date not null,quantity numeric(14,4) not null check(quantity>=0),rate numeric(14,4) check(rate>=0),amount numeric(14,2),description text,status text not null default 'pending' check(status in ('pending','approved','processed','rejected')),approved_by uuid references auth.users(id),created_at timestamptz not null default now()
);

create table public.payroll_runs(
  id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities(id) on delete cascade,period_start date not null,period_end date not null,pay_date date not null,
  status text not null default 'draft' check(status in ('draft','calculating','review','approved','paid','void')),currency char(3) not null check(currency=upper(currency)),calculation_snapshot jsonb not null default '{}'::jsonb,created_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),created_at timestamptz not null default now(),check(period_end>=period_start)
);

create table public.payroll_statements(
  id uuid primary key default gen_random_uuid(),payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,facility_id uuid not null references public.facilities(id) on delete cascade,staff_user_id uuid not null references auth.users(id) on delete cascade,
  gross_pay numeric(14,2) not null default 0,deductions numeric(14,2) not null default 0,net_pay numeric(14,2) not null default 0,hours jsonb not null default '{}'::jsonb,earnings jsonb not null default '[]'::jsonb,deduction_details jsonb not null default '[]'::jsonb,credential_warnings jsonb not null default '[]'::jsonb,aca_data jsonb not null default '{}'::jsonb,pbj_data jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(payroll_run_id,staff_user_id)
);

create table public.payroll_integrations(
  id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities(id) on delete cascade,integration_type text not null check(integration_type in ('Biometric clock','Mobile time app','Payroll processor','Tax filing','ACA reporting','PBJ reporting','Earned wage access')),
  provider_name text,status text not null default 'unconfigured' check(status in ('unconfigured','configured','active','error','disabled')),configuration_reference text,last_sync_at timestamptz,last_error text,created_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),unique(facility_id,integration_type)
);

alter table public.staff_payroll_profiles enable row level security;
alter table public.payroll_time_entries enable row level security;
alter table public.payroll_compensation_events enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_statements enable row level security;
alter table public.payroll_integrations enable row level security;

create policy payroll_profiles_access on public.staff_payroll_profiles for select to authenticated using(user_id=(select auth.uid()) or private.is_facility_admin(facility_id));
create policy payroll_profiles_admin on public.staff_payroll_profiles for all to authenticated using(private.is_facility_admin(facility_id)) with check(private.is_facility_admin(facility_id));
create policy payroll_time_access on public.payroll_time_entries for select to authenticated using(staff_user_id=(select auth.uid()) or private.is_facility_admin(facility_id));
create policy payroll_time_self_insert on public.payroll_time_entries for insert to authenticated with check(staff_user_id=(select auth.uid()) and source in ('Manual','Mobile app'));
create policy payroll_time_admin on public.payroll_time_entries for all to authenticated using(private.is_facility_admin(facility_id)) with check(private.is_facility_admin(facility_id));
create policy payroll_events_access on public.payroll_compensation_events for select to authenticated using(staff_user_id=(select auth.uid()) or private.is_facility_admin(facility_id));
create policy payroll_events_admin on public.payroll_compensation_events for all to authenticated using(private.is_facility_admin(facility_id)) with check(private.is_facility_admin(facility_id));
create policy payroll_runs_admin on public.payroll_runs for all to authenticated using(private.is_facility_admin(facility_id)) with check(private.is_facility_admin(facility_id));
create policy payroll_statements_access on public.payroll_statements for select to authenticated using(staff_user_id=(select auth.uid()) or private.is_facility_admin(facility_id));
create policy payroll_statements_admin on public.payroll_statements for all to authenticated using(private.is_facility_admin(facility_id)) with check(private.is_facility_admin(facility_id));
create policy payroll_integrations_admin on public.payroll_integrations for all to authenticated using(private.is_facility_admin(facility_id)) with check(private.is_facility_admin(facility_id));

grant select on public.staff_payroll_profiles,public.payroll_time_entries,public.payroll_compensation_events,public.payroll_runs,public.payroll_statements to authenticated;
grant insert on public.payroll_time_entries to authenticated;
grant select,insert,update,delete on public.payroll_integrations to authenticated;
grant insert,update,delete on public.staff_payroll_profiles,public.payroll_time_entries,public.payroll_compensation_events,public.payroll_runs,public.payroll_statements to authenticated;
