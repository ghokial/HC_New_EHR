import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=p=>fs.readFile(p,'utf8');
test('role guide help is present on non-patient portals only',async()=>{
  for(const file of ['portal-features.js','mobile-patient/www/portal-features.js']){
    const source=await read(file);
    assert.match(source,/roleGuideCard/); assert.match(source,/account-role-guide\.pdf/); assert.match(source,/kind!=="patient"/);
  }
});
