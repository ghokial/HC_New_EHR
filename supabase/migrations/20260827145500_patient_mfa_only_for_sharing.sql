-- Allow AAL1 patient sessions to access only their own/linked portal rows.
-- All staff and administrative access remains AAL2-only.
drop policy if exists mfa_required on public.patient_accounts;
create policy mfa_required on public.patient_accounts as restrictive for all to authenticated using(private.is_aal2() or user_id=(select auth.uid())) with check(private.is_aal2());

drop policy if exists mfa_required on public.patients;
create policy mfa_required on public.patients as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=patients.id) or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=patients.id and px.active and px.can_view)) with check(private.is_aal2());

drop policy if exists mfa_required on public.diagnoses;
create policy mfa_required on public.diagnoses as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=diagnoses.patient_id) or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=diagnoses.patient_id and px.active and px.can_view)) with check(private.is_aal2());

drop policy if exists mfa_required on public.medication_orders;
create policy mfa_required on public.medication_orders as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=medication_orders.patient_id) or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=medication_orders.patient_id and px.active and px.can_view)) with check(private.is_aal2());

drop policy if exists mfa_required on public.prescription_fulfillments;
create policy mfa_required on public.prescription_fulfillments as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.medication_orders mo join public.patient_accounts pa on pa.patient_id=mo.patient_id where mo.id=prescription_fulfillments.medication_order_id and pa.user_id=(select auth.uid()))) with check(private.is_aal2());

drop policy if exists mfa_required on public.appointments;
create policy mfa_required on public.appointments as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=appointments.patient_id) or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=appointments.patient_id and px.active and px.can_manage_appointments)) with check(private.is_aal2());

drop policy if exists mfa_required on public.provider_availability_slots;
create policy mfa_required on public.provider_availability_slots as restrictive for all to authenticated using(private.is_aal2() or public.current_role_code()='patient') with check(private.is_aal2());

drop policy if exists mfa_required on public.patient_link_invitations;
create policy mfa_required on public.patient_link_invitations as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id in (patient_link_invitations.inviter_patient_id,patient_link_invitations.invitee_patient_id))) with check(private.is_aal2());

drop policy if exists mfa_required on public.medication_adherence_events;
create policy mfa_required on public.medication_adherence_events as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=medication_adherence_events.patient_id)) with check(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=medication_adherence_events.patient_id));

drop policy if exists mfa_required on public.medication_refill_requests;
create policy mfa_required on public.medication_refill_requests as restrictive for all to authenticated using(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=medication_refill_requests.patient_id)) with check(private.is_aal2() or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=medication_refill_requests.patient_id));

-- Sharing remains AAL2-only in both RLS and the Edge Function.
drop policy if exists shares_grantor_create on public.patient_record_shares;
create policy shares_grantor_create on public.patient_record_shares for insert to authenticated with check(private.is_aal2() and grantor_user_id=(select auth.uid()) and exists(select 1 from public.patients p where p.id=patient_id and (exists(select 1 from public.patient_accounts pa where pa.patient_id=p.id and pa.user_id=(select auth.uid())) or (p.facility_id is not null and private.has_facility_role(p.facility_id,array['physician','resident','advanced_practice'])))));
