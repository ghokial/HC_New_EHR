with nephrology_department as (
  select id from public.departments where lower(name)='nephrology' limit 1
)
insert into public.services(department_id,name,service_type)
select department_id,service_name,'clinical'
from (select id as department_id from nephrology_department) department
cross join (values ('Nephrology'),('Dialysis')) as requested(service_name)
where not exists (
  select 1 from public.services existing
  where existing.department_id=department.department_id
    and lower(existing.name)=lower(requested.service_name)
);

insert into public.facility_services(facility_id,service_id)
select facility_department.facility_id,service.id
from public.facility_departments facility_department
join public.departments department on department.id=facility_department.department_id
join public.services service on service.department_id=department.id
where lower(department.name)='nephrology'
  and lower(service.name) in ('nephrology','dialysis')
on conflict do nothing;
