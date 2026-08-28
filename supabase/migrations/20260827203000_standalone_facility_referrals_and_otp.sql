-- Stand-alone pharmacy, laboratory, and imaging workflows with explicit patient consent.

create extension if not exists pgcrypto with schema extensions;

create table public.facility_operational_settings(
 facility_id uuid primary key references public.facilities(id) on delete cascade,
 inventory_visibility text not null default 'private' check(inventory_visibility in ('private','hospitals')),
 show_inventory_prices boolean not null default false,
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
alter table public.medication_inventory_lots add column if not exists public_price numeric(14,4) check(public_price is null or public_price>=0);

create table public.patient_preferred_facilities(
 patient_id bigint not null references public.patients(id) on delete cascade,
 facility_id uuid not null references public.facilities(id) on delete cascade,
 service_type text not null check(service_type in ('pharmacy','laboratory','imaging')),
 active boolean not null default true,consented_at timestamptz not null default now(),created_by uuid not null references auth.users(id),
 primary key(patient_id,service_type)
);

create table public.clinical_service_referrals(
 id uuid primary key default gen_random_uuid(),patient_id bigint not null references public.patients(id),
 source_facility_id uuid references public.facilities(id),target_facility_id uuid not null references public.facilities(id),
 service_type text not null check(service_type in ('pharmacy','laboratory','imaging')),
 medication_order_id bigint references public.medication_orders(id),order_id bigint references public.orders(id),
 status text not null default 'sent' check(status in ('sent','received','in_progress','completed','cancelled')),
 sent_by uuid not null references auth.users(id),sent_at timestamptz not null default now(),received_at timestamptz,completed_at timestamptz,
 check((service_type='pharmacy' and medication_order_id is not null and order_id is null) or (service_type in ('laboratory','imaging') and order_id is not null and medication_order_id is null))
);

create table public.external_record_access_requests(
 id uuid primary key default gen_random_uuid(),patient_id bigint not null references public.patients(id),requesting_facility_id uuid not null references public.facilities(id),
 purpose text not null check(purpose in ('pharmacy','laboratory','imaging')),status text not null default 'awaiting_otp' check(status in ('awaiting_otp','otp_issued','granted','expired','denied','completed')),
 requested_by uuid not null references auth.users(id),requested_at timestamptz not null default now(),granted_until timestamptz,accessed_at timestamptz
);
create table private.patient_access_otps(
 request_id uuid primary key references public.external_record_access_requests(id) on delete cascade,
 otp_hash text not null,expires_at timestamptz not null,attempts smallint not null default 0,verified_at timestamptz
);

alter table public.facility_operational_settings enable row level security;
alter table public.patient_preferred_facilities enable row level security;
alter table public.clinical_service_referrals enable row level security;
alter table public.external_record_access_requests enable row level security;
alter table private.patient_access_otps enable row level security;

insert into public.pharmacy_locations(facility_id,name) select id,'Main Pharmacy' from public.facilities where facility_type='Pharmacy' on conflict do nothing;
insert into public.facility_operational_settings(facility_id) select id from public.facilities where facility_type in ('Pharmacy','Laboratory (Labs)','Imaging Center') on conflict do nothing;

create or replace function private.initialize_standalone_facility() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.facility_type in ('Pharmacy','Laboratory (Labs)','Imaging Center') then insert into public.facility_operational_settings(facility_id) values(new.id) on conflict do nothing;end if;
 if new.facility_type='Pharmacy' then insert into public.pharmacy_locations(facility_id,name) values(new.id,'Main Pharmacy') on conflict do nothing;end if;
 return new;
end $$;
create trigger initialize_standalone_facility after insert on public.facilities for each row execute function private.initialize_standalone_facility();
revoke all on function private.initialize_standalone_facility() from public,anon,authenticated;

create policy operational_settings_member_read on public.facility_operational_settings for select to authenticated using(private.is_facility_member(facility_id));
create policy operational_settings_admin_write on public.facility_operational_settings for all to authenticated using(private.is_aal2() and private.is_facility_admin(facility_id)) with check(private.is_aal2() and private.is_facility_admin(facility_id));
create policy preferred_facilities_patient on public.patient_preferred_facilities for all to authenticated
 using(exists(select 1 from public.patient_accounts pa where pa.patient_id=patient_preferred_facilities.patient_id and pa.user_id=(select auth.uid())))
 with check(exists(select 1 from public.patient_accounts pa where pa.patient_id=patient_preferred_facilities.patient_id and pa.user_id=(select auth.uid())) and created_by=(select auth.uid()));
create policy referrals_target_read on public.clinical_service_referrals for select to authenticated using(private.is_facility_member(target_facility_id) or private.is_facility_member(source_facility_id) or private.is_platform_root());
create policy referrals_source_write on public.clinical_service_referrals for insert to authenticated with check(private.is_aal2() and (private.is_facility_member(source_facility_id) or private.is_platform_root()) and sent_by=(select auth.uid()));
create policy referrals_target_update on public.clinical_service_referrals for update to authenticated using(private.is_aal2() and private.is_facility_member(target_facility_id)) with check(private.is_aal2() and private.is_facility_member(target_facility_id));
create policy access_requests_patient_read on public.external_record_access_requests for select to authenticated using(exists(select 1 from public.patient_accounts pa where pa.patient_id=external_record_access_requests.patient_id and pa.user_id=(select auth.uid())));
create policy access_requests_facility_read on public.external_record_access_requests for select to authenticated using(private.is_facility_member(requesting_facility_id));

create or replace function private.is_standalone_member(fid uuid,required_type text) returns boolean language sql stable security invoker set search_path='' as $$
 select private.is_facility_member(fid) and exists(select 1 from public.facilities f where f.id=fid and ((required_type='pharmacy' and f.facility_type='Pharmacy') or (required_type='laboratory' and f.facility_type='Laboratory (Labs)') or (required_type='imaging' and f.facility_type='Imaging Center')))
$$;

create or replace function public.request_external_patient_access(target_facility uuid,target_last_name text,target_date_of_birth date,requested_purpose text)
returns uuid language plpgsql security definer set search_path='' as $$
declare match_id bigint;result uuid;
begin
 if (select auth.uid()) is null or not private.is_aal2() or not private.is_standalone_member(target_facility,requested_purpose) then raise exception 'Authorized stand-alone facility access required'; end if;
 select p.id into match_id from public.patients p left join public.addresses a on a.id=p.primary_address_id left join public.cities c on c.id=a.city_id left join public.provinces pr on pr.id=a.province_id
 join public.facilities f on f.id=target_facility
 where lower(p.last_name)=lower(btrim(target_last_name)) and p.date_of_birth=target_date_of_birth
 and (lower(coalesce(c.default_name,''))=lower(coalesce(f.city_name,'')) or lower(coalesce(pr.default_name,''))=lower(coalesce(f.state_province,''))) limit 1;
 if match_id is null then raise exception 'No matching patient was found in this facility city or state'; end if;
 insert into public.external_record_access_requests(patient_id,requesting_facility_id,purpose,requested_by) values(match_id,target_facility,requested_purpose,(select auth.uid())) returning id into result;
 return result;
end $$;

create or replace function public.issue_patient_access_otp(access_request uuid)
returns text language plpgsql security definer set search_path='' as $$
declare code text;pid bigint;
begin
 select patient_id into pid from public.external_record_access_requests where id=access_request and status in ('awaiting_otp','otp_issued');
 if pid is null or not exists(select 1 from public.patient_accounts where patient_id=pid and user_id=(select auth.uid())) then raise exception 'Patient authorization required'; end if;
 code=lpad((floor(random()*1000000))::integer::text,6,'0');
 insert into private.patient_access_otps(request_id,otp_hash,expires_at,attempts,verified_at) values(access_request,encode(extensions.digest(code,'sha256'),'hex'),now()+interval '10 minutes',0,null)
 on conflict(request_id) do update set otp_hash=excluded.otp_hash,expires_at=excluded.expires_at,attempts=0,verified_at=null;
 update public.external_record_access_requests set status='otp_issued' where id=access_request;
 return code;
end $$;

create or replace function public.verify_patient_access_otp(access_request uuid,provided_otp text)
returns boolean language plpgsql security definer set search_path='' as $$
declare req public.external_record_access_requests%rowtype;otp private.patient_access_otps%rowtype;
begin
 select * into req from public.external_record_access_requests where id=access_request for update;
 if req.id is null or not private.is_aal2() or not private.is_standalone_member(req.requesting_facility_id,req.purpose) then raise exception 'Authorized facility access required'; end if;
 select * into otp from private.patient_access_otps where request_id=access_request for update;
 if otp.request_id is null or otp.expires_at<=now() or otp.attempts>=5 then update public.external_record_access_requests set status='expired' where id=access_request;return false;end if;
 update private.patient_access_otps set attempts=attempts+1 where request_id=access_request;
 if otp.otp_hash<>encode(extensions.digest(provided_otp,'sha256'),'hex') then return false;end if;
 update private.patient_access_otps set verified_at=now() where request_id=access_request;
 update public.external_record_access_requests set status='granted',granted_until=now()+interval '30 minutes',accessed_at=now() where id=access_request;
 return true;
end $$;

create or replace function public.search_shared_pharmacy_inventory(search_text text)
returns table(facility_id uuid,facility_name text,city_name text,state_province text,medication_name text,strength text,quantity_on_hand numeric,price numeric)
language sql security definer set search_path='' as $$
 select f.id,f.name,f.city_name,f.state_province,m.name,m.strength,sum(l.quantity_on_hand),case when s.show_inventory_prices then min(l.public_price) else null end
 from public.facilities f join public.facility_operational_settings s on s.facility_id=f.id and s.inventory_visibility='hospitals'
 join public.medication_inventory_lots l on l.facility_id=f.id join public.medications m on m.id=l.medication_id
 where (select auth.uid()) is not null and private.is_aal2() and exists(select 1 from public.facility_memberships fm join public.facilities hf on hf.id=fm.facility_id where fm.user_id=(select auth.uid()) and fm.active and hf.facility_type in ('Hospital','Health Center'))
 and l.quantity_on_hand>0 and (m.name ilike '%'||search_text||'%' or coalesce(m.generic_name,'') ilike '%'||search_text||'%')
 group by f.id,f.name,f.city_name,f.state_province,m.name,m.strength,s.show_inventory_prices order by f.name,m.name
$$;

create policy medication_orders_standalone_read on public.medication_orders for select to authenticated using(
 exists(select 1 from public.patient_preferred_facilities pf where pf.patient_id=medication_orders.patient_id and pf.service_type='pharmacy' and pf.active and private.is_standalone_member(pf.facility_id,'pharmacy'))
 or exists(select 1 from public.clinical_service_referrals r where r.medication_order_id=medication_orders.id and private.is_standalone_member(r.target_facility_id,'pharmacy'))
 or exists(select 1 from public.external_record_access_requests ar where ar.patient_id=medication_orders.patient_id and ar.purpose='pharmacy' and ar.status='granted' and ar.granted_until>now() and private.is_standalone_member(ar.requesting_facility_id,'pharmacy'))
);
create policy orders_standalone_read on public.orders for select to authenticated using(
 exists(select 1 from public.patient_preferred_facilities pf where pf.patient_id=orders.patient_id and pf.active and ((pf.service_type='laboratory' and orders.order_type='lab' and private.is_standalone_member(pf.facility_id,'laboratory')) or (pf.service_type='imaging' and orders.order_type='imaging' and private.is_standalone_member(pf.facility_id,'imaging'))))
 or exists(select 1 from public.clinical_service_referrals r where r.order_id=orders.id and ((r.service_type='laboratory' and private.is_standalone_member(r.target_facility_id,'laboratory')) or (r.service_type='imaging' and private.is_standalone_member(r.target_facility_id,'imaging'))))
 or exists(select 1 from public.external_record_access_requests ar where ar.patient_id=orders.patient_id and ((ar.purpose='laboratory' and orders.order_type='lab') or (ar.purpose='imaging' and orders.order_type='imaging')) and ar.status='granted' and ar.granted_until>now() and private.is_standalone_member(ar.requesting_facility_id,ar.purpose))
);

create or replace function private.route_prescription_to_pharmacy_on_file() returns trigger language plpgsql security definer set search_path='' as $$
declare pharmacy_id uuid;
begin
 select facility_id into pharmacy_id from public.patient_preferred_facilities where patient_id=new.patient_id and service_type='pharmacy' and active;
 if pharmacy_id is not null then insert into public.prescription_fulfillments(facility_id,medication_order_id,status) values(pharmacy_id,new.id,'prescribed') on conflict(medication_order_id) do update set facility_id=excluded.facility_id,updated_at=now();end if;
 return new;
end $$;
create trigger medication_order_route_to_pharmacy after insert on public.medication_orders for each row execute function private.route_prescription_to_pharmacy_on_file();

create or replace function private.backfill_pharmacy_on_file() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.service_type='pharmacy' and new.active then insert into public.prescription_fulfillments(facility_id,medication_order_id,status) select new.facility_id,mo.id,'prescribed' from public.medication_orders mo where mo.patient_id=new.patient_id and mo.status='active' on conflict(medication_order_id) do update set facility_id=excluded.facility_id,updated_at=now();end if;
 return new;
end $$;
create trigger preferred_pharmacy_backfill after insert or update on public.patient_preferred_facilities for each row execute function private.backfill_pharmacy_on_file();
revoke all on function private.route_prescription_to_pharmacy_on_file(),private.backfill_pharmacy_on_file() from public,anon,authenticated;

revoke all on function public.request_external_patient_access(uuid,text,date,text),public.issue_patient_access_otp(uuid),public.verify_patient_access_otp(uuid,text),public.search_shared_pharmacy_inventory(text) from public,anon;
grant execute on function public.request_external_patient_access(uuid,text,date,text),public.issue_patient_access_otp(uuid),public.verify_patient_access_otp(uuid,text),public.search_shared_pharmacy_inventory(text) to authenticated;
grant select,insert,update on public.facility_operational_settings,public.patient_preferred_facilities,public.clinical_service_referrals,public.external_record_access_requests to authenticated;
create index referrals_target_status_idx on public.clinical_service_referrals(target_facility_id,status,sent_at desc);
create index access_requests_facility_status_idx on public.external_record_access_requests(requesting_facility_id,status,requested_at desc);
create index preferred_facilities_facility_idx on public.patient_preferred_facilities(facility_id,service_type) where active;
