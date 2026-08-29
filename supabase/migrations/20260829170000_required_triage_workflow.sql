-- Required triage workflow before encounters, with an audited clinical bypass.
alter table public.facilities add column if not exists triage_mode text not null default 'common' check(triage_mode in ('common','department'));

alter table public.vital_sign_observations
 add column if not exists bmi numeric(5,2),
 add column if not exists blood_glucose numeric(8,2),
 add column if not exists blood_glucose_units text check(blood_glucose_units in ('mg/dL','mmol/L')),
 add column if not exists pain_score smallint check(pain_score between 0 and 10),
 add column if not exists head_circumference_cm numeric(6,2),
 add column if not exists mid_upper_arm_circumference_cm numeric(6,2),
 add column if not exists protocol_month text,
 add column if not exists consciousness_level text check(consciousness_level in ('alert','voice','pain','unresponsive')),
 add column if not exists pregnancy_status text check(pregnancy_status in ('unknown','not_pregnant','pregnant','postpartum')),
 add column if not exists chief_complaint text,
 add column if not exists allergy_alerts text,
 add column if not exists notes text;

alter table public.encounters
 add column if not exists triage_queue_entry_id uuid references public.care_queue_entries(id),
 add column if not exists triage_skipped boolean not null default false,
 add column if not exists triage_skip_reason text,
 add column if not exists triage_skipped_by uuid references auth.users(id),
 add column if not exists triage_skipped_at timestamptz,
 add constraint encounters_triage_skip_reason_check check(not triage_skipped or (triage_skipped_by is not null and nullif(btrim(triage_skip_reason),'') is not null));

create sequence if not exists public.triage_arrival_seq as bigint start 1;

create or replace function private.enqueue_new_patient_for_triage() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 if new.facility_id is null then return new; end if;
 select coalesce((select auth.uid()),f.owner_user_id) into actor from public.facilities f where f.id=new.facility_id;
 insert into public.care_queue_entries(facility_id,patient_id,queue_stage,arrival_number,reference_number,priority,created_by)
 values(new.facility_id,new.id,'triage',nextval('public.triage_arrival_seq'),'TRI-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),'normal',actor);
 return new;
end $$;
revoke all on function private.enqueue_new_patient_for_triage() from public,anon,authenticated;
drop trigger if exists enqueue_patient_for_triage on public.patients;
create trigger enqueue_patient_for_triage after insert on public.patients for each row execute function private.enqueue_new_patient_for_triage();

insert into public.care_queue_entries(facility_id,patient_id,queue_stage,arrival_number,reference_number,priority,created_by)
select p.facility_id,p.id,'triage',nextval('public.triage_arrival_seq'),'TRI-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),'normal',f.owner_user_id
from public.patients p join public.facilities f on f.id=p.facility_id
where not exists(select 1 from public.care_queue_entries q where q.patient_id=p.id and q.queue_stage in ('triage','consultation'))
  and not exists(select 1 from public.encounters e where e.patient_id=p.id and e.status='open');

create or replace function private.enforce_triage_before_encounter() returns trigger
language plpgsql security definer set search_path='' as $$
declare q public.care_queue_entries%rowtype; fid uuid;
begin
 select p.facility_id into fid from public.patients p where p.id=new.patient_id;
 select * into q from public.care_queue_entries c where c.patient_id=new.patient_id and c.facility_id=fid and c.queue_stage='consultation' order by c.started_at desc limit 1;
 if q.id is not null and exists(select 1 from public.vital_sign_observations v where v.patient_id=new.patient_id and v.facility_id=fid and v.recorded_at>=q.started_at) then
   new.triage_queue_entry_id=q.id;
   new.attending_provider_id=coalesce(q.assigned_provider_id,new.attending_provider_id);
   new.service_id=coalesce(q.service_id,new.service_id);
   return new;
 end if;
 if not new.triage_skipped then raise exception 'Patient must complete triage and vital signs before an encounter can start'; end if;
 if not (private.is_platform_root() or (fid is not null and private.has_facility_role(fid,array['physician','resident','advanced_practice','nurse','sysadmin']))) then raise exception 'This role cannot bypass triage vital signs'; end if;
 if new.triage_skipped_by is distinct from (select auth.uid()) then raise exception 'The signed-in user must confirm the triage bypass'; end if;
 new.triage_skipped_at=now();
 if q.id is not null then new.triage_queue_entry_id=q.id; end if;
 return new;
end $$;
revoke all on function private.enforce_triage_before_encounter() from public,anon,authenticated;
drop trigger if exists enforce_triage_before_encounter on public.encounters;
create trigger enforce_triage_before_encounter before insert on public.encounters for each row execute function private.enforce_triage_before_encounter();

create or replace function private.complete_triage_queue_after_encounter() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.triage_queue_entry_id is not null then update public.care_queue_entries set encounter_id=new.id,queue_stage='consultation' where id=new.triage_queue_entry_id; end if;
 return new;
end $$;
revoke all on function private.complete_triage_queue_after_encounter() from public,anon,authenticated;
drop trigger if exists link_encounter_to_triage on public.encounters;
create trigger link_encounter_to_triage after insert on public.encounters for each row execute function private.complete_triage_queue_after_encounter();

create index if not exists triage_queue_patient_stage_idx on public.care_queue_entries(patient_id,queue_stage,started_at desc);
create index if not exists vitals_facility_patient_time_idx on public.vital_sign_observations(facility_id,patient_id,recorded_at desc);
