import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const mockRoot=process.env.GRINGOTT_TEST_ROOT||path.join(root,'untracked','gringott-sandbox');
const available=fs.existsSync(path.join(mockRoot,'server.js'));

test('actual Gringott -> consent/common AIS -> captured audit/reports -> injected failures',{skip:!available,timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gringott-integration-'));
 const adminKey=crypto.randomBytes(32).toString('hex'),base='http://127.0.0.1:15375',mockBase='http://127.0.0.1:15374';
 const target=[{id:'gringott',name:'Gringott integration',origin:mockBase,tenant:'bank-demo'},{id:'other',adapter:'gringott-mock-v1',name:'Other tenant mock',origin:mockBase,tenant:'bank-other'}];
 const mock=spawn(process.execPath,['server.js'],{cwd:mockRoot,env:{...process.env,PORT:'15374',GRINGOTT_ADMIN_KEY:adminKey},stdio:'ignore'});
 let app,logs='';
 const start=()=>{const child=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:'15375',GEOBRIDGE_ORIGIN:base,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_MOCK_TARGETS:JSON.stringify(target),GEOBRIDGE_GRINGOTT_TIMEOUT_MS:'400'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);return child;};
 const stop=child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const sessions={};
 async function ready(){for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok&&(await fetch(mockBase+'/api/health')).ok)return;}catch{}await sleep(100);}throw Error('Startup failed '+logs);}
 async function login(user){const credentials=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json'))).find(x=>x.username===({bank:'bank-gringott',tpp:'tpp-demo',reviewer:'nbg',standards:'nbg'}[user]||user));const r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(credentials)});assert.equal(r.status,200);sessions[user]={cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};}
 async function call(user,url,method='GET',body,headers={}){const s=sessions[user];const r=await fetch(base+url,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf,...headers},...(body?{body:JSON.stringify(body)}:{})});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data};}
 async function faults(body){const r=await fetch(mockBase+'/api/admin/defects',{method:'POST',headers:{'Content-Type':'application/json','X-Gringott-Admin-Key':adminKey},body:JSON.stringify(body)});assert(r.ok);}
 async function audit(){const r=await call('bank','/api/runs','POST',{kind:'bank',connectionId:'mock-gringott'});assert.equal(r.status,201);for(let i=0;i<300;i++){const run=(await call('bank','/api/runs/'+r.data.id)).data;if(['completed','failed'].includes(run.status)){assert.equal(run.status,'completed',run.error);return run;}await sleep(50);}throw Error('Audit timed out '+logs);}
 const bridge='/bridge/v1/connections/mock-gringott';
 try{
  app=start();await ready();for(const role of ['operator','bank','tpp','reviewer','standards'])await login(role);
  assert.equal((await call('operator','/api/workspace')).data.connections.find(c=>c.id==='mock-gringott').adapter,'gringott-mock-v1');
  assert.equal((await call('bank','/api/runs','POST',{kind:'bank',connectionId:'mock-other'})).status,404,'cross-tenant audit denied');
  const granted=await call('tpp',bridge+'/consents','POST',{});assert.equal(granted.status,201);assert.equal(granted.data.accounts.length,3);assert(!JSON.stringify(granted.data).includes('access_'));
  const cid=granted.data.consentId,h={'Consent-ID':cid};
  assert.equal((await call('operator',bridge+'/accounts','GET',undefined,h)).status,403,'consent owner isolation');
  assert.equal((await call('bank',bridge+'/accounts','GET',undefined,h)).status,403,'role restriction');
  assert.equal((await call('tpp',bridge+'/accounts/other/balances','GET',undefined,h)).status,403,'account scope');
  assert.equal((await call('tpp',bridge+'/accounts','GET',undefined,h)).status,200);
  assert((await call('tpp','/api/events')).data.some(e=>e.action==='common_api_request'));
  assert(!(await call('reviewer','/api/events')).data.some(e=>e.action==='common_api_request'));
  assert(!(await call('bank','/api/events')).data.some(e=>e.action==='common_api_request'));
  const tx=await call('tpp',bridge+'/accounts/acc_1001/transactions','GET',undefined,h);assert.equal(tx.status,200);assert.equal(tx.data.data.transactions.length,4);assert(tx.data.data.transactions.every(t=>t.status==='booked'));
  assert.equal((await call('tpp',bridge+'/consents/'+cid,'DELETE')).status,200);
  assert.equal((await call('tpp',bridge+'/accounts','GET',undefined,h)).status,403);
  const qualityRequest=await call('bank','/api/runs','POST',{kind:'bank',connectionId:'mock-gringott',qualitySuite:true});assert.equal(qualityRequest.status,201);let qualityRun;
  for(let i=0;i<300;i++){qualityRun=(await call('bank','/api/runs/'+qualityRequest.data.id)).data;if(['completed','failed'].includes(qualityRun.status))break;await sleep(25)}assert.equal(qualityRun.status,'completed',qualityRun.error);assert.equal(qualityRun.quality.measurement.attempts,30);assert.equal(qualityRun.results.find(f=>f.id==='DEMO-CONSENT-BINDING').verdict,'NOT_ASSESSED');assert(qualityRun.quality.comparisonKey);
  const healthy=await audit();assert.equal(healthy.evidenceMode,'mock_http');assert(healthy.counts.NEEDS_REVIEW>0);assert(!healthy.counts.FAIL);assert(healthy.metrics.some(m=>m.operation==='transactions'&&m.attempts>0));
  assert(healthy.specHash);assert.equal(healthy.adapterVersion,'gringott-mock-v1');
  assert(healthy.results.some(f=>f.id==='GRINGOTT-REVOKED'&&f.verdict==='PASS'));
  const pack=(await call('bank','/api/packs/'+healthy.packId)).data;
  assert(!JSON.stringify(pack).includes('access_'));assert(!JSON.stringify(pack).includes('code_'));assert(pack.observations.some(o=>o.kind==='negative'));
  assert.equal((await call('reviewer','/api/packs/'+healthy.packId)).status,403);
  for(const type of ['quality','incompatibility','json','csv']){const report=await call('bank','/api/runs/'+healthy.id+'/export/'+type);assert.equal(report.status,200);assert(!JSON.stringify(report.data).includes('access_'));}
  assert.equal((await call('reviewer','/api/gates','POST',{runId:healthy.id,name:'mock gate'})).data.decision,'HOLD');
  assert.equal((await call('standards','/api/rules/XS2A-JSON/review','POST',{approve:true,confirm:true,note:'Test-only review of JSON on the explicitly selected legacy payment-account interface.'})).status,200);
  const approved=await audit();assert(approved.results.some(f=>f.ruleId==='XS2A-JSON'&&f.verdict==='PASS'&&f.sourceHash&&f.section));
  await faults({repeatPagination:true});const pagination=await audit();assert(pagination.results.some(r=>r.id==='GRINGOTT-PAGINATION-acc_1001'&&r.verdict==='FAIL'));
  await faults({repeatPagination:false,revokedConsentBypass:true,malformedErrors:true});const broken=await audit();assert(broken.results.some(r=>r.id==='GRINGOTT-REVOKED'&&r.verdict==='FAIL'));assert(broken.results.some(r=>r.id==='GRINGOTT-ERROR-SHAPE'&&r.verdict==='FAIL'));
  const comparison=await call('bank','/api/compare','POST',{before:healthy.id,after:broken.id});assert.equal(comparison.status,200);assert(comparison.data.changes.some(c=>c.id==='GRINGOTT-REVOKED'));
  await faults({revokedConsentBypass:false,malformedErrors:false,slowResponse:true});const slow=await audit();assert(slow.results.some(r=>r.observed==='TIMEOUT'));await faults({slowResponse:false});
  await faults({slowResponse:true});
  const cancellable=await call('bank','/api/runs','POST',{kind:'bank',connectionId:'mock-gringott'});assert.equal(cancellable.status,201);
  assert.equal((await call('bank','/api/runs/'+cancellable.data.id+'/stop','POST',{})).status,200);await sleep(600);assert.equal((await call('bank','/api/runs/'+cancellable.data.id)).data.status,'cancelled');
  await faults({slowResponse:false});
  const scheduled=await call('bank','/api/schedules','POST',{kind:'bank',connectionId:'mock-gringott',minutes:1});assert.equal(scheduled.status,201);await call('bank','/api/schedules/'+scheduled.data.id,'DELETE');
  await stop(app);app=start();await ready();await login('bank');assert.equal((await call('bank','/api/runs/'+healthy.id)).data.evidenceMode,'mock_http');
 }finally{if(app)await stop(app);await stop(mock);fs.rmSync(dir,{recursive:true,force:true});}
});
