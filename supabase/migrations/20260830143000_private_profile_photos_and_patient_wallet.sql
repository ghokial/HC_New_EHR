insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-photos','profile-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table public.profile_photos(
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), patient_id bigint references public.patients(id),
 storage_path text not null unique, mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp')),
 uploaded_by uuid not null references auth.users(id), active boolean not null default true, created_at timestamptz not null default now(),
 check((user_id is not null)::integer+(patient_id is not null)::integer=1)
);
alter table public.profile_photos enable row level security;
create policy profile_photos_read on public.profile_photos for select to authenticated using(user_id=auth.uid() or uploaded_by=auth.uid() or exists(select 1 from public.patient_accounts a where a.patient_id=profile_photos.patient_id and a.user_id=auth.uid()) or exists(select 1 from public.patients p where p.id=profile_photos.patient_id and private.is_facility_member(p.facility_id)));
create policy profile_photos_insert on public.profile_photos for insert to authenticated with check(uploaded_by=auth.uid() and (user_id=auth.uid() or exists(select 1 from public.patient_accounts a where a.patient_id=profile_photos.patient_id and a.user_id=auth.uid()) or exists(select 1 from public.patients p where p.id=profile_photos.patient_id and private.is_facility_member(p.facility_id))));
create policy profile_photos_update on public.profile_photos for update to authenticated using(uploaded_by=auth.uid() or user_id=auth.uid() or exists(select 1 from public.patients p where p.id=profile_photos.patient_id and private.is_facility_member(p.facility_id))) with check(uploaded_by=auth.uid() or user_id=auth.uid() or exists(select 1 from public.patients p where p.id=profile_photos.patient_id and private.is_facility_member(p.facility_id)));
grant select,insert,update on public.profile_photos to authenticated;

create policy profile_photo_objects_insert on storage.objects for insert to authenticated with check(bucket_id='profile-photos' and (storage.foldername(name))[1]=auth.uid()::text and storage.extension(name) in('jpg','jpeg','png','webp'));
create policy profile_photo_objects_read on storage.objects for select to authenticated using(bucket_id='profile-photos' and (owner_id=auth.uid()::text or exists(select 1 from public.profile_photos p where p.storage_path=name and (p.user_id=auth.uid() or p.uploaded_by=auth.uid() or exists(select 1 from public.patient_accounts a where a.patient_id=p.patient_id and a.user_id=auth.uid()) or exists(select 1 from public.patients pt where pt.id=p.patient_id and private.is_facility_member(pt.facility_id))))));

create table public.wallet_accounts(
 id uuid primary key default gen_random_uuid(), patient_id bigint not null unique references public.patients(id), currency text not null default 'USD' check(currency~'^[A-Z]{3}$'),
 available_balance numeric(14,2) not null default 0 check(available_balance>=0), hsa_balance numeric(14,2) not null default 0 check(hsa_balance>=0), status text not null default 'active' check(status in('active','restricted','closed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.wallet_hsa_connections(
 id uuid primary key default gen_random_uuid(), patient_id bigint not null unique references public.patients(id), custodian_name text not null, account_last4 text not null check(account_last4~'^[0-9]{4}$'), status text not null default 'linked' check(status in('linked','verification_required','disabled')), updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.wallet_transactions(
 id uuid primary key default gen_random_uuid(), wallet_account_id uuid not null references public.wallet_accounts(id), patient_id bigint not null references public.patients(id), transaction_type text not null check(transaction_type in('funding','purchase','transfer_in','transfer_out','donation_in','donation_out','refund','adjustment')), description text, amount numeric(14,2) not null check(amount<>0), currency text not null check(currency~'^[A-Z]{3}$'), status text not null default 'pending' check(status in('pending','completed','failed','refunded')), payment_provider text, provider_reference text, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
alter table public.wallet_accounts enable row level security;alter table public.wallet_hsa_connections enable row level security;alter table public.wallet_transactions enable row level security;
create policy wallet_accounts_read on public.wallet_accounts for select to authenticated using(exists(select 1 from public.patient_accounts a where a.patient_id=wallet_accounts.patient_id and a.user_id=auth.uid()) or exists(select 1 from public.patients p where p.id=wallet_accounts.patient_id and private.is_facility_member(p.facility_id)));
create policy wallet_hsa_read on public.wallet_hsa_connections for select to authenticated using(exists(select 1 from public.patient_accounts a where a.patient_id=wallet_hsa_connections.patient_id and a.user_id=auth.uid()) or exists(select 1 from public.patients p where p.id=wallet_hsa_connections.patient_id and private.is_facility_member(p.facility_id)));
create policy wallet_hsa_patient_write on public.wallet_hsa_connections for insert to authenticated with check(updated_by=auth.uid() and exists(select 1 from public.patient_accounts a where a.patient_id=wallet_hsa_connections.patient_id and a.user_id=auth.uid()));
create policy wallet_hsa_patient_update on public.wallet_hsa_connections for update to authenticated using(exists(select 1 from public.patient_accounts a where a.patient_id=wallet_hsa_connections.patient_id and a.user_id=auth.uid())) with check(updated_by=auth.uid());
create policy wallet_transactions_read on public.wallet_transactions for select to authenticated using(exists(select 1 from public.patient_accounts a where a.patient_id=wallet_transactions.patient_id and a.user_id=auth.uid()) or exists(select 1 from public.patients p where p.id=wallet_transactions.patient_id and private.is_facility_member(p.facility_id)));
grant select on public.wallet_accounts,public.wallet_transactions to authenticated;grant select,insert,update on public.wallet_hsa_connections to authenticated;
