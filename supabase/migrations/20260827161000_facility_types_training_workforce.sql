alter table public.facilities add column if not exists facility_type text, add column if not exists facility_type_other text, add column if not exists is_training boolean not null default false;
update public.facilities set facility_type='Hospital' where facility_type is null;
alter table public.facilities alter column facility_type set not null;
alter table public.facilities add constraint facilities_facility_type_check check(facility_type in ('Hospital','Health Center','Pharmacy','Laboratory (Labs)','Imaging Center','Research Center','Other'));
alter table public.facilities add constraint facilities_other_type_check check(facility_type<>'Other' or nullif(btrim(facility_type_other),'') is not null);

create table public.facility_staff_teams(id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities(id) on delete cascade,name text not null,description text,active boolean not null default true,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(facility_id,name));
create table public.facility_staff_team_members(team_id uuid not null references public.facility_staff_teams(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,active boolean not null default true,joined_at timestamptz not null default now(),primary key(team_id,user_id));
create table public.staff_shifts(id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities(id) on delete cascade,staff_user_id uuid not null references auth.users(id),team_id uuid references public.facility_staff_teams(id) on delete set null,shift_type text not null,coverage text,starts_at timestamptz not null,ends_at timestamptz not null,status text not null default 'scheduled' check(status in ('scheduled','confirmed','in_progress','completed','cancelled','missed')),notes text,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),check(ends_at>starts_at));
create table public.facility_tasks(id uuid primary key default gen_random_uuid(),facility_id uuid not null references public.facilities(id) on delete cascade,title text not null,description text,patient_id bigint references public.patients(id) on delete set null,assigned_to_user_id uuid references auth.users(id) on delete set null,assigned_team_id uuid references public.facility_staff_teams(id) on delete set null,priority text not null default 'routine' check(priority in ('low','routine','important','urgent')),due_at timestamptz,status text not null default 'assigned' check(status in ('assigned','accepted','in_progress','blocked','completed','cancelled')),completion_note text,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(assigned_to_user_id is not null or assigned_team_id is not null));

create or replace function private.has_training_access(fid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.facilities f where f.id=fid and f.is_training)
 and (exists(select 1 from public.facility_memberships fm where fm.user_id=(select auth.uid()) and fm.active)
  or exists(select 1 from public.health_department_memberships hm where hm.user_id=(select auth.uid()) and hm.active)
  or exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=(select auth.uid()) and r.role_code in ('root','platform_agent')))
$$;
revoke all on function private.has_training_access(uuid) from public,anon;
grant execute on function private.has_training_access(uuid) to authenticated;

alter policy facilities_visible on public.facilities using(private.is_platform_root() or private.is_facility_member(id) or private.has_training_access(id));
alter policy facility_departments_visible on public.facility_departments using(private.is_platform_root() or private.is_facility_member(facility_id) or private.has_training_access(facility_id));
alter policy facility_services_visible on public.facility_services using(private.is_platform_root() or private.is_facility_member(facility_id) or private.has_training_access(facility_id));

alter table public.facility_staff_teams enable row level security; alter table public.facility_staff_team_members enable row level security; alter table public.staff_shifts enable row level security; alter table public.facility_tasks enable row level security;
create policy staff_teams_access on public.facility_staff_teams for all to authenticated using(private.is_aal2() and (private.is_facility_member(facility_id) or private.has_training_access(facility_id))) with check(private.is_aal2() and (private.is_facility_member(facility_id) or private.has_training_access(facility_id)));
create policy team_members_access on public.facility_staff_team_members for all to authenticated using(private.is_aal2() and exists(select 1 from public.facility_staff_teams t where t.id=team_id and (private.is_facility_member(t.facility_id) or private.has_training_access(t.facility_id)))) with check(private.is_aal2() and exists(select 1 from public.facility_staff_teams t where t.id=team_id and (private.is_facility_member(t.facility_id) or private.has_training_access(t.facility_id))));
create policy staff_shifts_access on public.staff_shifts for all to authenticated using(private.is_aal2() and (private.is_facility_member(facility_id) or private.has_training_access(facility_id))) with check(private.is_aal2() and (private.is_facility_member(facility_id) or private.has_training_access(facility_id)));
create policy facility_tasks_access on public.facility_tasks for all to authenticated using(private.is_aal2() and (private.is_facility_member(facility_id) or private.has_training_access(facility_id))) with check(private.is_aal2() and (private.is_facility_member(facility_id) or private.has_training_access(facility_id)));
grant select,insert,update,delete on public.facility_staff_teams,public.facility_staff_team_members,public.staff_shifts,public.facility_tasks to authenticated;
create index staff_shifts_facility_schedule_idx on public.staff_shifts(facility_id,starts_at); create index facility_tasks_facility_due_idx on public.facility_tasks(facility_id,status,due_at);

create or replace function public.facility_staff_directory(target_facility uuid) returns table(user_id uuid,display_name text,email text) language sql stable security definer set search_path='' as $$
 select distinct p.user_id,p.display_name,p.email from public.profiles p where (private.is_facility_member(target_facility) or private.has_training_access(target_facility)) and (
  exists(select 1 from public.facility_memberships fm where fm.facility_id=target_facility and fm.user_id=p.user_id and fm.active)
  or (private.has_training_access(target_facility) and (exists(select 1 from public.facility_memberships fm where fm.user_id=p.user_id and fm.active) or exists(select 1 from public.health_department_memberships hm where hm.user_id=p.user_id and hm.active) or exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p.user_id and r.role_code in ('root','platform_agent'))))
 )
$$;
revoke all on function public.facility_staff_directory(uuid) from public,anon;
grant execute on function public.facility_staff_directory(uuid) to authenticated;

with root_account as (select ur.user_id,u.email from public.user_roles ur join public.roles r on r.id=ur.role_id join auth.users u on u.id=ur.user_id where r.role_code='root' order by ur.user_id limit 1)
insert into public.facilities(name,slug,owner_user_id,owner_name,owner_email,owner_phone,emergency_contact_name,emergency_contact_email,emergency_contact_phone,street_address,city_name,state_province,postal_code,country_name,facility_type,is_training)
select 'Demo Hospital','demo-hospital',user_id,'Healthcarology Training Administrator',email,'Training only','Healthcarology Training Support',email,'Training only','Training environment','Training environment','Training environment','00000','Training environment','Hospital',true from root_account on conflict(slug) do nothing;
insert into public.facility_departments(facility_id,department_id) select f.id,d.id from public.facilities f cross join public.departments d where f.slug='demo-hospital' and f.is_training on conflict do nothing;
insert into public.facility_services(facility_id,service_id) select f.id,s.id from public.facilities f cross join public.services s where f.slug='demo-hospital' and f.is_training on conflict do nothing;
insert into public.facility_staff_teams(facility_id,name,description,created_by) select f.id,'All Demo Hospital Staff','Training team available to authorized training users.',f.owner_user_id from public.facilities f where f.slug='demo-hospital' and f.is_training on conflict do nothing;
