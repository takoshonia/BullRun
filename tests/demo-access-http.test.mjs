import test from 'node:test';import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
test('QR login over HTTP enforces origin, creates Operator cookie, and revokes active access',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geobridge-qr-')),base='http://127.0.0.1:15407',env={...process.env,PORT:'15407',GEOBRIDGE_ORIGIN:base,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_MOCK_TARGETS:'[]'};
 const child=spawn(process.execPath,['src/server.mjs'],{env,stdio:'ignore'});
 const cli=(...args)=>{const r=spawnSync(process.execPath,['scripts/demo-access.mjs',...args],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 try{
  let ready=false;for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert(ready);
  const file=path.join(dir,'qr.json');cli('issue',file);const grant=JSON.parse(fs.readFileSync(file));
  const redeem=origin=>fetch(base+'/api/demo-access/redeem',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({token:grant.token})});
  assert.equal((await redeem('https://attacker.invalid')).status,403);
  const response=await redeem(base);assert.equal(response.status,200);assert.equal((await response.json()).user.role,'operator');const cookie=response.headers.get('set-cookie');assert(cookie.includes('HttpOnly'));assert(cookie.includes('SameSite=Strict'));
  const me=()=>fetch(base+'/api/me',{headers:{Cookie:cookie.split(';')[0]}});assert.equal((await me()).status,200);
  cli('revoke',grant.id);assert.equal((await me()).status,401);assert.equal((await redeem(base)).status,401);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
});
