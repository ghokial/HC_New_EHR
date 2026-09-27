create extension if not exists pg_cron;

create table if not exists public.facility_notifications(
 id uuid primary key default gen_random_uuid(),
 facility_id uuid not null references public.facilities(id) on delete cascade,
 patient_id bigint not null references public.patients(id) on delete cascade,
 appointment_id bigint not null references public.appointments(id) on delete cascade,
 available_slot_id bigint not null references public.provider_availability_slots(id) on delete cascade,
 service_id bigint references public.services(id),
 provider_id bigint references public.providers(id),
 notification_type text not null default 'sooner_appointment_available' check(notification_type in ('sooner_appointment_available')),
 available_starts_at timestamptz not null,
 status text not null default 'unread' check(status in ('unread','read','dismissed')),
 created_at timestamptz not null default now(),
 read_at timestamptz,
 unique(appointment_id,available_slot_id,notification_type)
);
alter table public.facility_notifications enable row level security;
create policy facility_notifications_select on public.facility_notifications for select to authenticated using(private.is_platform_root() or private.is_facility_member(facility_id));
create policy facility_notifications_update on public.facility_notifications for update to authenticated using(private.is_platform_root() or private.is_facility_member(facility_id)) with check(private.is_platform_root() or private.is_facility_member(facility_id));
revoke all on public.facility_notifications from public,anon;
grant select,update on public.facility_notifications to authenticated;

create or replace function private.check_sooner_appointment_availability() returns integer
language plpgsql security definer set search_path='' as $$
declare inserted_count integer;
begin
 insert into public.facility_notifications(facility_id,patient_id,appointment_id,available_slot_id,service_id,provider_id,available_starts_at)
 select appointment.facility_id,appointment.patient_id,appointment.id,available.id,appointment.service_id,appointment.provider_id,available.starts_at
 from public.appointments appointment
 join public.provider_availability_slots current_slot on current_slot.id=appointment.slot_id
 join lateral (
   select candidate.id,candidate.starts_at
   from public.provider_availability_slots candidate
   where candidate.facility_id=appointment.facility_id
     and candidate.provider_id=appointment.provider_id
     and candidate.status='available'
     and candidate.starts_at>now()
     and candidate.starts_at<=now()+interval '48 hours'
     and candidate.starts_at<current_slot.starts_at
   order by candidate.starts_at
   limit 1
 ) available on true
 where appointment.notify_if_sooner
   and appointment.status in ('booked','confirmed')
 on conflict(appointment_id,available_slot_id,notification_type) do nothing;
 get diagnostics inserted_count=row_count;
 return inserted_count;
end $$;
revoke all on function private.check_sooner_appointment_availability() from public,anon,authenticated;

select cron.schedule(
 'healthcarology-daily-sooner-appointment-check',
 '0 6 * * *',
 $$select private.check_sooner_appointment_availability();$$
);
