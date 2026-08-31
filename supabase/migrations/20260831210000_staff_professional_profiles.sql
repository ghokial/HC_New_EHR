create table if not exists public.staff_professional_profiles(
  user_id uuid primary key references auth.users(id) on delete cascade,
  legal_name text,
  aliases text,
  date_of_birth date,
  gender text,
  citizenship_work_authorization text,
  home_address text,
  mailing_address text,
  personal_email text,
  personal_phone text,
  emergency_contact text,
  languages_spoken text,
  employee_id text,
  primary_department text,
  npi text,
  state_licenses text,
  license_expirations text,
  dea_registration text,
  board_certifications text,
  education text,
  postgraduate_training text,
  clinical_specialties text,
  accepted_insurance text,
  professional_bio text,
  work_history text,
  liability_insurance text,
  hospital_privileges text,
  clinical_certifications text,
  scheduling_logic text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.staff_professional_profiles enable row level security;
revoke all on public.staff_professional_profiles from public,anon,authenticated;
create index if not exists staff_professional_profiles_employee_id_idx on public.staff_professional_profiles(employee_id) where employee_id is not null;
create index if not exists staff_professional_profiles_npi_idx on public.staff_professional_profiles(npi) where npi is not null;
