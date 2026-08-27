-- Live-platform additions: user profiles, documented role catalog, bootstrap Root,
-- complete department/service seed, and secure create/update access.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create schema if not exists private;
create table private.platform_settings (setting_key text primary key, setting_value text not null);
revoke all on schema private from public,anon,authenticated;
revoke all on private.platform_settings from public,anon,authenticated;

insert into public.roles (role_code, role_name, description, access_level) values
('patient','Patient (Portal)','Own chart and explicitly delegated family records',0),
('registration','Registration / Front Desk','Demographics, insurance, and scheduling',1),
('billing','Billing / Coder','Claims, coding, insurance, and financial records',1),
('therapist','Therapist','Department-scoped therapy notes and plans',2),
('lab_tech','Laboratory Technician','Lab orders, specimens, and results',2),
('rad_tech','Radiology Technician','Imaging orders and reports',2),
('physician','Attending Physician','Full chart, notes, orders, medications, and discharge',3),
('resident','Resident / Fellow','Clinical access with supervised prescribing',3),
('nurse','Nurse (RN/LPN)','Medication administration, vitals, nursing notes, and care plans',3),
('advanced_practice','Advanced Practice (NP/PA)','Clinical access and prescribing per scope',3),
('pharmacist','Pharmacist','Medication profiles, interactions, verification, and orders',3),
('case_manager','Case Manager / Social Work','Care plans, discharge planning, and social notes',3),
('him','HIM / Medical Records','Chart compliance, correction, and release of information',4),
('compliance','Compliance / Privacy','Investigations, audit logs, and legal review',4),
('clinical_informatics','Clinical Informatics','EHR workflow, template, and configuration oversight',5),
('it_support','IT Support','Troubleshooting with limited patient access',5),
('sysadmin','System Administrator','Backend, logs, provisioning, and monitored technical access',5),
('executive','Executive Leadership','Aggregated clinical, operational, and financial dashboards',6),
('root','Root Administrator','Break-glass infrastructure and platform administration',6)
on conflict (role_code) do update set role_name=excluded.role_name, description=excluded.description, access_level=excluded.access_level;

insert into public.role_permissions(role_id,view_demographics,view_clinical,edit_clinical,order_prescribe,billing_access,admin_users,system_config,audit_logs)
select id,
  case role_code when 'patient' then 'limited' when 'it_support' then 'limited' when 'sysadmin' then 'limited' when 'executive' then 'limited' else 'full' end,
  case when role_code in ('registration','it_support') then 'none' when role_code in ('patient','billing','therapist','lab_tech','rad_tech','pharmacist','case_manager','clinical_informatics','sysadmin','executive') then 'limited' else 'full' end,
  case when role_code in ('physician','resident','advanced_practice') then 'full' when role_code in ('patient','registration','therapist','lab_tech','rad_tech','nurse','pharmacist','case_manager','clinical_informatics','sysadmin') then 'limited' else 'none' end,
  case when role_code in ('physician','advanced_practice') then 'full' when role_code in ('resident','pharmacist') then 'limited' else 'none' end,
  case when role_code='billing' then 'full' when role_code in ('patient','registration','compliance','executive') then 'limited' else 'none' end,
  case when role_code in ('sysadmin','root') then 'full' when role_code in ('it_support','clinical_informatics') then 'limited' else 'none' end,
  case when role_code in ('sysadmin','root') then 'full' when role_code in ('it_support','clinical_informatics') then 'limited' else 'none' end,
  case when role_code in ('him','compliance','sysadmin','root') then 'full' when role_code in ('physician','resident','nurse','advanced_practice','pharmacist','billing','it_support','clinical_informatics','executive') then 'limited' else 'none' end
from public.roles
on conflict(role_id) do update set view_demographics=excluded.view_demographics,view_clinical=excluded.view_clinical,edit_clinical=excluded.edit_clinical,order_prescribe=excluded.order_prescribe,billing_access=excluded.billing_access,admin_users=excluded.admin_users,system_config=excluded.system_config,audit_logs=excluded.audit_logs;

create or replace function public.current_role_code() returns text language sql stable security invoker set search_path='' as $$
  select coalesce((select r.role_code from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=(select auth.uid()) order by r.access_level desc limit 1),'')
$$;

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
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.bootstrap_profile();

create policy profiles_self_read on public.profiles for select to authenticated using(user_id=(select auth.uid()) or public.current_role_code() in ('root','sysadmin'));
create policy profiles_admin_update on public.profiles for update to authenticated using(public.current_role_code() in ('root','sysadmin')) with check(public.current_role_code() in ('root','sysadmin'));
create policy roles_authenticated_read on public.roles for select to authenticated using(true);
create policy permissions_authenticated_read on public.role_permissions for select to authenticated using(true);
create policy user_roles_admin_all on public.user_roles for all to authenticated using(public.current_role_code() in ('root','sysadmin')) with check(public.current_role_code() in ('root','sysadmin'));

