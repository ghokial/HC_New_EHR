alter table public.encounter_clinical_workflows
  add column if not exists prescription text,
  add column if not exists treatment_plan text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists follow_up_notes text,
  add column if not exists patient_status text,
  add column if not exists encounter_action text,
  add column if not exists action_destination text;

alter table public.encounter_clinical_workflows drop constraint if exists encounter_clinical_workflows_current_step_check;
alter table public.encounter_clinical_workflows add constraint encounter_clinical_workflows_current_step_check
  check(current_step in ('subjective','objective','assessment','plan','physical_exam','presumed_diagnosis','laboratory','imaging','diagnosis','prescription','treatment_plan','follow_up','conclusion','complete'));

alter table public.encounter_clinical_workflows drop constraint if exists encounter_clinical_workflows_patient_status_check;
alter table public.encounter_clinical_workflows add constraint encounter_clinical_workflows_patient_status_check
  check(patient_status is null or patient_status in ('outpatient','hospitalization','deceased'));

alter table public.encounter_clinical_workflows drop constraint if exists encounter_clinical_workflows_encounter_action_check;
alter table public.encounter_clinical_workflows add constraint encounter_clinical_workflows_encounter_action_check
  check(encounter_action is null or encounter_action in ('refer','admit','transfer'));
