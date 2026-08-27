import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(en);
const rows = Object.entries(countries.getAlpha2Codes()).map(([iso2, iso3]) => ({
  iso2,
  iso3,
  default_name: countries.getName(iso2, "en", { select: "official" }) || countries.getName(iso2, "en")
})).sort((a,b) => a.iso2.localeCompare(b.iso2));

const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const values = rows.map(r => `(${quote(r.iso2)},${quote(r.iso3)},${quote(r.default_name)})`).join(",\n");
process.stdout.write(`insert into public.countries(iso2,iso3,default_name) values\n${values}\non conflict(iso2) do update set iso3=excluded.iso3,default_name=excluded.default_name,active=true;`);