drop policy if exists patients_staff_read on public.patients;
create policy patients_staff_read on public.patients for select to authenticated using(public.current_role_code() in ('root','physician','resident','nurse','advanced_practice','pharmacist','therapist','lab_tech','rad_tech','billing','case_manager','him','compliance','clinical_informatics','sysadmin'));
create policy patients_create on public.patients for insert to authenticated with check(public.current_role_code() in ('root','registration','physician','resident','nurse','advanced_practice','him','sysadmin'));
create policy patients_update on public.patients for update to authenticated using(public.current_role_code() in ('root','registration','physician','resident','nurse','advanced_practice','him','sysadmin')) with check(public.current_role_code() in ('root','registration','physician','resident','nurse','advanced_practice','him','sysadmin'));

create policy departments_read on public.departments for select to authenticated using(true);
create policy services_read on public.services for select to authenticated using(true);
create policy countries_admin_write on public.countries for all to authenticated using(public.current_role_code()='root') with check(public.current_role_code()='root');
create policy departments_admin_write on public.departments for all to authenticated using(public.current_role_code() in ('root','sysadmin','clinical_informatics')) with check(public.current_role_code() in ('root','sysadmin','clinical_informatics'));
create policy services_admin_write on public.services for all to authenticated using(public.current_role_code() in ('root','sysadmin','clinical_informatics')) with check(public.current_role_code() in ('root','sysadmin','clinical_informatics'));

grant select,insert,update on public.patients to authenticated;
grant select,update on public.profiles to authenticated;
grant select on public.roles,public.role_permissions,public.user_roles,public.departments,public.services to authenticated;
grant insert,update,delete on public.user_roles,public.departments,public.services to authenticated;
grant usage,select on all sequences in schema public to authenticated;

insert into public.departments(code,name,type) values
('em_crit','Emergency & Critical Care','clinical'),('surgery','Surgery','clinical'),('medicine','Medicine','clinical'),('oncology','Cancer Center','clinical'),('womens_health','Women''s Health','clinical'),('pediatrics','Pediatrics','clinical'),('behavioral','Behavioral Health','clinical'),('rehab','Rehabilitation','clinical'),('radiology','Radiology & Imaging','diagnostic'),('lab_path','Laboratory & Pathology','diagnostic'),('pharmacy','Pharmacy','clinical'),('support','Support Services','support')
on conflict(code) do update set name=excluded.name,type=excluded.type;

with seed(dept,service) as (values
('em_crit','Emergency Department'),('em_crit','Trauma Center'),('em_crit','Adult ICU'),('em_crit','Cardiac ICU'),('em_crit','Neuro ICU'),('em_crit','Burn Unit'),
('surgery','General Surgery'),('surgery','Cardiothoracic Surgery'),('surgery','Orthopedic Surgery'),('surgery','Neurosurgery'),('surgery','Plastic Surgery'),('surgery','ENT Surgery'),('surgery','Ophthalmologic Surgery'),('surgery','Vascular Surgery'),('surgery','Transplant Surgery'),('surgery','Pre-Op'),('surgery','PACU'),
('medicine','Internal Medicine'),('medicine','Cardiology'),('medicine','Pulmonology'),('medicine','Gastroenterology'),('medicine','Nephrology'),('medicine','Endocrinology'),('medicine','Rheumatology'),('medicine','Infectious Diseases'),('medicine','Hematology'),('medicine','Hospital Medicine'),
('oncology','Medical Oncology'),('oncology','Radiation Oncology'),('oncology','Surgical Oncology'),('oncology','Infusion Center'),('oncology','Bone Marrow Transplant'),
('womens_health','Obstetrics'),('womens_health','Gynecology'),('womens_health','Maternal-Fetal Medicine'),
('pediatrics','General Pediatrics'),('pediatrics','PICU'),('pediatrics','NICU'),('pediatrics','Pediatric Subspecialties'),
('behavioral','Psychiatry'),('behavioral','Psychology'),('behavioral','Addiction Services'),
('rehab','Physical Therapy'),('rehab','Occupational Therapy'),('rehab','Speech Therapy'),('rehab','Cardiac Rehab'),('rehab','Stroke Rehab'),
('radiology','X-ray'),('radiology','CT'),('radiology','MRI'),('radiology','Ultrasound'),('radiology','Interventional Radiology'),('radiology','Mammography'),
('lab_path','Core Lab'),('lab_path','Microbiology'),('lab_path','Blood Bank'),('lab_path','Anatomic Pathology'),
('pharmacy','Inpatient Pharmacy'),('pharmacy','Outpatient Pharmacy'),('pharmacy','Clinical Pharmacy'),
('support','Admissions & Registration'),('support','Medical Records'),('support','Billing & Insurance'),('support','Case Management'),('support','Social Work'),('support','Nutrition'),('support','Environmental Services'),('support','Facilities'),('support','Security'),('support','IT & Informatics'),('support','Quality & Safety'),('support','HR'),('support','Legal & Compliance'),('support','Community Outreach'),('support','Research & Education')
)
insert into public.services(department_id,name)
select d.id,s.service from seed s join public.departments d on d.code=s.dept
where not exists(select 1 from public.services x where x.department_id=d.id and x.name=s.service);
