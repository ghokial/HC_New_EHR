create or replace function private.message_thread_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.message_participants(thread_id,user_id,participant_role) values(new.id,new.created_by,'owner');
 return new;
end $$;
create trigger message_thread_owner after insert on public.message_threads for each row execute function private.message_thread_owner();

insert into public.support_groups(name,group_type)
select 'Healthcarology Support','healthcarology'
where not exists(select 1 from public.support_groups where facility_id is null and name='Healthcarology Support');

with root_user as (
 select ur.user_id from public.user_roles ur join public.roles r on r.id=ur.role_id where r.role_code='root' order by ur.user_id limit 1
), seeds(title,description) as (values
 ('ADHD','Peer community for ADHD-related discussion.'),('Alzheimer','Peer community for Alzheimer-related discussion.'),
 ('Asthma','Peer community for asthma-related discussion.'),('Blood Pressure Disorder','Peer community for blood-pressure-related discussion.'),
 ('Diabetes','Peer community for diabetes-related discussion.'),('Nutrition','Peer community for nutrition-related discussion.'),
 ('Sickle Cell Disease','Peer community for sickle-cell-related discussion.'),('Weight Disorder','Peer community for weight-disorder-related discussion.'),
 ('Weight Loss','Peer community for weight-loss-related discussion.')
)
insert into public.communities(title,description,visibility,status,created_by)
select s.title,s.description,'public','active',r.user_id from seeds s cross join root_user r on conflict(title) do nothing;

-- A restrictive MFA policy is combined with the existing ownership/role policies.
do $$ declare t text; begin
 foreach t in array array[
  'addresses','profiles','user_roles','patients','family_links','providers','encounters','orders','lab_orders','imaging_orders','procedure_orders','lab_results','imaging_results','procedure_results',
  'medication_orders','medication_administrations','clinical_notes','patient_accounts','patient_proxies','audit_logs','facilities','facility_memberships','facility_departments','facility_services','patient_link_invitations',
  'facility_patient_mrns','prescription_interaction_alerts','diagnoses','integration_endpoints','pharmacy_locations','medication_inventory_lots','inventory_movements','prescription_fulfillments','medication_adherence_events','medication_refill_requests',
  'provider_availability_slots','appointments','dialysis_prescriptions','dialysis_sessions','surgical_cases','surgical_case_team','surgical_checklist_items','surgical_events'
 ] loop
  execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using (private.is_aal2()) with check (private.is_aal2())',t);
 end loop;
end $$;
