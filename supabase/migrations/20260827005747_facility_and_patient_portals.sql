create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  country_id bigint references public.countries(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.facility_memberships (
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id bigint not null references public.roles(id),
  is_owner boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (facility_id,user_id)
);

create table public.facility_departments (
  facility_id uuid not null references public.facilities(id) on delete cascade,
  department_id bigint not null references public.departments(id) on delete cascade,
  active boolean not null default true,
  primary key (facility_id,department_id)
);

create table public.facility_services (
  facility_id uuid not null references public.facilities(id) on delete cascade,
  service_id bigint not null references public.services(id) on delete cascade,
  active boolean not null default true,
  primary key (facility_id,service_id)
);

alter table public.patients add column facility_id uuid references public.facilities(id);

create table public.patient_link_invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_patient_id bigint not null references public.patients(id) on delete cascade,
  invitee_patient_id bigint not null references public.patients(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(inviter_patient_id,invitee_patient_id)
);

alter table public.facilities enable row level security;
alter table public.facility_memberships enable row level security;
alter table public.facility_departments enable row level security;
alter table public.facility_services enable row level security;
alter table public.patient_link_invitations enable row level security;

create or replace function public.is_platform_root() returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=(select auth.uid()) and r.role_code='root')
$$;
create or replace function public.is_facility_member(fid uuid) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.facility_memberships fm where fm.facility_id=fid and fm.user_id=(select auth.uid()) and fm.active)
$$;
create or replace function public.is_facility_admin(fid uuid) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.facility_memberships fm join public.roles r on r.id=fm.role_id where fm.facility_id=fid and fm.user_id=(select auth.uid()) and fm.active and (fm.is_owner or r.role_code in ('sysadmin','root')))
$$;

create policy facilities_visible on public.facilities for select to authenticated using(public.is_platform_root() or public.is_facility_member(id));
create policy facilities_root_write on public.facilities for all to authenticated using(public.is_platform_root()) with check(public.is_platform_root());
create policy memberships_visible on public.facility_memberships for select to authenticated using(public.is_platform_root() or user_id=(select auth.uid()) or public.is_facility_admin(facility_id));
create policy memberships_admin_write on public.facility_memberships for all to authenticated using(public.is_platform_root() or public.is_facility_admin(facility_id)) with check(public.is_platform_root() or public.is_facility_admin(facility_id));
create policy facility_departments_visible on public.facility_departments for select to authenticated using(public.is_platform_root() or public.is_facility_member(facility_id));
create policy facility_departments_admin on public.facility_departments for all to authenticated using(public.is_platform_root() or public.is_facility_admin(facility_id)) with check(public.is_platform_root() or public.is_facility_admin(facility_id));
create policy facility_services_visible on public.facility_services for select to authenticated using(public.is_platform_root() or public.is_facility_member(facility_id));
create policy facility_services_admin on public.facility_services for all to authenticated using(public.is_platform_root() or public.is_facility_admin(facility_id)) with check(public.is_platform_root() or public.is_facility_admin(facility_id));

drop policy if exists patients_staff_read on public.patients;
drop policy if exists patients_create on public.patients;
drop policy if exists patients_update on public.patients;
create policy patients_facility_read on public.patients for select to authenticated using(public.is_platform_root() or (facility_id is not null and public.is_facility_member(facility_id)) or exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id=patients.id) or exists(select 1 from public.patient_accounts pa join public.patient_proxies px on px.proxy_patient_id=pa.patient_id where pa.user_id=(select auth.uid()) and px.target_patient_id=patients.id and px.can_view and px.active));
create policy patients_facility_create on public.patients for insert to authenticated with check(public.is_platform_root() or (facility_id is not null and public.is_facility_member(facility_id)));
create policy patients_facility_update on public.patients for update to authenticated using(public.is_platform_root() or (facility_id is not null and public.is_facility_member(facility_id))) with check(public.is_platform_root() or (facility_id is not null and public.is_facility_member(facility_id)));

create policy patient_invites_visible on public.patient_link_invitations for select to authenticated using(exists(select 1 from public.patient_accounts pa where pa.user_id=(select auth.uid()) and pa.patient_id in (inviter_patient_id,invitee_patient_id)));

create or replace function public.invite_patient_link(target_last_name text,target_unin text) returns uuid language plpgsql security definer set search_path='' as $$
declare mine bigint; target bigint; result uuid;
begin
  select patient_id into mine from public.patient_accounts where user_id=(select auth.uid()) order by id limit 1;
  if mine is null then raise exception 'Patient portal account required'; end if;
  select id into target from public.patients where lower(last_name)=lower(trim(target_last_name)) and snau=trim(target_unin) and id<>mine limit 1;
  if target is null then raise exception 'No matching patient was found'; end if;
  insert into public.patient_link_invitations(inviter_patient_id,invitee_patient_id) values(mine,target)
  on conflict(inviter_patient_id,invitee_patient_id) do update set status='pending',responded_at=null returning id into result;
  return result;
end $$;
create or replace function public.respond_patient_link(invitation_id uuid,accept_invitation boolean) returns void language plpgsql security definer set search_path='' as $$
declare inv public.patient_link_invitations%rowtype;
begin
  select * into inv from public.patient_link_invitations where id=invitation_id for update;
  if inv.id is null or not exists(select 1 from public.patient_accounts where user_id=(select auth.uid()) and patient_id=inv.invitee_patient_id) then raise exception 'Invitation not available'; end if;
  update public.patient_link_invitations set status=case when accept_invitation then 'accepted' else 'declined' end,responded_at=now() where id=inv.id;
  if accept_invitation then insert into public.patient_proxies(proxy_patient_id,target_patient_id,relationship,can_view,active) values(inv.inviter_patient_id,inv.invitee_patient_id,'accepted link',true,true) on conflict(proxy_patient_id,target_patient_id) do update set can_view=true,active=true; end if;
end $$;

revoke all on function public.invite_patient_link(text,text),public.respond_patient_link(uuid,boolean) from public,anon;
grant execute on function public.invite_patient_link(text,text),public.respond_patient_link(uuid,boolean) to authenticated;
grant select on public.facilities,public.facility_memberships,public.facility_departments,public.facility_services,public.patient_link_invitations to authenticated;
grant insert,update,delete on public.facilities,public.facility_memberships,public.facility_departments,public.facility_services to authenticated;
