create or replace function private.is_platform_root() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=(select auth.uid()) and r.role_code='root')
$$;
create or replace function private.is_facility_member(fid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.facility_memberships fm where fm.facility_id=fid and fm.user_id=(select auth.uid()) and fm.active)
$$;
create or replace function private.is_facility_admin(fid uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.facility_memberships fm join public.roles r on r.id=fm.role_id where fm.facility_id=fid and fm.user_id=(select auth.uid()) and fm.active and (fm.is_owner or r.role_code='sysadmin'))
$$;
revoke all on function private.is_platform_root(),private.is_facility_member(uuid),private.is_facility_admin(uuid) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.is_platform_root(),private.is_facility_member(uuid),private.is_facility_admin(uuid) to authenticated;

alter policy facilities_visible on public.facilities using(private.is_platform_root() or private.is_facility_member(id));
alter policy facilities_root_write on public.facilities using(private.is_platform_root()) with check(private.is_platform_root());
alter policy memberships_visible on public.facility_memberships using(private.is_platform_root() or user_id=(select auth.uid()) or private.is_facility_admin(facility_id));
alter policy memberships_admin_write on public.facility_memberships using(private.is_platform_root() or private.is_facility_admin(facility_id)) with check(private.is_platform_root() or private.is_facility_admin(facility_id));
alter policy facility_departments_visible on public.facility_departments using(private.is_platform_root() or private.is_facility_member(facility_id));
alter policy facility_departments_admin on public.facility_departments using(private.is_platform_root() or private.is_facility_admin(facility_id)) with check(private.is_platform_root() or private.is_facility_admin(facility_id));
alter policy facility_services_visible on public.facility_services using(private.is_platform_root() or private.is_facility_member(facility_id));
alter policy facility_services_admin on public.facility_services using(private.is_platform_root() or private.is_facility_admin(facility_id)) with check(private.is_platform_root() or private.is_facility_admin(facility_id));
alter policy patients_facility_read on public.patients using(private.is_platform_root() or (facility_id is not null and private.is_facility_member(facility_id)) or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=patients.id) or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=patients.id and px.can_view and px.active));
alter policy patients_facility_create on public.patients with check(private.is_platform_root() or (facility_id is not null and private.is_facility_member(facility_id)));
alter policy patients_facility_update on public.patients using(private.is_platform_root() or (facility_id is not null and private.is_facility_member(facility_id))) with check(private.is_platform_root() or (facility_id is not null and private.is_facility_member(facility_id)));

drop function public.is_platform_root();
drop function public.is_facility_member(uuid);
drop function public.is_facility_admin(uuid);
create index patients_facility_id_idx on public.patients(facility_id);
create index patient_link_invitations_invitee_idx on public.patient_link_invitations(invitee_patient_id,status);
