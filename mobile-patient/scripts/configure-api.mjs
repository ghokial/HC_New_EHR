import fs from 'node:fs';
const url=process.argv[2];
if(!url||!/^https:\/\//.test(url)){console.error('Usage: pnpm configure:api -- https://api.your-domain.com');process.exit(1)}
const path='www/mobile-config.js',source=fs.readFileSync(path,'utf8');
fs.writeFileSync(path,source.replace(/apiBase:'[^']*'/,`apiBase:'${url.replace(/\/$/,'')}'`));
console.log(`Mobile API configured: ${url}`);
