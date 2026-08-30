alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_lower_idx on public.profiles(lower(username)) where username is not null;
grant select(username) on public.profiles to anon,authenticated;
create or replace function public.resolve_login_identifier(identifier text) returns text language sql security definer set search_path='' as $$
 select p.email from public.profiles p where lower(p.username)=lower(btrim(identifier)) or lower(p.email)=lower(btrim(identifier)) limit 1
$$;
revoke all on function public.resolve_login_identifier(text) from public,anon;grant execute on function public.resolve_login_identifier(text) to anon,authenticated;
