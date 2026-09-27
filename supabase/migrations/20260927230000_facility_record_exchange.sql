-- Phase 3: consent-based record exchange between facilities, keyed on the UNIN.
-- A clinician at facility B asks for a patient's record held at other facilities.
-- The patient (or a family member who may view their record) approves for a chosen
-- number of days, denies, or later revokes. B then reads a read-only summary of the
-- sections granted. In an emergency, a clinician can open access for 24 hours with a
-- written reason ("break-glass", per User_types_access_and_roles.docx: emergency
-- access triggers alerts); it is flagged in the audit log and shown to the patient.

create table public.facility_record_access_grants(
 id uuid primary key default gen_random_uuid(),
 patient_id bigint not null references public.patients(id) on delete cascade,
 requesting_facility_id uuid not null references public.facilities(id) on delete cascade,
 -- Copied so the patient sees who asked even though they cannot read that facility's row.
 requesting_facility_name text not null,
 purpose text not null check(nullif(btrim(purpose),'') is not null),
 sections text[] not null check(cardinality(sections)>0 and sections <@ array['encounters','diagnoses','medications','allergies','immunizations','labs','notes']),
 status text not null default 'requested' check(status in ('requested','approved','denied','revoked','emergency')),
 requested_by uuid not null references auth.users(id),
 requested_at timestamptz not null default now(),
 decided_by uuid references auth.users(id),
 decided_at timestamptz,
 expires_at timestamptz,
 emergency_reason text,
 check(status<>'emergency' or nullif(btrim(emergency_reason),'') is not null),
 check(status not in ('approved','emergency') or expires_at is not null)
);
create index facility_record_grants_patient_idx on public.facility_record_access_grants(patient_id,status);
create index facility_record_grants_facility_idx on public.facility_record_access_grants(requesting_facility_id,status,requested_at desc);
alter table public.facility_record_access_grants enable row level security;
revoke insert,update,delete on public.facility_record_access_grants from anon,authenticated;
grant select on public.facility_record_access_grants to authenticated;

