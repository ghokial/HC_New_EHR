-- Blood Bank Management Software.docx: donor-to-transfusion operational records.
create table public.blood_donors(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 donor_identifier text not null, first_name text not null, last_name text not null, date_of_birth date not null,
 phone text, email text, active boolean not null default true, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(facility_id,donor_identifier)
);
create table public.blood_mobile_drives(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 name text not null, location_name text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 supply_kits_planned integer check(supply_kits_planned>=0), blood_bags_planned integer check(blood_bags_planned>=0),
 status text not null default 'planned' check(status in ('planned','active','completed','cancelled')), created_by uuid not null references auth.users(id), check(ends_at>starts_at)
);
create table public.blood_donor_screenings(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 donor_id uuid not null references public.blood_donors(id), mobile_drive_id uuid references public.blood_mobile_drives(id),
 screened_at timestamptz not null default now(), questionnaire jsonb not null default '{}'::jsonb,
 eligibility_status text not null check(eligibility_status in ('eligible','temporarily_deferred','permanently_deferred','pending')),
 deferral_reason text, deferral_until date, screened_by uuid not null references auth.users(id),
 check(eligibility_status='eligible' or eligibility_status='pending' or deferral_reason is not null)
);
create table public.blood_donations(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 donor_id uuid not null references public.blood_donors(id), screening_id uuid not null references public.blood_donor_screenings(id), mobile_drive_id uuid references public.blood_mobile_drives(id),
 donation_event_identifier text not null, donation_identification_number text not null, collected_at timestamptz not null,
 collection_status text not null default 'collected' check(collection_status in ('collected','processing','completed','discarded')),
 collected_by uuid not null references auth.users(id), unique(facility_id,donation_event_identifier), unique(facility_id,donation_identification_number)
);
create table public.blood_storage_devices(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 device_identifier text not null, description text not null, device_type text not null check(device_type in ('refrigerator','freezer','other')),
 minimum_temperature_c numeric(6,2) not null, maximum_temperature_c numeric(6,2) not null, locked boolean not null default false,
 lock_reason text, active boolean not null default true, updated_at timestamptz not null default now(), unique(facility_id,device_identifier), check(maximum_temperature_c>minimum_temperature_c)
);
create table public.blood_products(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 donation_id uuid not null references public.blood_donations(id), parent_product_id uuid references public.blood_products(id),
 donation_identification_number text not null, product_component_code text not null, division_code text not null default '00',
 component_type text not null check(component_type in ('Whole Blood','Packed Red Blood Cells','Fresh Frozen Plasma','Platelets','Cryoprecipitate','Other')),
 abo_group text check(abo_group in ('A','B','AB','O')), rh_type text check(rh_type in ('Positive','Negative')),
 processing_modifiers text[] not null default '{}', product_status text not null default 'processing' check(product_status in ('processing','available','allocated','dispensed','transfused','unavailable','quarantined','discarded','expired')),
 storage_device_id uuid references public.blood_storage_devices(id), expires_at timestamptz, fhir_resource_id text,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(facility_id,donation_identification_number,product_component_code,division_code)
);
create table public.blood_product_tests(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 product_id uuid not null references public.blood_products(id) on delete cascade,
 test_category text not null check(test_category in ('ABO_RH','ANTIBODY_SCREEN','INFECTIOUS_DISEASE','ANTIGEN','HLA','OTHER')),
 test_code text, test_name text not null, result_text text, result_status text not null default 'pending' check(result_status in ('pending','preliminary','final','corrected','cancelled')),
 abnormal_flag boolean not null default false, tested_at timestamptz, analyzer_identifier text, recorded_by uuid not null references auth.users(id)
);
create table public.blood_temperature_observations(
 id bigint generated by default as identity primary key, facility_id uuid not null references public.facilities(id) on delete cascade,
 storage_device_id uuid not null references public.blood_storage_devices(id) on delete cascade, observed_at timestamptz not null,
 temperature_c numeric(6,2) not null, sensor_identifier text, raw_payload jsonb not null default '{}'::jsonb, recorded_by uuid references auth.users(id)
);
create table public.blood_crossmatches(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 patient_id bigint not null references public.patients(id), product_id uuid not null references public.blood_products(id),
 method text not null check(method in ('electronic','serologic')), compatibility_status text not null check(compatibility_status in ('pending','compatible','incompatible','cancelled')),
 patient_sample_identifier text not null, performed_at timestamptz, performed_by uuid not null references auth.users(id), notes text
);
create table public.blood_transfusions(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 patient_id bigint not null references public.patients(id), product_id uuid not null references public.blood_products(id), crossmatch_id uuid not null references public.blood_crossmatches(id),
 destination text not null, status text not null default 'allocated' check(status in ('allocated','issued','in_progress','completed','stopped','cancelled')),
 bedside_verification jsonb not null default '{}'::jsonb, vital_signs jsonb not null default '[]'::jsonb,
 issued_at timestamptz, started_at timestamptz, completed_at timestamptz, performed_by uuid not null references auth.users(id)
);
create table public.blood_transfusion_reactions(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 transfusion_id uuid not null references public.blood_transfusions(id), patient_id bigint not null references public.patients(id), product_id uuid not null references public.blood_products(id),
 detected_at timestamptz not null, reaction_code text, reaction_description text not null,
 workflow_status text not null default 'in_progress' check(workflow_status in ('in_progress','staged','under_review','resolved','entered_in_error')),
 transfusion_stopped boolean not null default true, symptoms_and_vitals jsonb not null default '{}'::jsonb,
 medical_director_reviewed_at timestamptz, recorded_by uuid not null references auth.users(id)
);
create table public.blood_reaction_specimens(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 reaction_id uuid not null references public.blood_transfusion_reactions(id) on delete cascade, specimen_identifier text not null,
 specimen_type text not null, collected_at timestamptz, received_at timestamptz, body_site text, container_description text,
 laboratory_status text not null default 'pending_order' check(laboratory_status in ('pending_order','registered','partial','preliminary','final','cancelled')),
 notes text, recorded_by uuid not null references auth.users(id), unique(facility_id,specimen_identifier)
);

