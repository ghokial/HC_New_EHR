-- Preserve selections from the licensed worldwide geography catalog without
-- requiring every external locality to become a permanent foreign-key row.
alter table public.addresses
  add column if not exists province_text text,
  add column if not exists city_text text;

create index if not exists addresses_country_province_text_idx
  on public.addresses(country_id,province_text);
create index if not exists addresses_country_city_text_idx
  on public.addresses(country_id,city_text);
