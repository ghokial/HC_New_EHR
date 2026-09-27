-- Phase 2: staff scheduling.
-- * Patients could not book from the portal: two versions of book_available_slot
--   existed and a three-argument call was ambiguous ("is not unique").
-- * No screen or function created availability, and any facility member
--   (including billing) could write slots, with overlapping slots allowed.
-- * Front-desk staff could not book on a patient's behalf.
-- * Cancelling left the slot unusable; patients could not cancel their own visit.

drop function if exists public.book_available_slot(bigint,bigint,text);

create or replace function private.can_schedule(fid uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_platform_root() or private.has_facility_role(fid,array['registration','physician','resident','advanced_practice','nurse','case_manager','sysadmin'])
$$;
revoke all on function private.can_schedule(uuid) from public,anon;
grant execute on function private.can_schedule(uuid) to authenticated;

-- A provider cannot have two overlapping open slots, at any facility.
create or replace function private.prevent_overlapping_slots() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.provider_id is not null and new.status<>'cancelled' and exists(
   select 1 from public.provider_availability_slots s
   where s.provider_id=new.provider_id and s.id is distinct from new.id and s.status<>'cancelled'
     and tstzrange(s.starts_at,s.ends_at,'[)') && tstzrange(new.starts_at,new.ends_at,'[)')) then
  raise exception 'This provider already has availability overlapping % – %',new.starts_at,new.ends_at;
 end if;
 return new;
end $$;
revoke all on function private.prevent_overlapping_slots() from public,anon,authenticated;
drop trigger if exists prevent_overlapping_slots on public.provider_availability_slots;
create trigger prevent_overlapping_slots before insert or update of provider_id,starts_at,ends_at,status on public.provider_availability_slots for each row execute function private.prevent_overlapping_slots();

drop policy if exists slots_staff_write on public.provider_availability_slots;
create policy slots_staff_write on public.provider_availability_slots for all to authenticated
 using(private.can_schedule(facility_id)) with check(private.can_schedule(facility_id));
-- Staff still read their facility's full calendar (slots_visible covers available slots for everyone).
drop policy if exists slots_member_read on public.provider_availability_slots;
create policy slots_member_read on public.provider_availability_slots for select to authenticated using(private.is_platform_root() or private.is_facility_member(facility_id));
drop policy if exists appointments_staff_write on public.appointments;
create policy appointments_staff_write on public.appointments for all to authenticated
 using(private.can_schedule(facility_id)) with check(private.can_schedule(facility_id));

-- Staff cannot see other staff members' memberships, so this check runs as definer.
create or replace function private.provider_works_at(target_provider bigint,fid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.providers p join public.facility_memberships fm on fm.user_id=p.user_id where p.id=target_provider and p.active and fm.facility_id=fid and fm.active)
$$;
revoke all on function private.provider_works_at(bigint,uuid) from public,anon;
grant execute on function private.provider_works_at(bigint,uuid) to authenticated;

-- Creates repeating availability, e.g. Mondays and Wednesdays 08:00–12:00 in
-- 20-minute slots, in the facility's local time zone. Overlaps are skipped and
-- reported rather than silently double-booking the provider.
create or replace function public.generate_availability_slots(
 target_facility uuid, target_provider bigint, target_department bigint, target_service bigint,
 first_day date, last_day date, weekdays integer[], day_start time, day_end time, slot_minutes integer, tz_name text default 'UTC'
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d date; t time; created integer:=0; skipped integer:=0; starts timestamptz;
begin
 if not private.can_schedule(target_facility) then raise exception 'Only scheduling, clinical, or administrative staff of this facility can create availability'; end if;
 if last_day<first_day or last_day-first_day>92 then raise exception 'Choose a period of at most 93 days'; end if;
 if slot_minutes is null or slot_minutes<5 or slot_minutes>480 then raise exception 'Slot length must be between 5 and 480 minutes'; end if;
 if day_end<=day_start then raise exception 'The end time must be after the start time'; end if;
 if coalesce(array_length(weekdays,1),0)=0 then raise exception 'Choose at least one weekday'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=tz_name) then raise exception 'Unknown time zone %',tz_name; end if;
 if target_provider is not null and not private.provider_works_at(target_provider,target_facility) then
  raise exception 'That provider does not work at this facility';
 end if;
 if not exists(select 1 from public.facility_departments fd where fd.facility_id=target_facility and fd.department_id=target_department) then raise exception 'That department is not active at this facility'; end if;
 d:=first_day;
 while d<=last_day loop
  if extract(isodow from d)::int = any(weekdays) then
   t:=day_start;
   while t+make_interval(mins=>slot_minutes)<=day_end and t>=day_start loop
    starts:=(d+t) at time zone tz_name;
    if starts>now() then
     begin
      insert into public.provider_availability_slots(facility_id,department_id,service_id,provider_id,starts_at,ends_at)
      values(target_facility,target_department,target_service,target_provider,starts,starts+make_interval(mins=>slot_minutes));
      created:=created+1;
     exception when raise_exception or unique_violation then skipped:=skipped+1;
     end;
    end if;
    exit when t+make_interval(mins=>slot_minutes)<=t;
    t:=t+make_interval(mins=>slot_minutes);
   end loop;
  end if;
  d:=d+1;
 end loop;
 return jsonb_build_object('created',created,'skipped_overlaps',skipped);
end $$;
revoke all on function public.generate_availability_slots(uuid,bigint,bigint,bigint,date,date,integer[],time,time,integer,text) from public,anon;
grant execute on function public.generate_availability_slots(uuid,bigint,bigint,bigint,date,date,integer[],time,time,integer,text) to authenticated;

-- Booking by the patient, an authorized proxy, or facility scheduling staff for a
-- patient registered at that facility.
create or replace function public.book_available_slot(slot_to_book bigint,patient_to_book bigint,booking_reason text default null,notify_if_sooner boolean default false) returns bigint
language plpgsql security definer set search_path='' as $$
declare s public.provider_availability_slots%rowtype; result bigint;
begin
 select * into s from public.provider_availability_slots where id=slot_to_book and status='available' and starts_at>now() for update;
 if s.id is null then raise exception 'This slot is no longer available'; end if;
 if not exists(select 1 from public.patient_accounts where user_id=(select auth.uid()) and patient_id=patient_to_book)
    and not exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=patient_to_book and px.active and px.can_manage_appointments)
    and not (private.is_aal2() and private.can_schedule(s.facility_id) and exists(select 1 from public.patients p where p.id=patient_to_book and p.facility_id=s.facility_id))
    and not private.is_platform_root() then raise exception 'Patient booking access required'; end if;
 insert into public.appointments(slot_id,facility_id,patient_id,department_id,service_id,provider_id,reason,notify_if_sooner,booked_by_user_id)
 values(s.id,s.facility_id,patient_to_book,s.department_id,s.service_id,s.provider_id,booking_reason,notify_if_sooner,(select auth.uid())) returning id into result;
 update public.provider_availability_slots set status='booked' where id=s.id;
 return result;
