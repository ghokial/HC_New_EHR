create schema if not exists private;
create table if not exists private.platform_settings (setting_key text primary key, setting_value text not null);
revoke all on schema private from public,anon,authenticated;
revoke all on private.platform_settings from public,anon,authenticated;

create or replace function public.bootstrap_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(user_id,email,display_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)));
  if lower(new.email)=lower(coalesce((select setting_value from private.platform_settings where setting_key='root_email'),'')) then
    insert into public.user_roles(user_id,role_id,scope)
    select new.id,id,'global' from public.roles where role_code='root' on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function public.bootstrap_profile() from public,anon,authenticated;
