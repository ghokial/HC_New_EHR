-- Performance: evaluate access checks once per query instead of once per row.
--
-- The load test (tests/load/access-rules.load.mjs) showed list screens slowing in
-- proportion to facility size: every row called private.can_read_patient_record,
-- has_facility_role, is_facility_member or is_active_facility with that row's facility
-- or patient, and those functions cannot be inlined (SET search_path). This migration
-- rewrites each policy's expressions into equivalent forms Postgres evaluates once per
-- statement: the signed-in user's facility lists are computed once, and each row is
-- checked with "= ANY(list)". Access decisions do not change; see
-- tests/db/policy-rewrite-equivalence.test.mjs.

-- Facilities where the user has an active membership with one of the roles (or owns
-- it). Security invoker, exactly as private.has_facility_role, so the memberships
-- table's own rules (including MFA) still apply.
create or replace function private.my_facilities_with_role(allowed_roles text[]) returns uuid[] language sql stable security invoker set search_path='' as $$
 select coalesce(array_agg(distinct fm.facility_id),'{}') from public.facility_memberships fm join public.roles r on r.id=fm.role_id
 where fm.user_id=(select auth.uid()) and fm.active and (fm.is_owner or r.role_code=any(allowed_roles))
$$;
-- Facilities where the user has an active membership (as private.is_facility_member).
create or replace function private.my_member_facilities() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct fm.facility_id),'{}') from public.facility_memberships fm where fm.user_id=(select auth.uid()) and fm.active
$$;
-- The user's active facility (as private.is_active_facility, without the root bypass).
create or replace function private.my_active_facilities() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(c.facility_id),'{}') from public.active_facility_context c where c.user_id=(select auth.uid())
$$;
revoke all on function private.my_facilities_with_role(text[]),private.my_member_facilities(),private.my_active_facilities() from public,anon;
grant execute on function private.my_facilities_with_role(text[]),private.my_member_facilities(),private.my_active_facilities() to authenticated;

-- Rewrites one policy expression. tbl qualifies bare column arguments that end up
-- inside a new subquery.
create or replace function private.rewrite_policy_expression(expr text,tbl text) returns text language plpgsql immutable set search_path='' as $$
declare m text[]; arg text; readers constant text:='ARRAY[''registration''::text, ''physician''::text, ''resident''::text, ''advanced_practice''::text, ''nurse''::text, ''pharmacist''::text, ''therapist''::text, ''lab_tech''::text, ''lab_supervisor''::text, ''rad_tech''::text, ''billing''::text, ''case_manager''::text, ''him''::text, ''compliance''::text, ''clinical_informatics''::text, ''sysadmin''::text, ''executive''::text]';
begin
 if expr is null then return null; end if;
 -- private.can_read_patient_record(x), written out (same four branches as the function).
 loop
  m:=regexp_match(expr,'private\.can_read_patient_record\(([a-z_]+(\.[a-z_]+)?)\)');
  exit when m is null;
  arg:=case when m[1] like '%.%' then m[1] else format('%I.%I',tbl,m[1]) end;
  expr:=replace(expr,format('private.can_read_patient_record(%s)',m[1]),format(
   '((SELECT private.is_platform_root()) OR (EXISTS (SELECT 1 FROM public.patients crp_p WHERE crp_p.id = %1$s AND crp_p.facility_id = ANY ((SELECT private.my_facilities_with_role(%2$s))::uuid[]))) OR (EXISTS (SELECT 1 FROM public.patient_accounts crp_a WHERE crp_a.patient_id = %1$s AND crp_a.user_id = (SELECT auth.uid()))) OR (EXISTS (SELECT 1 FROM public.patient_accounts crp_a JOIN public.patient_proxies crp_x ON crp_x.proxy_patient_id = crp_a.patient_id WHERE crp_a.user_id = (SELECT auth.uid()) AND crp_x.target_patient_id = %1$s AND crp_x.active AND crp_x.can_view)))',arg,readers));
 end loop;
 expr:=regexp_replace(expr,'private\.has_facility_role\(([a-z_]+(\.[a-z_]+)?), (ARRAY\[[^]]*\])\)','COALESCE((\1 = ANY ((SELECT private.my_facilities_with_role(\3))::uuid[])), false)','g');
 expr:=regexp_replace(expr,'private\.is_facility_member\(([a-z_]+(\.[a-z_]+)?)\)','COALESCE((\1 = ANY ((SELECT private.my_member_facilities())::uuid[])), false)','g');
 expr:=regexp_replace(expr,'private\.is_active_facility\(([a-z_]+(\.[a-z_]+)?)\)','((SELECT private.is_platform_root()) OR COALESCE((\1 = ANY ((SELECT private.my_active_facilities())::uuid[])), false))','g');
 -- Argument-free checks become one-time sub-selects.
 expr:=regexp_replace(expr,'(?<!SELECT )(private\.is_aal2\(\)|private\.is_platform_root\(\)|private\.current_role_code\(\)|(?<![a-z_.])current_role_code\(\))','(SELECT \1)','g');
 return expr;
end $$;

do $$
declare p record; new_qual text; new_check text; changed int:=0; old_path text:=current_setting('search_path');
begin
 -- Policy text is read and re-applied under the same search_path.
 perform set_config('search_path','public',true);
 for p in select tablename,policyname,qual,with_check from pg_policies where schemaname='public'
   -- The membership and role tables are what the helpers read; leave their rules as they are.
   -- Referrals: its insert rule reads medication_orders, whose rules read referrals back;
   -- Postgres reports that loop as infinite recursion once the rules contain sub-selects.
   and tablename not in ('facility_memberships','user_roles','roles','active_facility_context','clinical_service_referrals')
 loop
  new_qual:=private.rewrite_policy_expression(p.qual,p.tablename);
  new_check:=private.rewrite_policy_expression(p.with_check,p.tablename);
  if new_qual is distinct from p.qual or new_check is distinct from p.with_check then
   execute format('alter policy %I on public.%I',p.policyname,p.tablename)
    ||case when p.qual is not null then format(' using (%s)',new_qual) else '' end
    ||case when p.with_check is not null then format(' with check (%s)',new_check) else '' end;
   changed:=changed+1;
  end if;
 end loop;
 perform set_config('search_path',old_path,true);
 raise notice 'Rewrote % policies', changed;
end $$;

drop function private.rewrite_policy_expression(text,text);

-- The staff audit page lists the newest entries; this index serves that order.
create index if not exists audit_logs_occurred_idx on public.audit_logs(occurred_at desc);
