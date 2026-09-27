-- Phase 2: facility reporting and DHIS2 aggregate export.
-- Reports contain counts and averages only, never patient-level rows. DHIS2 export
-- sends only the metrics a facility has explicitly mapped to its own DHIS2 data
-- elements; no DHIS2 identifiers are assumed.

create or replace function private.can_view_facility_reports(fid uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_platform_root() or private.is_facility_admin(fid) or private.has_facility_role(fid,array['executive','him','compliance','sysadmin','case_manager'])
$$;
revoke all on function private.can_view_facility_reports(uuid) from public,anon;
grant execute on function private.can_view_facility_reports(uuid) to authenticated;

-- Aggregate metrics for one facility and period (inclusive dates, facility patients).
create or replace function private.facility_metrics(target_facility uuid,period_start date,period_end date) returns jsonb language sql stable security definer set search_path='' as $$
 with bounds as (select period_start::timestamptz as s,(period_end+1)::timestamptz as e),
 pts as (select id from public.patients where facility_id=target_facility)
 select jsonb_build_object(
  'period_start',period_start,'period_end',period_end,
  'new_patients',(select count(*) from public.patients p,bounds b where p.facility_id=target_facility and p.created_at>=b.s and p.created_at<b.e and coalesce(p.registration_source,'')<>'account_bootstrap'),
  'encounters_by_type',coalesce((select jsonb_object_agg(t,n) from (select e.encounter_type t,count(*) n from public.encounters e join pts on pts.id=e.patient_id,bounds b where e.start_at>=b.s and e.start_at<b.e group by 1) x),'{}'),
  'outpatient_encounters',(select count(*) from public.encounters e join pts on pts.id=e.patient_id,bounds b where e.start_at>=b.s and e.start_at<b.e and e.encounter_type<>'Inpatient'),
  'inpatient_admissions',(select count(*) from public.inpatient_admissions a,bounds b where a.facility_id=target_facility and a.admitted_at>=b.s and a.admitted_at<b.e),
  'discharges',(select count(*) from public.inpatient_admissions a,bounds b where a.facility_id=target_facility and a.discharged_at>=b.s and a.discharged_at<b.e),
  'average_length_of_stay_days',(select round(avg(extract(epoch from (a.discharged_at-a.admitted_at))/86400)::numeric,1) from public.inpatient_admissions a,bounds b where a.facility_id=target_facility and a.discharged_at>=b.s and a.discharged_at<b.e),
  'beds_active',(select count(*) from public.inpatient_beds where facility_id=target_facility and active),
  'beds_occupied_now',(select count(*) from public.inpatient_beds where facility_id=target_facility and active and operational_status='occupied'),
  'lab_results_validated',(select count(*) from public.lab_results r join public.lab_orders lo on lo.id=r.lab_order_id join public.orders o on o.id=lo.order_id join pts on pts.id=o.patient_id,bounds b where r.validation_status='validated' and r.validated_at>=b.s and r.validated_at<b.e),
  'lab_median_turnaround_hours',(select round((percentile_cont(0.5) within group (order by extract(epoch from (r.validated_at-o.created_at))/3600))::numeric,1) from public.lab_results r join public.lab_orders lo on lo.id=r.lab_order_id join public.orders o on o.id=lo.order_id join pts on pts.id=o.patient_id,bounds b where r.validation_status='validated' and r.validated_at>=b.s and r.validated_at<b.e),
  'appointments_by_status',coalesce((select jsonb_object_agg(st,n) from (select a.status st,count(*) n from public.appointments a join public.provider_availability_slots sl on sl.id=a.slot_id,bounds b where a.facility_id=target_facility and sl.starts_at>=b.s and sl.starts_at<b.e group by 1) x),'{}'),
  'appointments_completed',(select count(*) from public.appointments a join public.provider_availability_slots sl on sl.id=a.slot_id,bounds b where a.facility_id=target_facility and a.status='completed' and sl.starts_at>=b.s and sl.starts_at<b.e),
  'appointments_no_show',(select count(*) from public.appointments a join public.provider_availability_slots sl on sl.id=a.slot_id,bounds b where a.facility_id=target_facility and a.status='no_show' and sl.starts_at>=b.s and sl.starts_at<b.e),
  'top_diagnoses',coalesce((select jsonb_agg(jsonb_build_object('code',code,'display',display,'count',n) order by n desc) from (select d.code,d.display,count(*) n from public.diagnoses d join pts on pts.id=d.patient_id,bounds b where d.onset_at>=b.s and d.onset_at<b.e and d.clinical_status<>'entered_in_error' group by 1,2 order by 3 desc limit 10) x),'[]'),
  'emergency_accesses',(select count(*) from public.audit_logs l,bounds b where l.facility_id=target_facility and l.action_type='EMERGENCY_ACCESS' and l.occurred_at>=b.s and l.occurred_at<b.e)
 )
$$;
revoke all on function private.facility_metrics(uuid,date,date) from public,anon,authenticated;

create or replace function public.facility_report(target_facility uuid,period_start date,period_end date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_aal2() or not private.can_view_facility_reports(target_facility) then raise exception 'Only facility administrators, executives, HIM, compliance, or case management can view reports'; end if;
 if period_end<period_start or period_end-period_start>366 then raise exception 'Choose a period of at most one year'; end if;
 return private.facility_metrics(target_facility,period_start,period_end);
end $$;
revoke all on function public.facility_report(uuid,date,date) from public,anon;
grant execute on function public.facility_report(uuid,date,date) to authenticated;

-- Exports are recorded (existing table); allow the DHIS2 export type.
alter table public.data_export_audit drop constraint if exists data_export_audit_export_type_check;
alter table public.data_export_audit add constraint data_export_audit_export_type_check check(export_type in ('CSV','PDF','DHIS2'));

-- DHIS2 settings: the facility's organisation unit and data set, and which metrics feed
-- which data elements. DHIS2 UIDs are 11 characters, starting with a letter.
create table public.facility_dhis2_settings(
 facility_id uuid primary key references public.facilities(id) on delete cascade,
 org_unit_uid text not null check(org_unit_uid ~ '^[A-Za-z][A-Za-z0-9]{10}$'),
 data_set_uid text check(data_set_uid is null or data_set_uid ~ '^[A-Za-z][A-Za-z0-9]{10}$'),
 updated_by uuid default auth.uid() references auth.users(id),
 updated_at timestamptz not null default now()
);
create table public.dhis2_data_element_mappings(
 id bigint generated by default as identity primary key,
 facility_id uuid not null references public.facilities(id) on delete cascade,
 metric_code text not null check(metric_code in ('new_patients','outpatient_encounters','inpatient_admissions','discharges','lab_results_validated','appointments_completed','appointments_no_show','emergency_accesses')),
 data_element_uid text not null check(data_element_uid ~ '^[A-Za-z][A-Za-z0-9]{10}$'),
 category_option_combo_uid text check(category_option_combo_uid is null or category_option_combo_uid ~ '^[A-Za-z][A-Za-z0-9]{10}$'),
 unique(facility_id,metric_code)
);
alter table public.facility_dhis2_settings enable row level security;
alter table public.dhis2_data_element_mappings enable row level security;
create policy dhis2_settings_access on public.facility_dhis2_settings for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_admin(facility_id))) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_admin(facility_id)));
create policy dhis2_mappings_access on public.dhis2_data_element_mappings for all to authenticated using(private.is_aal2() and (private.is_platform_root() or private.is_facility_admin(facility_id))) with check(private.is_aal2() and (private.is_platform_root() or private.is_facility_admin(facility_id)));
grant select,insert,update,delete on public.facility_dhis2_settings,public.dhis2_data_element_mappings to authenticated;