create or replace function public.lock_blood_storage_on_temperature_breach() returns trigger language plpgsql security invoker set search_path='' as $$
declare minimum numeric; maximum numeric;
begin
 select minimum_temperature_c,maximum_temperature_c into minimum,maximum from public.blood_storage_devices where id=new.storage_device_id and facility_id=new.facility_id;
 if new.temperature_c<minimum or new.temperature_c>maximum then
  update public.blood_storage_devices set locked=true,lock_reason='Temperature outside configured safety range',updated_at=now() where id=new.storage_device_id;
  update public.blood_products set product_status='quarantined' where storage_device_id=new.storage_device_id and product_status='available';
 end if;
 return new;
end $$;
create trigger blood_temperature_lock after insert on public.blood_temperature_observations for each row execute function public.lock_blood_storage_on_temperature_breach();

create or replace function public.split_blood_product(parent_product uuid, components jsonb) returns setof uuid language plpgsql security invoker set search_path='' as $$
declare parent public.blood_products%rowtype; item jsonb; new_id uuid;
begin
 select * into parent from public.blood_products where id=parent_product for update;
 if parent.id is null or not (private.is_platform_root() or private.is_facility_member(parent.facility_id)) then raise exception 'Product not found or not authorized'; end if;
 if parent.component_type<>'Whole Blood' or parent.product_status in ('transfused','discarded','expired') then raise exception 'Only an eligible whole blood product can be split'; end if;
 if jsonb_typeof(components)<>'array' or jsonb_array_length(components)=0 then raise exception 'Select at least one component'; end if;
 for item in select value from jsonb_array_elements(components) loop
  insert into public.blood_products(facility_id,donation_id,parent_product_id,donation_identification_number,product_component_code,division_code,component_type,product_status,storage_device_id,created_by)
  values(parent.facility_id,parent.donation_id,parent.id,parent.donation_identification_number,item->>'product_component_code',item->>'division_code',item->>'component_type','processing',parent.storage_device_id,(select auth.uid())) returning id into new_id;
  return next new_id;
 end loop;
 update public.blood_products set product_status='unavailable' where id=parent.id;
end $$;
revoke all on function public.split_blood_product(uuid,jsonb) from public,anon;
grant execute on function public.split_blood_product(uuid,jsonb) to authenticated;

do $$ declare t text; begin foreach t in array array['blood_donors','blood_mobile_drives','blood_donor_screenings','blood_donations','blood_storage_devices','blood_products','blood_product_tests','blood_temperature_observations','blood_crossmatches','blood_transfusions','blood_transfusion_reactions','blood_reaction_specimens'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon,authenticated',t); execute format('grant select,insert,update,delete on public.%I to authenticated',t); execute format('create policy %I on public.%I for all to authenticated using (private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id))) with check (private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)))','access_'||t,t); end loop; end $$;
grant usage,select on sequence public.blood_temperature_observations_id_seq to authenticated;
create index blood_screening_donor_idx on public.blood_donor_screenings(facility_id,donor_id,screened_at desc);
create index blood_products_inventory_idx on public.blood_products(facility_id,product_status,component_type,abo_group,rh_type,expires_at);
create index blood_temperature_device_idx on public.blood_temperature_observations(storage_device_id,observed_at desc);
create index blood_crossmatch_patient_idx on public.blood_crossmatches(facility_id,patient_id,performed_at desc);
create index blood_reactions_open_idx on public.blood_transfusion_reactions(facility_id,detected_at desc) where workflow_status<>'resolved';
