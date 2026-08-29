-- Live result workflows for laboratory, imaging, and other specialty orders.
alter table public.imaging_results add column if not exists interpretation text check(interpretation in ('normal','out_of_range','dangerously_abnormal'));
alter table public.procedure_results add column if not exists interpretation text check(interpretation in ('normal','out_of_range','dangerously_abnormal'));

alter table public.lab_reference_ranges enable row level security;
drop policy if exists lab_reference_ranges_authorized_read on public.lab_reference_ranges;
create policy lab_reference_ranges_authorized_read on public.lab_reference_ranges for select to authenticated using(
 facility_id is null or private.is_platform_root() or private.is_facility_member(facility_id)
);
drop policy if exists lab_reference_ranges_laboratory_insert on public.lab_reference_ranges;
create policy lab_reference_ranges_laboratory_insert on public.lab_reference_ranges for insert to authenticated with check(
 private.is_platform_root() or (facility_id is not null and private.has_facility_role(facility_id,array['lab_tech','lab_supervisor','sysadmin']))
);

drop policy if exists imaging_orders_authorized_read on public.imaging_orders;
create policy imaging_orders_authorized_read on public.imaging_orders for select to authenticated using(
 exists(select 1 from public.orders o where o.id=order_id and private.can_read_patient_record(o.patient_id))
);
drop policy if exists procedure_orders_authorized_read on public.procedure_orders;
create policy procedure_orders_authorized_read on public.procedure_orders for select to authenticated using(
 exists(select 1 from public.orders o where o.id=order_id and private.can_read_patient_record(o.patient_id))
);

drop policy if exists imaging_results_authorized_read on public.imaging_results;
create policy imaging_results_authorized_read on public.imaging_results for select to authenticated using(
 exists(select 1 from public.imaging_orders io join public.orders o on o.id=io.order_id join public.patients p on p.id=o.patient_id
 where io.id=imaging_order_id and (
   private.is_platform_root()
   or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['rad_tech']))
   or (result_status='final' and private.can_read_patient_record(p.id))
 ))
);
drop policy if exists imaging_results_staff_insert on public.imaging_results;
create policy imaging_results_staff_insert on public.imaging_results for insert to authenticated with check(
 exists(select 1 from public.imaging_orders io join public.orders o on o.id=io.order_id join public.patients p on p.id=o.patient_id
 where io.id=imaging_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['rad_tech','physician','resident','advanced_practice']))))
);
drop policy if exists imaging_results_staff_update on public.imaging_results;
create policy imaging_results_staff_update on public.imaging_results for update to authenticated using(
 exists(select 1 from public.imaging_orders io join public.orders o on o.id=io.order_id join public.patients p on p.id=o.patient_id
 where io.id=imaging_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['rad_tech','physician','resident','advanced_practice']))))
) with check(
 exists(select 1 from public.imaging_orders io join public.orders o on o.id=io.order_id join public.patients p on p.id=o.patient_id
 where io.id=imaging_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['rad_tech','physician','resident','advanced_practice']))))
);

drop policy if exists procedure_results_authorized_read on public.procedure_results;
create policy procedure_results_authorized_read on public.procedure_results for select to authenticated using(
 exists(select 1 from public.procedure_orders po join public.orders o on o.id=po.order_id join public.patients p on p.id=o.patient_id
 where po.id=procedure_order_id and (
   private.is_platform_root()
   or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice','nurse']))
   or (result_status='final' and private.can_read_patient_record(p.id))
 ))
);
drop policy if exists procedure_results_staff_insert on public.procedure_results;
create policy procedure_results_staff_insert on public.procedure_results for insert to authenticated with check(
 exists(select 1 from public.procedure_orders po join public.orders o on o.id=po.order_id join public.patients p on p.id=o.patient_id
 where po.id=procedure_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice']))))
);
drop policy if exists procedure_results_staff_update on public.procedure_results;
create policy procedure_results_staff_update on public.procedure_results for update to authenticated using(
 exists(select 1 from public.procedure_orders po join public.orders o on o.id=po.order_id join public.patients p on p.id=o.patient_id
 where po.id=procedure_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice']))))
) with check(
 exists(select 1 from public.procedure_orders po join public.orders o on o.id=po.order_id join public.patients p on p.id=o.patient_id
 where po.id=procedure_order_id and (private.is_platform_root() or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice']))))
);

drop policy if exists orders_result_staff_update on public.orders;
create policy orders_result_staff_update on public.orders for update to authenticated using(
 private.is_platform_root() or exists(select 1 from public.patients p where p.id=patient_id and p.facility_id is not null and (
   (orders.order_type='lab' and private.has_facility_role(p.facility_id,array['lab_tech','lab_supervisor']))
   or (orders.order_type='imaging' and private.has_facility_role(p.facility_id,array['rad_tech']))
 ))
) with check(
 private.is_platform_root() or exists(select 1 from public.patients p where p.id=patient_id and p.facility_id is not null and (
   (orders.order_type='lab' and private.has_facility_role(p.facility_id,array['lab_tech','lab_supervisor']))
   or (orders.order_type='imaging' and private.has_facility_role(p.facility_id,array['rad_tech']))
 ))
);

grant select,insert on public.lab_reference_ranges to authenticated;
grant select on public.imaging_orders,public.procedure_orders to authenticated;
grant select,insert,update on public.imaging_results,public.procedure_results to authenticated;
grant update on public.orders to authenticated;

create index if not exists lab_results_order_lookup_idx on public.lab_results(lab_order_id,result_at desc);
create index if not exists imaging_results_order_lookup_idx on public.imaging_results(imaging_order_id,result_at desc);
create index if not exists procedure_results_order_lookup_idx on public.procedure_results(procedure_order_id,performed_at desc);
