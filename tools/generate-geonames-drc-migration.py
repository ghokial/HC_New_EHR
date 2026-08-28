import os
from pathlib import Path

source = Path(os.environ["TEMP"]) / "hc-geonames"
output = Path(__file__).resolve().parents[1] / "supabase" / "migrations" / "20260827205500_drc_provinces_cities_geonames.sql"
escape = lambda value: value.replace("'", "''")

provinces = []
for line in (source / "admin1CodesASCII.txt").read_text(encoding="utf-8").splitlines():
    fields = line.split("\t")
    if fields[0].startswith("CD."):
        provinces.append((fields[0].split(".", 1)[1], fields[1]))

cities = []
for line in (source / "cities15000.txt").read_text(encoding="utf-8").splitlines():
    fields = line.split("\t")
    if len(fields) > 11 and fields[8] == "CD":
        cities.append((fields[10], fields[1], fields[4], fields[5]))

sql = [
    "-- Geographic names sourced from GeoNames admin1CodesASCII.txt and cities15000.txt on 2026-08-27.",
    "with country as (select id from public.countries where iso2='CD') insert into public.provinces(country_id,code,default_name,type) values",
    ",\n".join(f"((select id from country),'{escape(code)}','{escape(name)}','province')" for code, name in provinces) + " on conflict do nothing;",
    "with country as (select id from public.countries where iso2='CD') insert into public.cities(country_id,province_id,default_name,latitude,longitude) values",
    ",\n".join(f"((select id from country),(select id from public.provinces where country_id=(select id from country) and code='{escape(code)}' limit 1),'{escape(name)}',{latitude},{longitude})" for code, name, latitude, longitude in cities) + ";",
    "create index if not exists provinces_country_name_idx on public.provinces(country_id,default_name);",
    "create index if not exists cities_country_province_name_idx on public.cities(country_id,province_id,default_name);",
    "grant select on public.provinces,public.cities to authenticated;",
]
output.write_text("\n".join(sql), encoding="utf-8")
print(f"provinces={len(provinces)} cities={len(cities)} bytes={output.stat().st_size}")
