create table public.facility_clients(
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.facility_client_members(
  client_id uuid not null references public.facility_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  primary key(client_id,user_id)
);

create table public.facility_client_facilities(
  client_id uuid not null references public.facility_clients(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  primary key(client_id,facility_id)
);

alter table public.facility_clients enable row level security;
alter table public.facility_client_members enable row level security;
alter table public.facility_client_facilities enable row level security;

create policy facility_clients_read on public.facility_clients for select to authenticated
using(private.is_platform_agent() or exists(select 1 from public.facility_client_members m where m.client_id=id and m.user_id=(select auth.uid()) and m.active));
create policy facility_clients_insert on public.facility_clients for insert to authenticated with check(private.is_platform_agent());
create policy facility_clients_update on public.facility_clients for update to authenticated using(private.is_platform_agent()) with check(private.is_platform_agent());
create policy facility_clients_delete on public.facility_clients for delete to authenticated using(private.is_platform_agent());
create policy facility_client_members_read on public.facility_client_members for select to authenticated
using(private.is_platform_agent() or user_id=(select auth.uid()));
create policy facility_client_members_insert on public.facility_client_members for insert to authenticated with check(private.is_platform_agent());
create policy facility_client_members_update on public.facility_client_members for update to authenticated using(private.is_platform_agent()) with check(private.is_platform_agent());
create policy facility_client_members_delete on public.facility_client_members for delete to authenticated using(private.is_platform_agent());
create policy facility_client_facilities_read on public.facility_client_facilities for select to authenticated
using(private.is_platform_agent() or exists(select 1 from public.facility_client_members m where m.client_id=facility_client_facilities.client_id and m.user_id=(select auth.uid()) and m.active));
create policy facility_client_facilities_insert on public.facility_client_facilities for insert to authenticated with check(private.is_platform_agent());
create policy facility_client_facilities_update on public.facility_client_facilities for update to authenticated using(private.is_platform_agent()) with check(private.is_platform_agent());
create policy facility_client_facilities_delete on public.facility_client_facilities for delete to authenticated using(private.is_platform_agent());

create index facility_clients_created_by_idx on public.facility_clients(created_by);
create index facility_client_members_user_idx on public.facility_client_members(user_id,client_id) where active;
create index facility_client_facilities_facility_idx on public.facility_client_facilities(facility_id,client_id);

grant select,insert,update,delete on public.facility_clients,public.facility_client_members,public.facility_client_facilities to authenticated;

create or replace function private.can_view_facility_directory(fid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.is_platform_agent()
    or private.current_role_code()='sysadmin'
    or private.is_facility_member(fid)
    or (
      private.is_aal2() and exists(
        select 1
        from public.facility_jurisdictions fj
        join public.health_department_memberships hm on hm.user_id=(select auth.uid()) and hm.active
        where fj.facility_id=fid and private.jurisdiction_contains(hm.jurisdiction_id,fj.jurisdiction_id)
      )
    )
    or exists(
      select 1
      from public.facility_client_facilities cf
      join public.facility_client_members cm on cm.client_id=cf.client_id
      where cf.facility_id=fid and cm.user_id=(select auth.uid()) and cm.active
    )
$$;
revoke all on function private.can_view_facility_directory(uuid) from public,anon;
grant execute on function private.can_view_facility_directory(uuid) to authenticated;

alter policy facilities_visible on public.facilities
using(private.can_view_facility_directory(id));

comment on policy facilities_visible on public.facilities is
  'Facility directory access is limited to platform agents, jurisdiction-scoped health departments, active client-group members, and direct facility members.';
