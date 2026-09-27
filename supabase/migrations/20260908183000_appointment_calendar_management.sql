alter table public.appointments add column if not exists notify_if_sooner boolean not null default false;

create or replace function public.book_available_slot(slot_to_book bigint,patient_to_book bigint,booking_reason text default null,notify_if_sooner boolean default false) returns bigint
language plpgsql security definer set search_path='' as $$
declare s public.provider_availability_slots%rowtype; result bigint;
begin
 if not exists(select 1 from public.patient_accounts where user_id=(select auth.uid()) and patient_id=patient_to_book)
    and not exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=patient_to_book and px.active and px.can_manage_appointments)
    and not private.is_platform_root() then raise exception 'Patient booking access required'; end if;
 select * into s from public.provider_availability_slots where id=slot_to_book and status='available' and starts_at>now() for update;
 if s.id is null then raise exception 'This slot is no longer available'; end if;
 insert into public.appointments(slot_id,facility_id,patient_id,department_id,service_id,provider_id,reason,notify_if_sooner,booked_by_user_id)
 values(s.id,s.facility_id,patient_to_book,s.department_id,s.service_id,s.provider_id,booking_reason,notify_if_sooner,(select auth.uid())) returning id into result;
 update public.provider_availability_slots set status='booked' where id=s.id;
 return result;
end $$;

create or replace function public.cancel_appointment_keep_calendar(appointment_to_cancel bigint) returns void
language plpgsql security definer set search_path='' as $$
declare appointment public.appointments%rowtype;
begin
 select * into appointment from public.appointments where id=appointment_to_cancel for update;
 if appointment.id is null then raise exception 'Appointment not found'; end if;
 if not private.is_platform_root() and not private.is_facility_member(appointment.facility_id) then raise exception 'Facility appointment access required'; end if;
 update public.appointments set status='cancelled' where id=appointment.id;
 update public.provider_availability_slots set status='cancelled' where id=appointment.slot_id;
end $$;

create or replace function public.reschedule_appointment(appointment_to_modify bigint,new_slot_id bigint) returns void
language plpgsql security definer set search_path='' as $$
declare appointment public.appointments%rowtype; new_slot public.provider_availability_slots%rowtype;
begin
 select * into appointment from public.appointments where id=appointment_to_modify for update;
 if appointment.id is null then raise exception 'Appointment not found'; end if;
 if not private.is_platform_root() and not private.is_facility_member(appointment.facility_id) then raise exception 'Facility appointment access required'; end if;
 select * into new_slot from public.provider_availability_slots where id=new_slot_id and facility_id=appointment.facility_id and status='available' and starts_at>now() for update;
 if new_slot.id is null then raise exception 'Future availability is no longer available'; end if;
 update public.provider_availability_slots set status='available' where id=appointment.slot_id;
 update public.provider_availability_slots set status='booked' where id=new_slot.id;
 update public.appointments set slot_id=new_slot.id,department_id=new_slot.department_id,service_id=new_slot.service_id,provider_id=new_slot.provider_id,status='booked' where id=appointment.id;
end $$;

revoke all on function public.book_available_slot(bigint,bigint,text,boolean),public.cancel_appointment_keep_calendar(bigint),public.reschedule_appointment(bigint,bigint) from public,anon;
grant execute on function public.book_available_slot(bigint,bigint,text,boolean),public.cancel_appointment_keep_calendar(bigint),public.reschedule_appointment(bigint,bigint) to authenticated;
