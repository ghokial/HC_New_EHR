-- Every authenticated patient account must carry the patient role so the
-- portal routes it to the patient workspace instead of a facility workspace.
insert into public.user_roles (user_id, role_id, scope)
select distinct
  pa.user_id,
  r.id,
  'patient'
from public.patient_accounts pa
join public.roles r on r.role_code = 'patient'
on conflict (user_id, role_id) do nothing;
