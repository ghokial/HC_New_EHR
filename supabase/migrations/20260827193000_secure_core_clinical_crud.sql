-- Complete the staff-facing CRUD paths used by the live EHR screens.
-- Access remains tenant-scoped and requires MFA (AAL2).

create or replace function private.can_write_patient_record(target_patient_id bigint,allowed_roles text[])
returns boolean language sql stable security invoker set search_path='' as $$
  select private.is_platform_root() or exists(
    select 1 from public.patients p
    where p.id=target_patient_id
      and p.facility_id is not null
      and private.has_facility_role(p.facility_id,allowed_roles)
  )
$$;
revoke all on function private.can_write_patient_record(bigint,text[]) from public,anon;
grant execute on function private.can_write_patient_record(bigint,text[]) to authenticated;

drop policy if exists encounters_staff_insert on public.encounters;
create policy encounters_staff_insert on public.encounters for insert to authenticated
with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['registration','physician','resident','advanced_practice','nurse']));
drop policy if exists encounters_staff_update on public.encounters;
create policy encounters_staff_update on public.encounters for update to authenticated
using(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice','nurse']))
with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice','nurse']));

drop policy if exists orders_staff_insert on public.orders;
create policy orders_staff_insert on public.orders for insert to authenticated
with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice']));
drop policy if exists orders_staff_update on public.orders;
create policy orders_staff_update on public.orders for update to authenticated
using(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice']))
with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice']));

drop policy if exists lab_orders_staff_insert on public.lab_orders;
create policy lab_orders_staff_insert on public.lab_orders for insert to authenticated
with check(private.is_aal2() and exists(select 1 from public.orders o where o.id=order_id and private.can_write_patient_record(o.patient_id,array['physician','resident','advanced_practice'])));
drop policy if exists imaging_orders_staff_insert on public.imaging_orders;
create policy imaging_orders_staff_insert on public.imaging_orders for insert to authenticated
with check(private.is_aal2() and exists(select 1 from public.orders o where o.id=order_id and private.can_write_patient_record(o.patient_id,array['physician','resident','advanced_practice'])));
drop policy if exists procedure_orders_staff_insert on public.procedure_orders;
create policy procedure_orders_staff_insert on public.procedure_orders for insert to authenticated
with check(private.is_aal2() and exists(select 1 from public.orders o where o.id=order_id and private.can_write_patient_record(o.patient_id,array['physician','resident','advanced_practice'])));

drop policy if exists clinical_notes_staff_insert on public.clinical_notes;
create policy clinical_notes_staff_insert on public.clinical_notes for insert to authenticated
with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice','nurse','therapist']) and author_provider_id=public.current_provider_id());
drop policy if exists clinical_notes_staff_update on public.clinical_notes;
create policy clinical_notes_staff_update on public.clinical_notes for update to authenticated
using(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice','nurse','therapist']) and author_provider_id=public.current_provider_id())
with check(private.is_aal2() and private.can_write_patient_record(patient_id,array['physician','resident','advanced_practice','nurse','therapist']) and author_provider_id=public.current_provider_id());

grant select,insert,update on public.encounters,public.orders,public.lab_orders,public.imaging_orders,public.procedure_orders,public.clinical_notes to authenticated;
