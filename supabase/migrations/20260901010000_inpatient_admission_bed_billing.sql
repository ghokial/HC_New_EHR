-- Patient_admission.docx: linked inpatient admission, bed lifecycle, and billing records.
create table public.inpatient_admissions(
  id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id),
  patient_id bigint not null references public.patients(id), encounter_id bigint not null unique references public.encounters(id) on delete cascade,
  admission_status text not null default 'pending' check(admission_status in ('pending','admitted','transferred','discharged','cancelled')),
  admission_source text not null, acuity_level text not null check(acuity_level in ('standard','telemetry','intensive_care')),
  isolation_requirement text, diagnosis_code text, diagnosis_display text, admitting_provider_id bigint references public.providers(id),
  admitted_at timestamptz not null, discharge_ordered_at timestamptz, discharged_at timestamptz,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.inpatient_beds(
  id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
  ward text not null, room text not null, bed_label text not null, bed_type text not null default 'standard',
  operational_status text not null default 'available' check(operational_status in ('available','reserved','occupied','needs_cleaning','cleaning','blocked','out_of_service')),
  isolation_capable boolean not null default false, negative_pressure boolean not null default false, telemetry boolean not null default false,
  equipment jsonb not null default '[]'::jsonb, active boolean not null default true, updated_at timestamptz not null default now(),
  unique(facility_id,ward,room,bed_label)
);

create table public.inpatient_bed_assignments(
  id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id), admission_id uuid not null references public.inpatient_admissions(id) on delete cascade,
  bed_id uuid not null references public.inpatient_beds(id), assignment_status text not null default 'active' check(assignment_status in ('reserved','active','released','cancelled')),
  assigned_at timestamptz not null default now(), occupied_at timestamptz, released_at timestamptz, assigned_by uuid not null references auth.users(id), release_reason text
);
create unique index one_active_patient_per_bed on public.inpatient_bed_assignments(bed_id) where released_at is null and assignment_status in ('reserved','active');
create unique index one_active_bed_per_admission on public.inpatient_bed_assignments(admission_id) where released_at is null and assignment_status in ('reserved','active');

create table public.inpatient_accounts(
  id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id), patient_id bigint not null references public.patients(id),
  admission_id uuid not null unique references public.inpatient_admissions(id) on delete cascade, account_number text not null unique,
  status text not null default 'active' check(status in ('active','on_hold','ready_to_claim','submitted','adjudicated','closed','cancelled')),
  insurance_enrollment_id uuid references public.patient_insurance_enrollments(id), currency char(3) not null default 'USD',
  service_period_start date not null, service_period_end date, created_at timestamptz not null default now(), closed_at timestamptz
);

create table public.inpatient_charge_items(
  id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id), account_id uuid not null references public.inpatient_accounts(id) on delete cascade,
  encounter_id bigint not null references public.encounters(id), status text not null default 'billable' check(status in ('planned','billable','billed','entered_in_error')),
  code_system text not null, code text not null, description text not null, occurred_at timestamptz not null default now(),
  quantity numeric(12,3) not null default 1 check(quantity>0), unit text not null default 'each', unit_price numeric(12,2) not null check(unit_price>=0),
  total_amount numeric(12,2) generated always as (round(quantity*unit_price,2)) stored, created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create table public.inpatient_claims(
  id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id), account_id uuid not null references public.inpatient_accounts(id) on delete cascade,
  claim_number text not null unique, status text not null default 'draft' check(status in ('draft','submitted','accepted','denied','partially_paid','paid','void')),
  submitted_amount numeric(12,2) not null default 0, benefit_amount numeric(12,2) not null default 0, patient_responsibility numeric(12,2) not null default 0,
  submitted_at timestamptz, adjudicated_at timestamptz, payer_reference text, created_at timestamptz not null default now()
);

create table public.inpatient_claim_adjudications(
  id uuid primary key default gen_random_uuid(), claim_id uuid not null references public.inpatient_claims(id) on delete cascade,
  charge_item_id uuid references public.inpatient_charge_items(id), outcome text not null check(outcome in ('approved','adjusted','denied')),
  carc_code text, rarc_code text, explanation text, eligible_amount numeric(12,2), paid_amount numeric(12,2), patient_amount numeric(12,2), created_at timestamptz not null default now()
);

do $$ declare t text; begin foreach t in array array['inpatient_admissions','inpatient_beds','inpatient_bed_assignments','inpatient_accounts','inpatient_charge_items','inpatient_claims','inpatient_claim_adjudications'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy inpatient_admissions_access on public.inpatient_admissions for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id))) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)));
create policy inpatient_beds_access on public.inpatient_beds for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id))) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)));
create policy inpatient_bed_assignments_access on public.inpatient_bed_assignments for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id))) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)));
create policy inpatient_accounts_access on public.inpatient_accounts for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)) and public.current_role_code() in ('root','billing','registration','physician','resident','nurse','advanced_practice','case_manager','him','sysadmin')) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)) and public.current_role_code() in ('root','billing','registration','physician','resident','nurse','advanced_practice','case_manager','him','sysadmin'));
create policy inpatient_charge_items_access on public.inpatient_charge_items for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)) and public.current_role_code() in ('root','billing','physician','resident','nurse','advanced_practice','case_manager','him','sysadmin')) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)) and public.current_role_code() in ('root','billing','physician','resident','nurse','advanced_practice','case_manager','him','sysadmin'));
create policy inpatient_claims_access on public.inpatient_claims for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)) and public.current_role_code() in ('root','billing','case_manager','him','sysadmin')) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)) and public.current_role_code() in ('root','billing','case_manager','him','sysadmin'));
create policy inpatient_claim_adjudications_access on public.inpatient_claim_adjudications for all to authenticated using(private.is_aal2() and public.current_role_code() in ('root','billing','case_manager','him','sysadmin') and exists(select 1 from public.inpatient_claims c where c.id=claim_id and (private.is_platform_root() or private.is_facility_member(c.facility_id)))) with check(private.is_aal2() and public.current_role_code() in ('root','billing','case_manager','him','sysadmin') and exists(select 1 from public.inpatient_claims c where c.id=claim_id and (private.is_platform_root() or private.is_facility_member(c.facility_id))));

