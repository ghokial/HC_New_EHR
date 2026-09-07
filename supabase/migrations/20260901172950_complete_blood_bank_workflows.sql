-- Complete the verified operational gaps in Blood Bank Management Software.docx.
-- Illustrative people, credentials, endpoints, prices, thresholds and vendor data are not seeded.

alter table public.blood_mobile_drives
  add column if not exists supply_kits_used integer check(supply_kits_used is null or supply_kits_used>=0),
  add column if not exists blood_bags_used integer check(blood_bags_used is null or blood_bags_used>=0),
  add column if not exists units_collected integer check(units_collected is null or units_collected>=0),
  add column if not exists logistics_notes text;

alter table public.blood_donor_screenings
  add column if not exists check_in_status text not null default 'checked_in'
    check(check_in_status in ('scheduled','checked_in','screening','completed','cancelled')),
  add column if not exists checked_in_at timestamptz not null default now();

alter table public.blood_product_tests
  add column if not exists interface_source text,
  add column if not exists raw_result_payload jsonb not null default '{}'::jsonb;

create table public.blood_product_dispenses(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities(id) on delete cascade,
 patient_id bigint not null references public.patients(id),
 product_id uuid not null references public.blood_products(id),
 crossmatch_id uuid not null references public.blood_crossmatches(id),
 status text not null default 'allocated' check(status in ('allocated','handed_over','in_progress','completed','stopped','cancelled')),
 destination text not null,
 authorized_patient_identifier text not null,
 authorized_product_din text not null,
 allocated_at timestamptz not null default now(), allocated_by uuid not null references auth.users(id),
 handed_over_at timestamptz, handed_over_by uuid references auth.users(id),
 stopped_at timestamptz, stop_reason text,
 fhir_resource_id text
);

alter table public.blood_transfusions
  add column if not exists dispense_id uuid references public.blood_product_dispenses(id),
  add column if not exists scanned_patient_identifier text,
  add column if not exists scanned_product_din text,
  add column if not exists verification_status text not null default 'pending'
    check(verification_status in ('pending','verified','failed')),
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id);

create table public.blood_reaction_workups(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 reaction_id uuid not null unique references public.blood_transfusion_reactions(id) on delete cascade,
 request_code text not null default '90449-0', request_code_system text not null default 'LOINC',
 status text not null default 'ordered' check(status in ('ordered','specimens_pending','in_progress','preliminary','final','cancelled')),
 ordered_at timestamptz not null default now(), ordered_by uuid not null references auth.users(id), notes text, fhir_service_request_id text
);

alter table public.blood_reaction_specimens
  add column if not exists workup_id uuid references public.blood_reaction_workups(id),
  add column if not exists quantity numeric(10,3),
  add column if not exists quantity_unit text,
  add column if not exists fhir_specimen_id text;

create table public.blood_reaction_observations(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 workup_id uuid not null references public.blood_reaction_workups(id) on delete cascade,
 specimen_id uuid references public.blood_reaction_specimens(id),
 code_system text not null, test_code text not null, test_name text not null,
 result_text text, result_code_system text, result_code text,
 result_status text not null default 'preliminary' check(result_status in ('registered','preliminary','final','corrected','cancelled')),
 observed_at timestamptz, recorded_by uuid not null references auth.users(id), fhir_observation_id text
);

create table public.blood_reaction_reports(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 workup_id uuid not null unique references public.blood_reaction_workups(id) on delete cascade,
 report_status text not null default 'registered' check(report_status in ('registered','partial','preliminary','final','cancelled')),
 conclusion text, issued_at timestamptz, issued_by uuid references auth.users(id),
 medical_director_reviewed_at timestamptz, medical_director_id uuid references auth.users(id), fhir_diagnostic_report_id text
);

create table public.blood_safety_alerts(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 alert_type text not null check(alert_type in ('temperature_breach','identity_mismatch','reaction','other')),
 severity text not null default 'critical' check(severity in ('warning','critical')),
 storage_device_id uuid references public.blood_storage_devices(id), product_id uuid references public.blood_products(id),
 transfusion_id uuid references public.blood_transfusions(id), message text not null, source_payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), acknowledged_at timestamptz, acknowledged_by uuid references auth.users(id),
 resolved_at timestamptz, resolved_by uuid references auth.users(id), resolution_notes text
);

create table public.blood_billing_code_catalog(
 id bigint generated by default as identity primary key, facility_id uuid references public.facilities(id) on delete cascade,
 code_system text not null check(code_system in ('UB04_REVENUE','HCPCS','CPT')),
 code text not null, description text not null, billing_note text,
 active boolean not null default true, created_by uuid references auth.users(id), created_at timestamptz not null default now(),
 unique nulls not distinct(facility_id,code_system,code)
);

