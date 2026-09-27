-- Phase 3: links from imaging orders to studies in the facility's image archive (PACS)
-- over DICOMweb. Healthcarology stores no images; it stores an accession number on
-- each imaging order and, once found in the PACS, the StudyInstanceUID.
--
-- A facility configures its archive in integration_endpoints with
-- integration_type='dicomweb_qido', base_url = the QIDO-RS root, and optional
-- configuration keys:
--   viewer_url_template  e.g. https://viewer.example/viewer?StudyInstanceUIDs={StudyInstanceUID}
--   auth_env             name of an Edge Function secret holding a bearer token for the PACS

create sequence if not exists public.imaging_accession_seq;
alter table public.imaging_orders
 add column if not exists accession_number text,
 add column if not exists study_instance_uid text check(study_instance_uid is null or (study_instance_uid ~ '^[0-9]+(\.[0-9]+)*$' and length(study_instance_uid)<=64)),
 add column if not exists study_linked_at timestamptz,
 add column if not exists study_linked_by uuid references auth.users(id);
update public.imaging_orders set accession_number='HC'||lpad(nextval('public.imaging_accession_seq')::text,10,'0') where accession_number is null;
alter table public.imaging_orders alter column accession_number set default 'HC'||lpad(nextval('public.imaging_accession_seq')::text,10,'0');
alter table public.imaging_orders alter column accession_number set not null;
create unique index if not exists imaging_orders_accession_idx on public.imaging_orders(accession_number);

-- The Edge Function (service role) reads the archive settings for an order's facility.
create or replace function public.imaging_archive_config(target_imaging_order bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('base_url',e.base_url,'viewer_url_template',e.configuration->>'viewer_url_template','auth_env',e.configuration->>'auth_env')
 from public.imaging_orders io join public.orders o on o.id=io.order_id join public.patients p on p.id=o.patient_id
 join public.integration_endpoints e on e.facility_id=p.facility_id and e.integration_type='dicomweb_qido' and e.enabled
 where io.id=target_imaging_order limit 1
$$;
revoke all on function public.imaging_archive_config(bigint) from public,anon,authenticated;
grant execute on function public.imaging_archive_config(bigint) to service_role;

-- Viewer template for display in the app (no secrets).
create or replace function public.imaging_viewer_template(target_imaging_order bigint) returns text language sql stable security definer set search_path='' as $$
 select e.configuration->>'viewer_url_template'
 from public.imaging_orders io join public.orders o on o.id=io.order_id join public.patients p on p.id=o.patient_id
 join public.integration_endpoints e on e.facility_id=p.facility_id and e.integration_type='dicomweb_qido' and e.enabled
 where io.id=target_imaging_order and private.can_read_patient_record(p.id) limit 1
$$;
revoke all on function public.imaging_viewer_template(bigint) from public,anon;
grant execute on function public.imaging_viewer_template(bigint) to authenticated;

-- Links a study to an imaging order. The study's PatientID (0010,0020) must be the
-- patient's UNIN or this facility's MRN, so images are never attached to the wrong person.
create or replace function public.link_imaging_study(target_imaging_order bigint,study_uid text,study_patient_id text,study_accession text) returns void
language plpgsql security definer set search_path='' as $$
declare io public.imaging_orders%rowtype; pat public.patients%rowtype;
begin
 select * into io from public.imaging_orders where id=target_imaging_order for update;
 if io.id is null then raise exception 'Imaging order not found'; end if;
 select p.* into pat from public.orders o join public.patients p on p.id=o.patient_id where o.id=io.order_id;
 if not private.is_aal2() or not private.can_write_patient_record(pat.id,array['rad_tech','physician','resident','advanced_practice']) then raise exception 'Only imaging or clinical staff of this facility can link studies'; end if;
 if study_uid !~ '^[0-9]+(\.[0-9]+)*$' or length(study_uid)>64 then raise exception 'Not a valid DICOM Study Instance UID'; end if;
 if coalesce(study_accession,'')<>io.accession_number then raise exception 'The study''s accession number does not match this order'; end if;
 if not ((pat.snau is not null and study_patient_id=pat.snau)
         or exists(select 1 from public.facility_patient_mrns m where m.patient_id=pat.id and m.facility_id=pat.facility_id and m.mrn=study_patient_id)) then
  raise exception 'The study''s Patient ID does not match this patient''s UNIN or MRN';
 end if;
 update public.imaging_orders set study_instance_uid=study_uid,study_linked_at=now(),study_linked_by=(select auth.uid()) where id=io.id;
end $$;
revoke all on function public.link_imaging_study(bigint,text,text,text) from public,anon;
grant execute on function public.link_imaging_study(bigint,text,text,text) to authenticated;

-- The archive holds a bearer-token *name*, never the token itself.
alter table public.integration_endpoints drop constraint if exists integration_endpoints_no_inline_secret;
alter table public.integration_endpoints add constraint integration_endpoints_no_inline_secret check(not (configuration ?| array['password','token','secret','api_key'])) not valid;
