-- Security review fixes S1-S3 plus the messaging/community permission bug.

-- S1. Only platform Root may create, change, or remove role assignments.
-- Staff and facility accounts are provisioned by the Edge Functions with the
-- service role, which is not subject to these policies.
drop policy if exists user_roles_admin_all on public.user_roles;
drop policy if exists user_roles_root_read on public.user_roles;
drop policy if exists user_roles_root_insert on public.user_roles;
drop policy if exists user_roles_root_update on public.user_roles;
drop policy if exists user_roles_root_delete on public.user_roles;
create policy user_roles_root_read on public.user_roles for select to authenticated using(private.is_platform_root());
create policy user_roles_root_insert on public.user_roles for insert to authenticated with check(private.is_platform_root());
create policy user_roles_root_update on public.user_roles for update to authenticated using(private.is_platform_root()) with check(private.is_platform_root());
create policy user_roles_root_delete on public.user_roles for delete to authenticated using(private.is_platform_root());

-- S2. A referral may only be sent by the facility that holds the patient,
-- for that patient's own order, to a different facility.
drop policy if exists referrals_source_write on public.clinical_service_referrals;
create policy referrals_source_write on public.clinical_service_referrals for insert to authenticated with check(
 private.is_aal2() and sent_by=(select auth.uid()) and source_facility_id is not null and source_facility_id<>target_facility_id
 and (private.is_platform_root() or private.is_facility_member(source_facility_id))
 and exists(select 1 from public.patients p where p.id=patient_id and p.facility_id=source_facility_id)
 and (medication_order_id is null or exists(select 1 from public.medication_orders mo where mo.id=medication_order_id and mo.patient_id=clinical_service_referrals.patient_id))
 and (order_id is null or exists(select 1 from public.orders o where o.id=order_id and o.patient_id=clinical_service_referrals.patient_id))
);
-- The receiving facility may progress a referral but not re-point it at another
-- patient, order, or facility.
create or replace function private.protect_referral_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.patient_id<>old.patient_id or new.source_facility_id is distinct from old.source_facility_id or new.target_facility_id<>old.target_facility_id
    or new.service_type<>old.service_type or new.medication_order_id is distinct from old.medication_order_id or new.order_id is distinct from old.order_id
    or new.sent_by<>old.sent_by or new.sent_at<>old.sent_at then
  raise exception 'Only the referral status and timestamps can be changed';
 end if;
 return new;
end $$;
revoke all on function private.protect_referral_identity() from public,anon,authenticated;
drop trigger if exists protect_referral_identity on public.clinical_service_referrals;
create trigger protect_referral_identity before update on public.clinical_service_referrals for each row execute function private.protect_referral_identity();

-- S3. Only a thread owner may add participants.
drop policy if exists participants_owner_write on public.message_participants;
create policy participants_owner_write on public.message_participants for all to authenticated
 using(private.is_aal2() and private.is_thread_owner(thread_id))
 with check(private.is_aal2() and private.is_thread_owner(thread_id));

-- Messaging and community policies call these helpers, but execute was revoked
-- from authenticated, so every read failed with "permission denied". They only
-- report the caller's own membership.
grant execute on function private.is_thread_participant(uuid),private.is_thread_owner(uuid),private.has_community_access(uuid,boolean),private.manages_community(uuid) to authenticated;

-- Creating a thread returns it to the creator (insert ... returning), which
-- checks the read policy before the owner participant row exists. Let the
-- creator read their own thread so thread creation succeeds.
drop policy if exists threads_participant_read on public.message_threads;
create policy threads_participant_read on public.message_threads for select to authenticated using(private.is_aal2() and (created_by=(select auth.uid()) or private.is_thread_participant(id)));
