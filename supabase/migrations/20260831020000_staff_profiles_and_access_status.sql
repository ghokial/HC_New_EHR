alter table public.profiles add column if not exists staff_group text;
alter table public.profiles add column if not exists staff_subgroup text;
alter table public.profiles add column if not exists access_suspended_until timestamptz;
alter table public.profiles add column if not exists access_permanently_denied boolean not null default false;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists credentials text;
create index if not exists profiles_staff_access_status_idx on public.profiles(access_permanently_denied,access_suspended_until);
alter table public.profiles add constraint profiles_access_status_check check (not access_permanently_denied or access_suspended_until is null);
