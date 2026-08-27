-- Tighten clinical access paths identified by the database security advisor.
alter table public.diagnoses add column diagnosing_provider_name text, add column closing_provider_name text;

create or replace function private.has_facility_role(fid uuid,allowed_roles text[]) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.facility_memberships fm join public.roles r on r.id=fm.role_id where fm.facility_id=fid and fm.user_id=(select auth.uid()) and fm.active and (fm.is_owner or r.role_code=any(allowed_roles)))
$$;

drop policy if exists lab_results_released_read on public.lab_results;
drop policy if exists lab_results_laboratory_insert on public.lab_results;
drop policy if exists lab_results_laboratory_update on public.lab_results;
create policy lab_results_released_read on public.lab_results for select to authenticated using(
 exists(select 1 from public.lab_orders lo join public.orders o on o.id=lo.order_id join public.patients p on p.id=o.patient_id
   where lo.id=lab_order_id and (
    (validation_status='validated' and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice','nurse','lab_tech','lab_supervisor'])) or exists(select 1 from public.patient_accounts pa where pa.patient_id=p.id and pa.user_id=(select auth.uid()))))
    or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['lab_tech','lab_supervisor']))
   ))
);
create policy lab_results_laboratory_insert on public.lab_results for insert to authenticated with check(
 exists(select 1 from public.lab_orders lo join public.orders o on o.id=lo.order_id join public.patients p on p.id=o.patient_id where lo.id=lab_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['lab_tech','lab_supervisor']))))
);
create policy lab_results_laboratory_update on public.lab_results for update to authenticated using(
 exists(select 1 from public.lab_orders lo join public.orders o on o.id=lo.order_id join public.patients p on p.id=o.patient_id where lo.id=lab_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['lab_tech','lab_supervisor']))))
) with check(private.is_platform_root() or validation_status in ('draft','pending_validation') or exists(select 1 from public.providers pr join public.facility_memberships fm on fm.user_id=pr.user_id join public.roles r on r.id=fm.role_id where pr.id=validated_by_provider_id and fm.facility_id=(select p.facility_id from public.lab_orders lo join public.orders o on o.id=lo.order_id join public.patients p on p.id=o.patient_id where lo.id=lab_order_id) and fm.user_id=(select auth.uid()) and r.role_code='lab_supervisor'));

create policy medications_catalog_read on public.medications for select to authenticated using(true);
create policy providers_authenticated_read on public.providers for select to authenticated using(true);
create policy medication_orders_access on public.medication_orders for select to authenticated using(
 exists(select 1 from public.patients p where p.id=patient_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice','nurse','pharmacist']))))
 or exists(select 1 from public.patient_accounts pa where pa.patient_id=medication_orders.patient_id and pa.user_id=(select auth.uid()))
);
create policy medication_orders_staff_insert on public.medication_orders for insert to authenticated with check(
 exists(select 1 from public.patients p where p.id=patient_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice']))))
);
create policy medication_orders_staff_update on public.medication_orders for update to authenticated using(
 exists(select 1 from public.patients p where p.id=patient_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice']))))
) with check(exists(select 1 from public.patients p where p.id=patient_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice'])))));

create policy lab_orders_access on public.lab_orders for select to authenticated using(
 exists(select 1 from public.orders o join public.patients p on p.id=o.patient_id where o.id=order_id and (private.is_platform_root() or (p.facility_id is not null and private.is_facility_member(p.facility_id)) or exists(select 1 from public.patient_accounts pa where pa.patient_id=p.id and pa.user_id=(select auth.uid()))))
);
create policy orders_access on public.orders for select to authenticated using(
 exists(select 1 from public.patients p where p.id=patient_id and (private.is_platform_root() or (p.facility_id is not null and private.is_facility_member(p.facility_id)) or exists(select 1 from public.patient_accounts pa where pa.patient_id=p.id and pa.user_id=(select auth.uid()))))
);
grant select on public.medications,public.providers,public.medication_orders,public.lab_orders,public.orders to authenticated;
grant insert,update on public.medication_orders,public.lab_results to authenticated;

create index medication_orders_patient_idx on public.medication_orders(patient_id,id desc);
create index lab_orders_order_idx on public.lab_orders(order_id);
create index orders_patient_idx on public.orders(patient_id,created_at desc);
create index appointments_facility_idx on public.appointments(facility_id,booked_at desc);
create index appointments_department_idx on public.appointments(department_id);
create index appointments_service_idx on public.appointments(service_id);
create index appointments_provider_idx on public.appointments(provider_id);
create index refill_patient_idx on public.medication_refill_requests(patient_id,requested_at desc);
