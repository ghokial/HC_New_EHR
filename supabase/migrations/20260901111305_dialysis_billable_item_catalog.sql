-- Dialysis billable-item catalog. Seed values are limited to the codes supplied by the user.
create table public.dialysis_billable_items (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid references public.facilities(id) on delete cascade,
  code_type text not null check (code_type in ('REVENUE','CPT','HCPCS')),
  code text not null,
  description text not null,
  billing_note text,
  related_revenue_codes text[] not null default '{}'::text[],
  is_custom boolean not null default false,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check ((facility_id is null and not is_custom and created_by is null) or (facility_id is not null and is_custom and created_by is not null))
);
create unique index dialysis_billable_global_code_unique on public.dialysis_billable_items(code_type,code) where facility_id is null;
create unique index dialysis_billable_facility_code_unique on public.dialysis_billable_items(facility_id,code_type,code) where facility_id is not null;
create index dialysis_billable_facility_active_idx on public.dialysis_billable_items(facility_id,code_type,code) where active;

create table public.dialysis_session_billable_items (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  session_id bigint not null references public.dialysis_sessions(id) on delete cascade,
  billable_item_id uuid not null references public.dialysis_billable_items(id),
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_amount numeric(12,2) check (unit_amount is null or unit_amount >= 0),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index dialysis_session_billables_session_idx on public.dialysis_session_billable_items(session_id,created_at desc);

insert into public.dialysis_billable_items(code_type,code,description,billing_note,related_revenue_codes) values
('REVENUE','0821','Hemodialysis – Outpatient / In-Facility','Standard clinic chair run; max 13/14 per month.','{}'),
('REVENUE','0829','Hemodiafiltration','New CMS Rule: Required when billing hemodiafiltration.','{}'),
('REVENUE','0831','Peritoneal Dialysis – Intermittent','Waste removed indirectly via peritoneal membrane.','{}'),
('REVENUE','0841','Continuous Ambulatory Peritoneal Dialysis (CAPD)','Home or outpatient continuous self-dialysis.','{}'),
('REVENUE','0851','Continuous Cycling Peritoneal Dialysis (CCPD)','Home automated cycler tracking.','{}'),
('REVENUE','0881','Ultrafiltration (Isolated)','Fluid removal performed separately from full dialysis.','{}'),
('REVENUE','0809','Continuous Renal Replacement Therapy (CRRT)','Used for acute inpatient ICU therapies.','{}'),
('CPT','90960','Full monthly ESRD services; patient age 20+','4 or more face-to-face visits.','{}'),
('CPT','90961','Full monthly ESRD services; patient age 20+','2 to 3 face-to-face visits.','{}'),
('CPT','90962','Full monthly ESRD services; patient age 20+','1 face-to-face visit.','{}'),
('CPT','90935','Hemodialysis procedure','Single physician evaluation.','{}'),
('CPT','90937','Hemodialysis procedure','Repeated evaluations during the treatment.','{}'),
('CPT','90945','Dialysis procedure other than hemodialysis','Peritoneal or other non-hemodialysis procedure; single physician evaluation.','{}'),
('CPT','90999','Unlisted dialysis procedure','Must be paired with Revenue Code 0821 or 0829 for routine institutional lines.',array['0821','0829']),
('HCPCS','G0491','Dialysis procedure at a Medicare-certified facility','For Acute Kidney Injury (AKI).','{}'),
('HCPCS','J0882','Injection, Darbepoetin Alfa (Aranesp), 1 mcg','Anemia management ESA.',array['0636']),
('HCPCS','J0885','Injection, Epoetin Alfa (Epogen), 100 units','Anemia management ESA.',array['0634','0635']),
('HCPCS','Q5105','Injection, Epoetin Alfa-EPBX, Biosimilar (Retacrit), 100 units',null,'{}'),
('HCPCS','J0606','Injection, Etelcalcetide (Parsabiv), 0.1 mg','Calcimimetic.','{}'),
('HCPCS','J1644','Injection, Heparin Sodium, per 1,000 units','Vascular access anticoagulation.','{}'),
('HCPCS','J2997','Injection, Alteplase recombinant (Activase/Cathflo), 1 mg','Used for declotting catheters.','{}');

alter table public.dialysis_billable_items enable row level security;
alter table public.dialysis_session_billable_items enable row level security;
create policy dialysis_billable_items_read on public.dialysis_billable_items for select to authenticated using (facility_id is null or private.is_platform_root() or private.is_facility_member(facility_id));
create policy dialysis_billable_items_insert on public.dialysis_billable_items for insert to authenticated with check (facility_id is not null and is_custom and created_by=(select auth.uid()) and (private.is_platform_root() or private.is_facility_admin(facility_id)));
create policy dialysis_billable_items_update on public.dialysis_billable_items for update to authenticated using (facility_id is not null and (private.is_platform_root() or private.is_facility_admin(facility_id))) with check (facility_id is not null and is_custom and (private.is_platform_root() or private.is_facility_admin(facility_id)));
create policy dialysis_session_billables_access on public.dialysis_session_billable_items for all to authenticated using (private.is_platform_root() or private.is_facility_member(facility_id)) with check (created_by=(select auth.uid()) and (private.is_platform_root() or private.is_facility_member(facility_id)));
revoke all on public.dialysis_billable_items, public.dialysis_session_billable_items from anon,authenticated;
grant select,insert,update on public.dialysis_billable_items to authenticated;
grant select,insert,update,delete on public.dialysis_session_billable_items to authenticated;
