-- Resolve recursive RLS evaluation: user_roles policies call current_role_code,
-- so the underlying role lookup must read user_roles outside its own policies.
create or replace function private.current_role_code()
returns text
language sql
stable
security definer
set search_path=''
as $$
  select coalesce((
    select r.role_code
    from public.user_roles ur
    join public.roles r on r.id=ur.role_id
    where ur.user_id=(select auth.uid())
    order by r.access_level desc
    limit 1
  ),'')
$$;

revoke all on function private.current_role_code() from public,anon;
grant execute on function private.current_role_code() to authenticated;

create or replace function public.current_role_code()
returns text
language sql
stable
security invoker
set search_path=''
as $$ select private.current_role_code() $$;

revoke all on function public.current_role_code() from public,anon;
grant execute on function public.current_role_code() to authenticated;