end $$;
revoke all on function public.book_available_slot(bigint,bigint,text,boolean) from public,anon;
grant execute on function public.book_available_slot(bigint,bigint,text,boolean) to authenticated;

-- Cancelling keeps the appointment on the calendar as cancelled and, if the time
-- is still in the future, reopens the slot for someone else. Patients (and proxies
-- who manage appointments) can cancel their own upcoming visits.
create or replace function public.cancel_appointment_keep_calendar(appointment_to_cancel bigint) returns void
language plpgsql security definer set search_path='' as $$
declare appointment public.appointments%rowtype; slot_start timestamptz;
begin
 select * into appointment from public.appointments where id=appointment_to_cancel for update;
 if appointment.id is null then raise exception 'Appointment not found'; end if;
 if not private.is_platform_root() and not (private.is_aal2() and private.can_schedule(appointment.facility_id))
    and not exists(select 1 from public.patient_accounts where user_id=(select auth.uid()) and patient_id=appointment.patient_id)
    and not exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=appointment.patient_id and px.active and px.can_manage_appointments) then
  raise exception 'Appointment access required';
 end if;
 if appointment.status in ('cancelled','completed','no_show') then raise exception 'This appointment is already %',appointment.status; end if;
 select starts_at into slot_start from public.provider_availability_slots where id=appointment.slot_id;
 update public.appointments set status='cancelled' where id=appointment.id;
 update public.provider_availability_slots set status=case when slot_start>now() then 'available' else 'cancelled' end where id=appointment.slot_id;
end $$;

-- The appointment keeps a one-to-one link to its slot, so a reopened slot needs the
-- old appointment detached before it can be booked again.
alter table public.appointments drop constraint if exists appointments_slot_id_key;
create unique index if not exists appointments_one_active_per_slot on public.appointments(slot_id) where status not in ('cancelled','no_show');

create or replace function public.reschedule_appointment(appointment_to_modify bigint,new_slot_id bigint) returns void
language plpgsql security definer set search_path='' as $$
declare appointment public.appointments%rowtype; new_slot public.provider_availability_slots%rowtype;
begin
 select * into appointment from public.appointments where id=appointment_to_modify for update;
 if appointment.id is null then raise exception 'Appointment not found'; end if;
 if not private.is_platform_root() and not (private.is_aal2() and private.can_schedule(appointment.facility_id)) then raise exception 'Scheduling access required'; end if;
 if appointment.status not in ('booked','confirmed') then raise exception 'Only booked or confirmed appointments can be rescheduled'; end if;
 select * into new_slot from public.provider_availability_slots where id=new_slot_id and facility_id=appointment.facility_id and status='available' and starts_at>now() for update;
 if new_slot.id is null then raise exception 'Future availability is no longer available'; end if;
 update public.provider_availability_slots set status='available' where id=appointment.slot_id and starts_at>now();
 update public.provider_availability_slots set status='booked' where id=new_slot.id;
 update public.appointments set slot_id=new_slot.id,department_id=new_slot.department_id,service_id=new_slot.service_id,provider_id=new_slot.provider_id,status='booked' where id=appointment.id;
end $$;

drop trigger if exists audit_row_change on public.appointments;
create trigger audit_row_change after insert or update or delete on public.appointments for each row execute function private.audit_row_change();
