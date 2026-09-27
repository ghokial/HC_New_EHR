-- Clinical notes could never be saved: no provider rows were ever created, and
-- the note policies compared against a provider_id claim that nothing sets.

-- 1. Every clinical facility member gets a provider record automatically.
create or replace function private.ensure_clinical_provider() returns trigger language plpgsql security definer set search_path='' as $$
declare code text;
begin
 select r.role_code into code from public.roles r where r.id=new.role_id;
 if new.active and code in ('physician','resident','advanced_practice','nurse','therapist','pharmacist','lab_tech','lab_supervisor','rad_tech') then
  insert into public.providers(user_id,provider_type,active) values(new.user_id,code,true)
  on conflict(user_id) do update set active=true;
 end if;
 return new;
end $$;
revoke all on function private.ensure_clinical_provider() from public,anon,authenticated;
drop trigger if exists ensure_clinical_provider on public.facility_memberships;
create trigger ensure_clinical_provider after insert or update of role_id,active on public.facility_memberships for each row execute function private.ensure_clinical_provider();

insert into public.providers(user_id,provider_type,active)
select distinct on (fm.user_id) fm.user_id,r.role_code,true
from public.facility_memberships fm join public.roles r on r.id=fm.role_id
where fm.active and r.role_code in ('physician','resident','advanced_practice','nurse','therapist','pharmacist','lab_tech','lab_supervisor','rad_tech')
order by fm.user_id,r.access_level desc
on conflict(user_id) do nothing;

-- 2. The signed-in user's provider id comes from the providers table.
create or replace function public.current_provider_id() returns bigint language sql stable security invoker set search_path='' as $$
 select p.id from public.providers p where p.user_id=(select auth.uid()) and p.active limit 1
$$;

-- 3. Remove the original insert policy: it used a global role instead of the
-- patient's facility. clinical_notes_staff_insert remains and is facility-scoped.
drop policy if exists clinical_notes_author_insert on public.clinical_notes;

-- 4. A signed note is final. Corrections are written as a new note.
create or replace function private.protect_signed_note() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status='signed' then new.signed_at=coalesce(new.signed_at,now()); else new.signed_at=null; end if;
  return new;
 end if;
 if old.status in ('signed','amended') then
  raise exception 'Signed notes cannot be changed; write an addendum as a new note';
 end if;
 if new.patient_id<>old.patient_id or new.author_provider_id is distinct from old.author_provider_id then
  raise exception 'Note patient and author cannot be changed';
 end if;
 if new.status='signed' then new.signed_at=now(); end if;
 return new;
end $$;
revoke all on function private.protect_signed_note() from public,anon,authenticated;
drop trigger if exists protect_signed_note on public.clinical_notes;
create trigger protect_signed_note before insert or update on public.clinical_notes for each row execute function private.protect_signed_note();
revoke delete on public.clinical_notes from anon,authenticated;
