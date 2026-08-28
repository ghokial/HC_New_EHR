import { readFile, mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const sourcePath=new URL("../tmp-world-geography.json.gz",import.meta.url);
const outputRoot=new URL("../assets/geography/",import.meta.url);
const countries=JSON.parse(gunzipSync(await readFile(sourcePath)));
await mkdir(outputRoot,{recursive:true});

const manifest=[];
for(const country of countries){
  const states=(country.states||[]).map(state=>({
    code:state.iso3166_2||state.iso2||String(state.id),
    name:state.name,
    type:state.type||"Administrative area",
    cities:(state.cities||[]).map(city=>({name:city.name,latitude:city.latitude||null,longitude:city.longitude||null})).sort((a,b)=>a.name.localeCompare(b.name))
  })).sort((a,b)=>a.name.localeCompare(b.name));
  const record={country:{iso2:country.iso2,iso3:country.iso3,name:country.name},states};
  await writeFile(new URL(`${country.iso2}.json`,outputRoot),JSON.stringify(record));
  manifest.push({iso2:country.iso2,name:country.name,states:states.length,cities:states.reduce((sum,state)=>sum+state.cities.length,0)});
}
await writeFile(new URL("manifest.json",outputRoot),JSON.stringify({source:"dr5hn/countries-states-cities-database",license:"ODbL-1.0",generated_at:new Date().toISOString(),countries:manifest},null,2));
console.log(JSON.stringify({countries:manifest.length,states:manifest.reduce((sum,country)=>sum+country.states,0),cities:manifest.reduce((sum,country)=>sum+country.cities,0)}));