-- Builds a DHIS2 dataValueSet (Web API /api/dataValueSets JSON) for a monthly period
-- 'YYYYMM', from mapped metrics only.
create or replace function public.dhis2_data_value_set(target_facility uuid,dhis2_period text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings public.facility_dhis2_settings%rowtype; metrics jsonb; first_day date;
begin
 if not private.is_aal2() or not (private.is_platform_root() or private.is_facility_admin(target_facility)) then raise exception 'Only facility administrators can export to DHIS2'; end if;
 if dhis2_period !~ '^[0-9]{4}(0[1-9]|1[0-2])$' then raise exception 'Period must be a month in DHIS2 format YYYYMM'; end if;
 select * into settings from public.facility_dhis2_settings where facility_id=target_facility;
 if settings.facility_id is null then raise exception 'Configure the DHIS2 organisation unit first'; end if;
 if not exists(select 1 from public.dhis2_data_element_mappings where facility_id=target_facility) then raise exception 'Map at least one metric to a DHIS2 data element first'; end if;
 first_day:=to_date(dhis2_period,'YYYYMM');
 metrics:=private.facility_metrics(target_facility,first_day,(first_day+interval '1 month'-interval '1 day')::date);
 return jsonb_strip_nulls(jsonb_build_object('dataSet',settings.data_set_uid,'period',dhis2_period,'orgUnit',settings.org_unit_uid,
  'dataValues',(select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('dataElement',m.data_element_uid,'categoryOptionCombo',m.category_option_combo_uid,'value',(metrics->>m.metric_code)))) from public.dhis2_data_element_mappings m where m.facility_id=target_facility)));
end $$;
revoke all on function public.dhis2_data_value_set(uuid,text) from public,anon;
grant execute on function public.dhis2_data_value_set(uuid,text) to authenticated;