do $$ declare t text; begin foreach t in array array['inpatient_admissions','inpatient_beds','inpatient_bed_assignments','inpatient_accounts','inpatient_charge_items','inpatient_claims','inpatient_claim_adjudications'] loop execute format('grant select,insert,update,delete on public.%I to authenticated',t); end loop; end $$;

create index inpatient_admissions_facility_status_idx on public.inpatient_admissions(facility_id,admission_status,admitted_at desc);
create index inpatient_beds_facility_status_idx on public.inpatient_beds(facility_id,operational_status,ward,room);
create index inpatient_accounts_facility_status_idx on public.inpatient_accounts(facility_id,status,service_period_start desc);
create index inpatient_charges_account_time_idx on public.inpatient_charge_items(account_id,occurred_at desc);

create or replace function public.admit_inpatient(
  target_facility uuid, target_patient bigint, target_service bigint, target_provider bigint,
  target_bed uuid, source_text text, acuity_text text, isolation_text text,
  diagnosis_code_text text, diagnosis_display_text text, admission_time timestamptz,
  coverage_id uuid default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare new_encounter bigint; new_admission uuid; new_account text;
begin
  if not (private.is_platform_root() or private.is_facility_member(target_facility)) then raise exception 'Not authorized for this facility'; end if;
  if not exists(select 1 from public.patients p where p.id=target_patient and p.facility_id=target_facility) then raise exception 'Patient is not registered at the selected facility'; end if;
  if not exists(select 1 from public.inpatient_beds b where b.id=target_bed and b.facility_id=target_facility and b.active and b.operational_status='available') then raise exception 'Selected bed is not available'; end if;
  insert into public.encounters(patient_id,encounter_type,service_id,start_at,attending_provider_id,status)
  values(target_patient,'Inpatient',target_service,admission_time,target_provider,'open') returning id into new_encounter;
  insert into public.inpatient_admissions(facility_id,patient_id,encounter_id,admission_status,admission_source,acuity_level,isolation_requirement,diagnosis_code,diagnosis_display,admitting_provider_id,admitted_at,created_by)
  values(target_facility,target_patient,new_encounter,'admitted',source_text,acuity_text,nullif(isolation_text,''),nullif(diagnosis_code_text,''),nullif(diagnosis_display_text,''),target_provider,admission_time,(select auth.uid())) returning id into new_admission;
  insert into public.inpatient_bed_assignments(facility_id,admission_id,bed_id,assignment_status,assigned_at,occupied_at,assigned_by)
  values(target_facility,new_admission,target_bed,'active',admission_time,admission_time,(select auth.uid()));
  update public.inpatient_beds set operational_status='occupied',updated_at=now() where id=target_bed;
  new_account='IP-'||to_char(admission_time,'YYYYMMDD')||'-'||upper(substr(replace(new_admission::text,'-',''),1,8));
  insert into public.inpatient_accounts(facility_id,patient_id,admission_id,account_number,insurance_enrollment_id,service_period_start)
  values(target_facility,target_patient,new_admission,new_account,coverage_id,admission_time::date);
  return new_admission;
end $$;
revoke all on function public.admit_inpatient(uuid,bigint,bigint,bigint,uuid,text,text,text,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.admit_inpatient(uuid,bigint,bigint,bigint,uuid,text,text,text,text,text,timestamptz,uuid) to authenticated;

create or replace function public.discharge_inpatient(target_admission uuid, discharge_time timestamptz default now()) returns void language plpgsql security invoker set search_path='' as $$
declare target_facility uuid; target_encounter bigint; target_bed uuid;
begin
  select facility_id,encounter_id into target_facility,target_encounter from public.inpatient_admissions where id=target_admission;
  if target_facility is null or not (private.is_platform_root() or private.is_facility_member(target_facility)) then raise exception 'Admission not found or not authorized'; end if;
  select bed_id into target_bed from public.inpatient_bed_assignments where admission_id=target_admission and released_at is null and assignment_status in ('reserved','active') limit 1;
  update public.inpatient_admissions set admission_status='discharged',discharge_ordered_at=coalesce(discharge_ordered_at,discharge_time),discharged_at=discharge_time,updated_at=now() where id=target_admission;
  update public.encounters set status='closed',end_at=discharge_time where id=target_encounter;
  update public.inpatient_bed_assignments set assignment_status='released',released_at=discharge_time,release_reason='discharge' where admission_id=target_admission and released_at is null;
  if target_bed is not null then update public.inpatient_beds set operational_status='needs_cleaning',updated_at=now() where id=target_bed; end if;
  update public.inpatient_accounts set status='ready_to_claim',service_period_end=discharge_time::date where admission_id=target_admission and status='active';
end $$;
revoke all on function public.discharge_inpatient(uuid,timestamptz) from public,anon;
grant execute on function public.discharge_inpatient(uuid,timestamptz) to authenticated;
