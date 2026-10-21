import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('domain build publishes only the two explicit static files, without local secrets',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geobridge-domain-'));
 try{
  fs.mkdirSync(path.join(dir,'scripts'));fs.mkdirSync(path.join(dir,'deployment','domain'),{recursive:true});
  fs.copyFileSync(new URL('../scripts/build-vercel.mjs',import.meta.url),path.join(dir,'scripts/build-vercel.mjs'));
  for(const name of ['index.html','404.html'])fs.copyFileSync(new URL('../deployment/domain/'+name,import.meta.url),path.join(dir,'deployment/domain',name));
  fs.writeFileSync(path.join(dir,'.env'),'SECRET=canary');fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','demo-credentials.json'),'canary-password');
  const r=spawnSync(process.execPath,[path.join(dir,'scripts/build-vercel.mjs')],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(dir,'vercel-output')).sort(),['404.html','index.html']);
  const page=fs.readFileSync(path.join(dir,'vercel-output/index.html'),'utf8');assert.match(page,/not available/);assert.doesNotMatch(page,/canary/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Vercel static config and backend proxy are distinct; container excludes credentials',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url)));
 assert.equal(config.framework,null);assert.equal(config.outputDirectory,'vercel-output');assert.equal(config.routes,undefined);
 const proxy=JSON.parse(fs.readFileSync(new URL('../deployment/vercel-backend.example.json',import.meta.url)));assert.deepEqual(proxy.routes[0].env,['BACKEND_URL']);
 const docker=fs.readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');assert.match(docker,/USER node/);assert.doesNotMatch(docker,/COPY.*data/);
});
