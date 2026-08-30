alter table public.health_jurisdictions add column if not exists province_name text;
alter table public.health_jurisdictions add column if not exists city_name text;

create or replace function private.jurisdiction_contains(root_jurisdiction uuid,target_jurisdiction uuid) returns boolean language sql stable security definer set search_path='' as $$
  with recursive tree as (
    select id from public.health_jurisdictions where id=root_jurisdiction and active
    union all
    select child.id from public.health_jurisdictions child join tree parent on child.parent_id=parent.id where child.active
  ) select exists(select 1 from tree where id=target_jurisdiction)
$$;
revoke all on function private.jurisdiction_contains(uuid,uuid) from public,anon,authenticated;

drop policy if exists heatmap_authorized_read on public.health_heatmap_observations;
create policy heatmap_authorized_read on public.health_heatmap_observations for select to authenticated using(
  private.is_aal2() and (
    private.is_platform_root()
    or (facility_id is not null and private.is_facility_member(facility_id))
    or exists(
      select 1 from public.health_department_memberships hm
      where hm.user_id=(select auth.uid()) and hm.active
        and private.jurisdiction_contains(hm.jurisdiction_id,health_heatmap_observations.jurisdiction_id)
    )
  )
);

comment on function private.jurisdiction_contains(uuid,uuid) is 'Tests jurisdiction ancestry for aggregate public-health reporting only; it grants no patient-record access.';
