-- Expanded only from Departments_&_Services Major Hospital.docx.
insert into public.departments(code,name,type) values
 ('primary_ambulatory','Primary Care & Ambulatory Services','clinical'),('specialty_centers','Specialty Centers','clinical'),('research_education','Research & Education','support'),('hospital_administration','Hospital Administration','support')
on conflict(code) do update set name=excluded.name,type=excluded.type;

with seed(dept,service) as (values
('em_crit','Surgical ICU (SICU)'),('em_crit','Rapid Response Team'),('em_crit','Transport / Ambulance Services'),
('surgery','Plastic & Reconstructive Surgery'),('surgery','ENT / Otolaryngology Surgery'),('surgery','Trauma Surgery'),('surgery','Transplant Surgery (Kidney, Liver, Heart, Lung)'),('surgery','Robotic Surgery Program'),('surgery','Pre-operative Services'),('surgery','Post-operative Recovery (PACU)'),
('medicine','Allergy & Immunology'),('medicine','Geriatrics'),('medicine','Dermatology'),('medicine','Neurology'),
('womens_health','Obstetrics (Labor & Delivery)'),('womens_health','Neonatal ICU (NICU)'),
('pediatrics','Pediatric Surgery'),('pediatrics','Pediatric Oncology'),('pediatrics','Pediatric Cardiology'),
('radiology','CT Scan'),('radiology','Fluoroscopy'),('radiology','Nuclear Medicine'),('radiology','Mammography & Breast Imaging'),('radiology','Cardiac Imaging (Echo, Stress Test)'),
('lab_path','Clinical Laboratory'),('lab_path','Hematology Lab'),('lab_path','Chemistry Lab'),('lab_path','Blood Bank / Transfusion Services'),('lab_path','Pathology & Histology'),('lab_path','Cytology'),('lab_path','Molecular Diagnostics'),('lab_path','Genetic Testing'),
('oncology','Chemotherapy Infusion Center'),('oncology','Bone Marrow Transplant Unit'),('oncology','Oncology Pharmacy'),('oncology','Cancer Navigation Services'),('oncology','Palliative Oncology'),
('behavioral','Addiction Medicine'),('behavioral','Inpatient Behavioral Health Unit'),('behavioral','Outpatient Mental Health Clinic'),('behavioral','Crisis Stabilization Unit'),
('rehab','Speech & Language Therapy'),('rehab','Respiratory Therapy'),('rehab','Cardiac Rehabilitation'),('rehab','Stroke Rehabilitation'),('rehab','Prosthetics & Orthotics'),
('pharmacy','Clinical Pharmacists'),('pharmacy','Medication Therapy Management'),('pharmacy','Sterile Compounding Unit'),
('primary_ambulatory','Family Medicine'),('primary_ambulatory','Internal Medicine Clinics'),('primary_ambulatory','Urgent Care'),('primary_ambulatory','Specialty Clinics'),('primary_ambulatory','Telemedicine Services'),('primary_ambulatory','Home Health Services'),
('specialty_centers','Heart & Vascular Institute'),('specialty_centers','Stroke Center'),('specialty_centers','Diabetes Center'),('specialty_centers','Pain Management Center'),('specialty_centers','Sleep Medicine Center'),('specialty_centers','Spine Center'),('specialty_centers','Bariatric Surgery Center'),('specialty_centers','Wound Care Center'),
('support','Patient Advocacy'),('support','Interpreter Services'),('support','Nutrition & Dietary Services'),('support','Facilities & Engineering'),('support','Supply Chain / Materials Management'),('support','Sterile Processing Department (SPD)'),
('research_education','Clinical Research Department'),('research_education','Institutional Review Board (IRB)'),('research_education','Medical Education (Residents & Fellows)'),('research_education','Nursing Education'),('research_education','Simulation Center'),('research_education','Research Laboratories'),
('hospital_administration','Executive Leadership (CEO, COO, CMO, CNO)'),('hospital_administration','Human Resources'),('hospital_administration','Finance'),('hospital_administration','Legal & Compliance'),('hospital_administration','Quality & Patient Safety'),('hospital_administration','Risk Management'),('hospital_administration','Strategic Planning'),('hospital_administration','Community Outreach')
)
insert into public.services(department_id,name)
select d.id,s.service from seed s join public.departments d on d.code=s.dept where not exists(select 1 from public.services x where x.department_id=d.id and x.name=s.service);

insert into public.facility_departments(facility_id,department_id) select f.id,d.id from public.facilities f cross join public.departments d where f.is_training on conflict do nothing;
insert into public.facility_services(facility_id,service_id) select f.id,s.id from public.facilities f cross join public.services s where f.is_training on conflict do nothing;