insert into public.blood_billing_code_catalog(code_system,code,description,billing_note) values
('UB04_REVENUE','0380','Blood & Blood Component - General','General blood or component line'),
('UB04_REVENUE','0381','Packed Red Blood Cells','Red blood cell allocation line'),
('UB04_REVENUE','0382','Whole Blood','Whole blood line'),
('UB04_REVENUE','0383','Blood Plasma','Plasma line'),
('UB04_REVENUE','0384','Blood Platelets','Platelet line'),
('UB04_REVENUE','0385','Blood Leukocytes','Leukocyte line'),
('UB04_REVENUE','0390','Blood Storage/Processing - General','Processing and logistics service'),
('UB04_REVENUE','0391','Administration Fee','Transfusion administration line'),
('HCPCS','P9010','Whole Blood, per unit','Product line'),
('HCPCS','P9016','Red Blood Cells, Leukocyte Reduced','Product line'),
('HCPCS','P9021','Red Blood Cells, Irradiated','Product line'),
('HCPCS','P9017','Fresh Frozen Plasma, per unit','Product line'),
('HCPCS','P9019','Platelets, each unit','Product line'),
('HCPCS','P9035','Platelets, Pheresis, Leukocyte Reduced','Product line'),
('HCPCS','P9044','Cryoprecipitate, each unit','Product line'),
('HCPCS','P9011','Blood, Split Unit','Product line'),
('CPT','86900','ABO Blood Typing','Laboratory line'),
('CPT','86901','Rh (D) Blood Typing','Laboratory line'),
('CPT','86042','Blood Type; Antigen Screening','Laboratory line'),
('CPT','86850','Antibody Screen, RBC','Laboratory line'),
('CPT','86920','Compatibility Test; Immediate Spin','Cross-match line'),
('CPT','86921','Compatibility Test; Incubation','Cross-match line'),
('CPT','86922','Compatibility Test; Antiglobulin','Cross-match line'),
('CPT','86923','Compatibility Test; Electronic','Cross-match line'),
('CPT','86880','Direct Antiglobulin Test - General','Reaction workup line'),
('CPT','86886','Direct Antiglobulin Test - IgG Specific','Reaction workup line'),
('CPT','36430','Transfusion, blood or blood components','Administration line')
on conflict(facility_id,code_system,code) do update set description=excluded.description,billing_note=excluded.billing_note,active=true;

