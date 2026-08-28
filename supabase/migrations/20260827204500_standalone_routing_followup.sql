-- Follow-up for automatic stand-alone initialization and pharmacy-on-file routing.

insert into public.pharmacy_locations(facility_id,name) select id,'Main Pharmacy' from public.facilities where facility_type='Pharmacy' on conflict do nothing;
insert into public.facility_operational_settings(facility_id) select id from public.facilities where facility_type in ('Pharmacy','Laboratory (Labs)','Imaging Center') on conflict do nothing;

create or replace function private.initialize_standalone_facility() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.facility_type in ('Pharmacy','Laboratory (Labs)','Imaging Center') then insert into public.facility_operational_settings(facility_id) values(new.id) on conflict do nothing;end if;
 if new.facility_type='Pharmacy' then insert into public.pharmacy_locations(facility_id,name) values(new.id,'Main Pharmacy') on conflict do nothing;end if;
 return new;
end $$;
drop trigger if exists initialize_standalone_facility on public.facilities;
create trigger initialize_standalone_facility after insert on public.facilities for each row execute function private.initialize_standalone_facility();

drop policy if exists orders_standalone_read on public.orders;
create policy orders_standalone_read on public.orders for select to authenticated using(
 exists(select 1 from public.patient_preferred_facilities pf where pf.patient_id=orders.patient_id and pf.active and ((pf.service_type='laboratory' and orders.order_type='lab' and private.is_standalone_member(pf.facility_id,'laboratory')) or (pf.service_type='imaging' and orders.order_type='imaging' and private.is_standalone_member(pf.facility_id,'imaging'))))
 or exists(select 1 from public.clinical_service_referrals r where r.order_id=orders.id and ((r.service_type='laboratory' and private.is_standalone_member(r.target_facility_id,'laboratory')) or (r.service_type='imaging' and private.is_standalone_member(r.target_facility_id,'imaging'))))
 or exists(select 1 from public.external_record_access_requests ar where ar.patient_id=orders.patient_id and ((ar.purpose='laboratory' and orders.order_type='lab') or (ar.purpose='imaging' and orders.order_type='imaging')) and ar.status='granted' and ar.granted_until>now() and private.is_standalone_member(ar.requesting_facility_id,ar.purpose))
);

create or replace function private.route_prescription_to_pharmacy_on_file() returns trigger language plpgsql security definer set search_path='' as $$
declare pharmacy_id uuid;
begin
 select facility_id into pharmacy_id from public.patient_preferred_facilities where patient_id=new.patient_id and service_type='pharmacy' and active;
 if pharmacy_id is not null then insert into public.prescription_fulfillments(facility_id,medication_order_id,status) values(pharmacy_id,new.id,'prescribed') on conflict(medication_order_id) do update set facility_id=excluded.facility_id,updated_at=now();end if;
 return new;
end $$;
drop trigger if exists medication_order_route_to_pharmacy on public.medication_orders;
create trigger medication_order_route_to_pharmacy after insert on public.medication_orders for each row execute function private.route_prescription_to_pharmacy_on_file();

create or replace function private.backfill_pharmacy_on_file() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.service_type='pharmacy' and new.active then insert into public.prescription_fulfillments(facility_id,medication_order_id,status) select new.facility_id,mo.id,'prescribed' from public.medication_orders mo where mo.patient_id=new.patient_id and mo.status='active' on conflict(medication_order_id) do update set facility_id=excluded.facility_id,updated_at=now();end if;
 return new;
end $$;
drop trigger if exists preferred_pharmacy_backfill on public.patient_preferred_facilities;
create trigger preferred_pharmacy_backfill after insert or update on public.patient_preferred_facilities for each row execute function private.backfill_pharmacy_on_file();

revoke all on function private.initialize_standalone_facility(),private.route_prescription_to_pharmacy_on_file(),private.backfill_pharmacy_on_file() from public,anon,authenticated;
