-- Explicit triage routing and imaging modality grouping.
alter table public.clinical_order_catalog
  add column if not exists imaging_type text;

update public.clinical_order_catalog set imaging_type=case
  when code in ('CT','LDCT-LUNG','CT-COLON') then 'Computed tomography (CT)'
  when code='MRI' then 'Magnetic resonance imaging (MRI)'
  when code in ('XR','FLUORO','IVP','MYELO') then 'X-ray and fluoroscopy'
  when code in ('US','DOPPL','ECHO','ELAST') then 'Ultrasound'
  when code in ('MAMMO','TOMO') then 'Breast imaging'
  when code in ('PET','VQ') then 'Nuclear medicine'
  when code='DEXA' then 'Bone density'
  else imaging_type
end
where order_type='imaging';

create or replace function public.enqueue_patient_for_triage(
  target_patient bigint,
  target_department bigint default null,
  target_service bigint default null
) returns uuid
language plpgsql security invoker set search_path='' as $$
declare
  target_facility uuid;
  queue_id uuid;
begin
  select p.facility_id into target_facility
  from public.patients p where p.id=target_patient;
  if target_facility is null then raise exception 'Patient facility is required'; end if;
  if not (private.is_platform_root() or private.is_facility_member(target_facility)) then
    raise exception 'Not authorized for this facility';
  end if;

  select q.id into queue_id
  from public.care_queue_entries q
  where q.facility_id=target_facility and q.patient_id=target_patient
    and q.queue_stage in ('triage','consultation')
  order by q.started_at desc limit 1;

  if queue_id is not null then
    update public.care_queue_entries
    set queue_stage='triage',department_id=target_department,service_id=target_service,
        assigned_provider_id=null,ended_at=null
    where id=queue_id;
    return queue_id;
  end if;

  insert into public.care_queue_entries(
    facility_id,patient_id,queue_stage,arrival_number,reference_number,
    department_id,service_id,priority,created_by
  ) values (
    target_facility,target_patient,'triage',nextval('public.triage_arrival_seq'),
    'TRI-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
    target_department,target_service,'normal',auth.uid()
  ) returning id into queue_id;
  return queue_id;
end $$;

revoke all on function public.enqueue_patient_for_triage(bigint,bigint,bigint) from public,anon;
grant execute on function public.enqueue_patient_for_triage(bigint,bigint,bigint) to authenticated;

create index if not exists clinical_order_catalog_imaging_type_idx
  on public.clinical_order_catalog(imaging_type,name)
  where order_type='imaging' and active;
