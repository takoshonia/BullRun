import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..'),bogRoot=path.join(root,'untracked/bog-mock-sandbox'),grRoot=path.join(root,'untracked/gringott-sandbox');
const available=fs.existsSync(path.join(bogRoot,'src/server.mjs'))&&fs.existsSync(path.join(grRoot,'server.js'));
test('two HTTP mocks: detect schema change, isolate TPP errors, test/review/activate exact mapping and rollback',{skip:!available,timeout:90000},async()=>{
 const {createApp}=await import(pathToFileURL(path.join(bogRoot,'src/server.mjs')));const bog=createApp({adminKey:'contract-test-private-key-not-production-123456789'});await new Promise(resolve=>bog.server.listen(18480,'127.0.0.1',resolve));
 const gr=spawn(process.execPath,['server.js'],{cwd:grRoot,env:{...process.env,PORT:'18481'},stdio:'ignore',windowsHide:true});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geobridge-contract-')),base='http://127.0.0.1:18482',targets=[{id:'bog',adapter:'bog-mock-v1',origin:'http://127.0.0.1:18480'},{id:'gringott',origin:'http://127.0.0.1:18481'}];let logs='';
 const app=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:'18482',GEOBRIDGE_ORIGIN:base,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_MOCK_TARGETS:JSON.stringify(targets)},stdio:['ignore','pipe','pipe'],windowsHide:true});app.stderr.on('data',x=>logs+=x);app.stdout.on('data',x=>logs+=x);
 const sessions={};
 async function call(user,url,body){const headers={'Origin':base,'Content-Type':'application/json'};if(user){headers.Cookie=sessions[user].cookie;headers['X-CSRF-Token']=sessions[user].csrf}const r=await fetch(base+url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(r.status===500)await new Promise(resolve=>setTimeout(resolve,100));return {status:r.status,data,headers:r.headers}}
 const action=(user,body)=>call(user,'/api/contract-review/action',body);
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok&&(await fetch('http://127.0.0.1:18481/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready,logs);
  const creds=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json')));
  for(const name of ['operator','nbg','tpp-demo','bank-bog']){const c=creds.find(c=>c.username===name);const r=await call(null,'/api/login',{username:name,password:c.password});assert.equal(r.status,200);sessions[name]={cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf}}
  assert.equal((await call('tpp-demo','/api/contract-review')).status,403);assert.equal((await call('bank-bog','/api/contract-review')).status,403);
  assert.equal((await action('nbg',{action:'demo',connectionId:'mock-bog',enabled:true})).status,403);
  for(const cid of ['mock-bog','mock-gringott']){let r=await action('operator',{action:'scan',connectionId:cid});assert.equal(r.status,200,JSON.stringify(r.data)+logs);const snapshotId=r.data.id;assert.equal((await action('operator',{action:'baseline',connectionId:cid,snapshotId,note:'Reviewed original mock documentation'})).status,403);r=await action('nbg',{action:'baseline',connectionId:cid,snapshotId,note:'Reviewed original mock documentation'});assert.equal(r.status,200,JSON.stringify(r.data)+logs)}
  const requests=[];for(const cid of ['mock-bog','mock-gringott']){const r=await call('tpp-demo','/bridge/v1/connections/'+cid+'/consents',{});assert.equal(r.status,201,JSON.stringify(r.data));requests.push({connectionId:cid,consentId:r.data.consentId})}
  const batch=()=>call('tpp-demo','/bridge/v1/batch',{operation:'balances',requests});let r=await batch();assert(r.data.results.every(x=>x.status==='success'),JSON.stringify(r.data));const original=r.data.results.find(x=>x.connectionId==='mock-bog').data.balances;
  await action('operator',{action:'demo',connectionId:'mock-bog',enabled:true});assert.equal((await action('operator',{action:'scan',connectionId:'mock-bog'})).status,200);
  r=await batch();assert.equal(r.data.results[0].status,'error');assert.equal(r.data.results[1].status,'success');
  const proposed=await action('operator',{action:'propose',connectionId:'mock-bog',mapping:{operation:'balances',sourceField:'sum',destination:'balanceAmount.amount'}});assert.equal(proposed.status,200);const id=proposed.data.id;
  assert.equal((await action('operator',{action:'activate',id})).status,409);assert.equal((await action('nbg',{action:'test',id})).status,403);
  r=await action('operator',{action:'test',id});assert.equal(r.status,200,JSON.stringify(r.data)+logs);assert.equal(r.data.passed,true);
  assert.equal((await action('operator',{action:'approve',id,note:'Reviewed semantic identity'})).status,403);
  assert.equal((await action('nbg',{action:'approve',id,note:'Controlled overlay copies original amount without changing currency or meaning'})).status,200);
  assert.equal((await action('nbg',{action:'activate',id})).status,403);assert.equal((await action('operator',{action:'activate',id})).status,200);
  r=await batch();assert(r.data.results.every(x=>x.status==='success'),JSON.stringify(r.data));assert.deepEqual(r.data.results[0].data.balances,original);assert(r.data.results[0].proof.original.every(x=>typeof x.fields.sum==='string'));assert.equal(r.data.results[0].proof.mappingVersion,id);
  const wrong=await call('operator','/bridge/v1/batch',{operation:'balances',requests});assert(wrong.data.results.every(x=>x.status==='error'),'Another owner must not reuse consent');
  await action('operator',{action:'rollback',connectionId:'mock-bog'});r=await batch();assert.equal(r.data.results[0].status,'error');assert.equal(r.data.results[1].status,'success');
  const view=(await call('nbg','/api/contract-review')).data;assert(view.changes.length>0);assert(view.mismatches.length>0);assert(view.tests.some(t=>t.passed));assert(!JSON.stringify(view).includes(requests[0].consentId));
 }finally{app.kill();gr.kill();await bog.close();await new Promise(r=>app.once('exit',r));fs.rmSync(dir,{recursive:true,force:true})}
});
