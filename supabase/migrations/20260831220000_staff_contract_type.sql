alter table public.staff_professional_profiles
  add column if not exists contract_type text
  check (contract_type in ('Hourly staff','Salaried','Contractor'));