create table public.blood_charge_items(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 patient_id bigint not null references public.patients(id), transfusion_id uuid references public.blood_transfusions(id),
 product_id uuid references public.blood_products(id), crossmatch_id uuid references public.blood_crossmatches(id),
 workup_id uuid references public.blood_reaction_workups(id), billing_code_id bigint not null references public.blood_billing_code_catalog(id),
 service_date date not null default current_date, quantity numeric(12,3) not null check(quantity>0), unit text not null,
 unit_price numeric(12,2) check(unit_price is null or unit_price>=0), modifier text check(modifier in ('JW','JZ')),
 status text not null default 'draft' check(status in ('draft','billable','submitted','voided')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);

create table public.blood_waste_events(
 id uuid primary key default gen_random_uuid(), facility_id uuid not null references public.facilities(id) on delete cascade,
 product_id uuid not null references public.blood_products(id), transfusion_id uuid references public.blood_transfusions(id),
 quantity_prepared numeric(12,3) not null check(quantity_prepared>0),
 quantity_administered numeric(12,3) not null check(quantity_administered>=0),
 quantity_wasted numeric(12,3) not null check(quantity_wasted>=0), unit text not null,
 modifier text generated always as (case when quantity_wasted>0 then 'JW' else 'JZ' end) stored,
 unit_cost numeric(12,4) check(unit_cost is null or unit_cost>=0), waste_reason text,
 recorded_at timestamptz not null default now(), recorded_by uuid not null references auth.users(id),
 check(quantity_administered+quantity_wasted=quantity_prepared)
);

create or replace function public.allocate_blood_product(target_crossmatch uuid,target_destination text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare cm public.blood_crossmatches%rowtype; p public.blood_products%rowtype; patient_identifier text; result_id uuid;
begin
 select * into cm from public.blood_crossmatches where id=target_crossmatch for update;
 if cm.id is null or cm.compatibility_status<>'compatible' then raise exception 'A compatible cross-match is required'; end if;
 if not (private.is_platform_root() or private.is_facility_member(cm.facility_id)) then raise exception 'Not authorized for this facility'; end if;
 select * into p from public.blood_products where id=cm.product_id for update;
 if p.product_status<>'available' then raise exception 'Product is not available for allocation'; end if;
 select coalesce(m.mrn,pt.snau) into patient_identifier from public.patients pt
 left join public.facility_patient_mrns m on m.patient_id=pt.id and m.facility_id=cm.facility_id
 where pt.id=cm.patient_id limit 1;
 if patient_identifier is null then raise exception 'Patient requires an MRN or UNIN before allocation'; end if;
 insert into public.blood_product_dispenses(facility_id,patient_id,product_id,crossmatch_id,destination,authorized_patient_identifier,authorized_product_din,allocated_by)
 values(cm.facility_id,cm.patient_id,cm.product_id,cm.id,nullif(btrim(target_destination),''),patient_identifier,p.donation_identification_number,auth.uid()) returning id into result_id;
 update public.blood_products set product_status='allocated' where id=p.id;
 return result_id;
end $$;

create or replace function public.verify_and_start_blood_transfusion(target_dispense uuid,scanned_patient text,scanned_din text,initial_vitals jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.blood_product_dispenses%rowtype; result_id uuid;
begin
 select * into d from public.blood_product_dispenses where id=target_dispense for update;
 if d.id is null or d.status not in ('allocated','handed_over') then raise exception 'Active allocation not found'; end if;
 if not (private.is_platform_root() or private.is_facility_member(d.facility_id)) then raise exception 'Not authorized for this facility'; end if;
 if upper(btrim(scanned_patient))<>upper(btrim(d.authorized_patient_identifier)) or upper(btrim(scanned_din))<>upper(btrim(d.authorized_product_din)) then
  insert into public.blood_safety_alerts(facility_id,alert_type,severity,product_id,message,source_payload)
  values(d.facility_id,'identity_mismatch','critical',d.product_id,'Bedside patient or blood product identity mismatch',jsonb_build_object('dispense_id',d.id));
  return null;
 end if;
 insert into public.blood_transfusions(facility_id,patient_id,product_id,crossmatch_id,dispense_id,destination,status,bedside_verification,vital_signs,issued_at,started_at,performed_by,scanned_patient_identifier,scanned_product_din,verification_status,verified_at,verified_by)
 values(d.facility_id,d.patient_id,d.product_id,d.crossmatch_id,d.id,d.destination,'in_progress',jsonb_build_object('patient',true,'product',true),coalesce(initial_vitals,'[]'::jsonb),d.allocated_at,now(),auth.uid(),scanned_patient,scanned_din,'verified',now(),auth.uid()) returning id into result_id;
 update public.blood_product_dispenses set status='in_progress',handed_over_at=coalesce(handed_over_at,now()),handed_over_by=coalesce(handed_over_by,auth.uid()) where id=d.id;
 update public.blood_products set product_status='dispensed' where id=d.product_id;
 return result_id;
end $$;

create or replace function public.enforce_blood_reaction_lockout() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.blood_transfusions set status='stopped' where id=new.transfusion_id and status in ('issued','in_progress');
 update public.blood_product_dispenses set status='stopped',stopped_at=now(),stop_reason='Transfusion reaction reported' where id=(select dispense_id from public.blood_transfusions where id=new.transfusion_id);
 update public.blood_products set product_status='quarantined' where id=new.product_id;
 insert into public.blood_safety_alerts(facility_id,alert_type,severity,product_id,transfusion_id,message)
 values(new.facility_id,'reaction','critical',new.product_id,new.transfusion_id,'Transfusion stopped and product quarantined after reaction report');
 return new;
end $$;
drop trigger if exists blood_reaction_lockout on public.blood_transfusion_reactions;
create trigger blood_reaction_lockout after insert on public.blood_transfusion_reactions for each row execute function public.enforce_blood_reaction_lockout();

create or replace function public.lock_blood_storage_on_temperature_breach() returns trigger language plpgsql security invoker set search_path='' as $$
declare minimum numeric; maximum numeric;
begin
 select minimum_temperature_c,maximum_temperature_c into minimum,maximum from public.blood_storage_devices where id=new.storage_device_id and facility_id=new.facility_id;
 if new.temperature_c<minimum or new.temperature_c>maximum then
  update public.blood_storage_devices set locked=true,lock_reason='Temperature outside configured safety range',updated_at=now() where id=new.storage_device_id;
  update public.blood_products set product_status='quarantined' where storage_device_id=new.storage_device_id and product_status in ('available','allocated');
  insert into public.blood_safety_alerts(facility_id,alert_type,severity,storage_device_id,message,source_payload)
  values(new.facility_id,'temperature_breach','critical',new.storage_device_id,'Storage temperature outside the configured safety range',jsonb_build_object('observation_id',new.id,'temperature_c',new.temperature_c,'minimum_temperature_c',minimum,'maximum_temperature_c',maximum));
 end if;
 return new;
end $$;

create view public.blood_open_reaction_monitor with (security_invoker=true) as
select r.facility_id,r.id as reaction_id,r.patient_id,r.product_id,r.detected_at,r.reaction_code,r.reaction_description,r.workflow_status,
 count(s.id) as specimen_count,w.status as workup_status,rep.report_status,rep.medical_director_reviewed_at,
 case when count(s.id)=0 then 'specimens_pending'
      when rep.report_status='final' and rep.medical_director_reviewed_at is null then 'medical_director_review_pending'
      when rep.report_status in ('registered','partial','preliminary') then 'laboratory_workup_in_progress'
      else 'monitoring' end as operational_flag
from public.blood_transfusion_reactions r
left join public.blood_reaction_workups w on w.reaction_id=r.id
left join public.blood_reaction_specimens s on s.reaction_id=r.id
left join public.blood_reaction_reports rep on rep.workup_id=w.id
where r.workflow_status in ('in_progress','staged','under_review')
group by r.facility_id,r.id,w.status,rep.report_status,rep.medical_director_reviewed_at;

create view public.blood_waste_monthly_summary with (security_invoker=true) as
select facility_id,date_trunc('month',recorded_at)::date as month,
 count(*) as waste_event_count,sum(quantity_wasted) as quantity_wasted,
 sum(case when unit_cost is null then null else quantity_wasted*unit_cost end) as documented_loss
from public.blood_waste_events group by facility_id,date_trunc('month',recorded_at)::date;

do $$ declare t text; begin foreach t in array array[
 'blood_product_dispenses','blood_reaction_workups','blood_reaction_observations','blood_reaction_reports',
 'blood_safety_alerts','blood_charge_items','blood_waste_events'
] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 execute format('create policy %I on public.%I for all to authenticated using (private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id))) with check (private.is_aal2() and (private.is_platform_root() or private.is_facility_member(facility_id)))','access_'||t,t);
 end loop; end $$;

alter table public.blood_billing_code_catalog enable row level security;
revoke all on public.blood_billing_code_catalog from anon,authenticated;
grant select,insert,update,delete on public.blood_billing_code_catalog to authenticated;
create policy blood_billing_codes_read on public.blood_billing_code_catalog for select to authenticated
 using(private.is_aal2() and (facility_id is null or private.is_platform_root() or private.is_facility_member(facility_id)));
create policy blood_billing_codes_write on public.blood_billing_code_catalog for all to authenticated
 using(private.is_aal2() and facility_id is not null and (private.is_platform_root() or private.is_facility_admin(facility_id)))
 with check(private.is_aal2() and facility_id is not null and (private.is_platform_root() or private.is_facility_admin(facility_id)));

revoke all on public.blood_open_reaction_monitor,public.blood_waste_monthly_summary from anon,authenticated;
grant select on public.blood_open_reaction_monitor,public.blood_waste_monthly_summary to authenticated;
revoke all on function public.allocate_blood_product(uuid,text),public.verify_and_start_blood_transfusion(uuid,text,text,jsonb) from public,anon;
grant execute on function public.allocate_blood_product(uuid,text),public.verify_and_start_blood_transfusion(uuid,text,text,jsonb) to authenticated;
revoke all on function public.enforce_blood_reaction_lockout(),public.lock_blood_storage_on_temperature_breach() from public,anon,authenticated;
revoke all on function public.enforce_blood_reaction_lockout() from public,anon,authenticated;

grant usage,select on sequence public.blood_billing_code_catalog_id_seq to authenticated;
create index blood_dispenses_facility_status_idx on public.blood_product_dispenses(facility_id,status,allocated_at desc);
create unique index blood_one_active_dispense_per_product on public.blood_product_dispenses(product_id)
 where status in ('allocated','handed_over','in_progress');
create index blood_workups_facility_status_idx on public.blood_reaction_workups(facility_id,status,ordered_at desc);
create index blood_observations_workup_idx on public.blood_reaction_observations(workup_id,result_status);
create index blood_alerts_open_idx on public.blood_safety_alerts(facility_id,created_at desc) where resolved_at is null;
create index blood_charges_patient_date_idx on public.blood_charge_items(facility_id,patient_id,service_date desc);
create index blood_waste_facility_date_idx on public.blood_waste_events(facility_id,recorded_at desc);