create or replace function private.clinical_at(fid uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select private.has_facility_role(fid,array['physician','resident','advanced_practice','nurse','pharmacist'])
$$;
revoke all on function private.clinical_at(uuid) from public,anon;
grant execute on function private.clinical_at(uuid) to authenticated;

-- Requesting staff see their facility's requests; patients (and viewing proxies) see requests about them.
create policy record_grants_facility_read on public.facility_record_access_grants for select to authenticated using(private.is_aal2() and private.clinical_at(requesting_facility_id));
create policy record_grants_patient_read on public.facility_record_access_grants for select to authenticated using(private.smart_user_may_view((select auth.uid()),patient_id));
grant execute on function private.smart_user_may_view(uuid,bigint) to authenticated;

-- Finds the patient only when UNIN, last name, and date of birth all match, so the
-- request cannot be used to discover who is registered.
-- Parameters are referenced by position: a parameter named like a column would be
-- read as the column and match every patient.
create or replace function private.match_patient_for_exchange(target_unin text,target_last_name text,target_birth date) returns bigint language sql stable security definer set search_path='' as $$
 select p.id from public.patients p where p.snau=btrim($1) and lower(p.last_name)=lower(btrim($2)) and p.date_of_birth=$3 limit 1
$$;
revoke all on function private.match_patient_for_exchange(text,text,date) from public,anon,authenticated;

create or replace function public.request_facility_record_access(requesting_facility uuid,unin text,last_name text,birth date,request_purpose text,requested_sections text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid bigint; result uuid;
begin
 if not private.is_aal2() or not private.clinical_at(requesting_facility) then raise exception 'Only clinicians of the requesting facility can request records'; end if;
 pid:=private.match_patient_for_exchange(unin,last_name,birth);
 if pid is null then raise exception 'No patient matches this UNIN, last name, and date of birth'; end if;
 if exists(select 1 from public.patients where id=pid and facility_id=requesting_facility) then raise exception 'This patient is already registered at your facility'; end if;
 if exists(select 1 from public.facility_record_access_grants where patient_id=pid and requesting_facility_id=requesting_facility and status='requested') then raise exception 'A request is already waiting for the patient''s answer'; end if;
 insert into public.facility_record_access_grants(patient_id,requesting_facility_id,requesting_facility_name,purpose,sections,requested_by)
 values(pid,requesting_facility,(select name from public.facilities where id=requesting_facility),btrim(request_purpose),requested_sections,(select auth.uid())) returning id into result;
 return result;
end $$;
revoke all on function public.request_facility_record_access(uuid,text,text,date,text,text[]) from public,anon;
grant execute on function public.request_facility_record_access(uuid,text,text,date,text,text[]) to authenticated;

-- Patient decision: approve for 1-90 days, or deny. Revoke ends access at once.
create or replace function public.respond_facility_record_access(target_grant uuid,approve boolean,days integer default 7) returns void
language plpgsql security definer set search_path='' as $$
declare g public.facility_record_access_grants%rowtype;
begin
 select * into g from public.facility_record_access_grants where id=target_grant for update;
 if g.id is null or not private.smart_user_may_view((select auth.uid()),g.patient_id) then raise exception 'Request not found'; end if;
 if g.status<>'requested' then raise exception 'This request has already been answered'; end if;
 if approve and (days is null or days<1 or days>90) then raise exception 'Choose between 1 and 90 days'; end if;
 update public.facility_record_access_grants set status=case when approve then 'approved' else 'denied' end,decided_by=(select auth.uid()),decided_at=now(),
  expires_at=case when approve then now()+make_interval(days=>days) end where id=g.id;
end $$;
create or replace function public.revoke_facility_record_access(target_grant uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.facility_record_access_grants set status='revoked',decided_by=(select auth.uid()),decided_at=now(),expires_at=now()
 where id=target_grant and status in ('approved','emergency') and private.smart_user_may_view((select auth.uid()),patient_id);
 if not found then raise exception 'No active access to revoke'; end if;
end $$;
revoke all on function public.respond_facility_record_access(uuid,boolean,integer),public.revoke_facility_record_access(uuid) from public,anon;
grant execute on function public.respond_facility_record_access(uuid,boolean,integer),public.revoke_facility_record_access(uuid) to authenticated;

-- Break-glass: physicians, residents, or advanced practice clinicians only; 24 hours;
-- written reason; flagged as EMERGENCY_ACCESS in the audit log for compliance review.
create or replace function public.emergency_facility_record_access(requesting_facility uuid,unin text,last_name text,birth date,reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid bigint; result uuid;
begin
 if not private.is_aal2() or not private.has_facility_role(requesting_facility,array['physician','resident','advanced_practice']) then raise exception 'Only physicians, residents, or advanced practice clinicians can use emergency access'; end if;
 if nullif(btrim(coalesce(reason,'')),'') is null or length(btrim(reason))<10 then raise exception 'Describe the emergency (at least 10 characters)'; end if;
 pid:=private.match_patient_for_exchange(unin,last_name,birth);
 if pid is null then raise exception 'No patient matches this UNIN, last name, and date of birth'; end if;
 insert into public.facility_record_access_grants(patient_id,requesting_facility_id,requesting_facility_name,purpose,sections,status,requested_by,decided_by,decided_at,expires_at,emergency_reason)
 values(pid,requesting_facility,(select name from public.facilities where id=requesting_facility),'Emergency care',array['encounters','diagnoses','medications','allergies','immunizations','labs','notes'],'emergency',(select auth.uid()),(select auth.uid()),now(),now()+interval '24 hours',btrim(reason)) returning id into result;
 -- Logged for both the requesting facility and the patient's home facility, so compliance at each sees it.
 insert into public.audit_logs(patient_id,action_type,actor_user_id,actor_type,context,table_name,record_id,facility_id,details)
 select pid,'EMERGENCY_ACCESS',(select auth.uid()),'user','break-glass','facility_record_access_grants',result::text,f,jsonb_build_object('reason',btrim(reason),'requesting_facility',requesting_facility)
 from (select requesting_facility as f union select facility_id from public.patients where id=pid and facility_id is not null) facilities;
 return result;
end $$;
revoke all on function public.emergency_facility_record_access(uuid,text,text,date,text) from public,anon;
grant execute on function public.emergency_facility_record_access(uuid,text,text,date,text) to authenticated;

-- Reads the granted sections, read-only, and records the view. Only validated lab
-- results and signed notes are included, as in the patient portal and shared records.
create or replace function public.read_shared_facility_record(target_grant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g public.facility_record_access_grants%rowtype; result jsonb; s text[];
begin
 select * into g from public.facility_record_access_grants where id=target_grant;
 if g.id is null or not private.is_aal2() or not private.clinical_at(g.requesting_facility_id) then raise exception 'Access not found'; end if;
 if g.status not in ('approved','emergency') or g.expires_at<=now() then raise exception 'This access is not active'; end if;
 s:=g.sections;
 result:=jsonb_build_object('grant',jsonb_build_object('status',g.status,'expires_at',g.expires_at,'sections',to_jsonb(s),'purpose',g.purpose),
  'patient',(select jsonb_build_object('name',concat_ws(' ',p.first_name,p.middle_name,p.last_name),'unin',p.snau,'sex',p.sex,'date_of_birth',p.date_of_birth) from public.patients p where p.id=g.patient_id));
 if 'encounters'=any(s) then result:=result||jsonb_build_object('encounters',coalesce((select jsonb_agg(jsonb_build_object('type',e.encounter_type,'start',e.start_at,'end',e.end_at,'status',e.status,'facility',f.name) order by e.start_at desc) from public.encounters e join public.patients p on p.id=e.patient_id left join public.facilities f on f.id=p.facility_id where e.patient_id=g.patient_id),'[]')); end if;
 if 'diagnoses'=any(s) then result:=result||jsonb_build_object('diagnoses',coalesce((select jsonb_agg(jsonb_build_object('code',d.code,'display',d.display,'status',d.clinical_status,'onset',d.onset_at,'closed',d.closed_at) order by d.onset_at desc) from public.diagnoses d where d.patient_id=g.patient_id and d.clinical_status<>'entered_in_error'),'[]')); end if;
 if 'medications'=any(s) then result:=result||jsonb_build_object('medications',coalesce((select jsonb_agg(jsonb_build_object('medication',m.name,'strength',m.strength,'dose',mo.dose,'route',mo.route,'frequency',mo.frequency,'status',mo.status,'start',mo.start_at) order by mo.id desc) from public.medication_orders mo join public.medications m on m.id=mo.medication_id where mo.patient_id=g.patient_id),'[]')); end if;
 if 'allergies'=any(s) then result:=result||jsonb_build_object('allergies',coalesce((select jsonb_agg(jsonb_build_object('substance',a.substance,'reaction',a.reaction,'severity',a.severity,'verification',a.verification_status,'status',a.clinical_status)) from public.patient_allergies a where a.patient_id=g.patient_id and a.verification_status not in ('entered_in_error','refuted')),'[]')); end if;
 if 'immunizations'=any(s) then result:=result||jsonb_build_object('immunizations',coalesce((select jsonb_agg(jsonb_build_object('vaccine',i.vaccine_name,'dose',i.dose_number,'date',i.administered_at,'status',i.status) order by i.administered_at desc) from public.immunizations i where i.patient_id=g.patient_id and i.status<>'entered_in_error'),'[]')); end if;
 if 'labs'=any(s) then result:=result||jsonb_build_object('labs',coalesce((select jsonb_agg(jsonb_build_object('test',lr.analyte_code,'value',coalesce(lr.numeric_value::text,lr.value),'units',lr.units,'range',lr.reference_range,'interpretation',lr.interpretation,'date',lr.result_at) order by lr.result_at desc) from public.lab_results lr join public.lab_orders lo on lo.id=lr.lab_order_id join public.orders o on o.id=lo.order_id where o.patient_id=g.patient_id and lr.validation_status='validated'),'[]')); end if;
 if 'notes'=any(s) then result:=result||jsonb_build_object('notes',coalesce((select jsonb_agg(jsonb_build_object('type',n.note_type,'content',n.content,'signed',n.signed_at) order by n.signed_at desc) from public.clinical_notes n where n.patient_id=g.patient_id and n.status in ('signed','amended')),'[]')); end if;
 insert into public.audit_logs(patient_id,action_type,actor_user_id,actor_type,context,table_name,record_id,facility_id)
 select g.patient_id,'VIEW',(select auth.uid()),'user',case when g.status='emergency' then 'record-exchange:emergency' else 'record-exchange' end,'facility_record_access_grants',g.id::text,f
 from (select g.requesting_facility_id as f union select facility_id from public.patients where id=g.patient_id and facility_id is not null) facilities;
 return result;
end $$;
revoke all on function public.read_shared_facility_record(uuid) from public,anon;
grant execute on function public.read_shared_facility_record(uuid) to authenticated;

create trigger audit_row_change after insert or update or delete on public.facility_record_access_grants for each row execute function private.audit_row_change();
