import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'vercel-output');
fs.mkdirSync(output,{recursive:true});
// Explicit allowlist: never publish sources, database, credentials or environment files.
for(const name of ['index.html','404.html'])fs.copyFileSync(path.join(root,'deployment','domain',name),path.join(output,name));
console.log('GeoBridge domain page built. Full backend and bank integration are not deployed by this build.');
