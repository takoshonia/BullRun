import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
test('mock banks: real HTTP captures, source assertions, repair, consent isolation, exports and faults',{timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geobridge-mocks-')),port=15318,origin=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),GEOBRIDGE_ORIGIN:origin,GEOBRIDGE_HOST:'127.0.0.1',GEOBRIDGE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let logs='';proc.stderr.on('data',d=>logs+=d);proc.stdout.on('data',d=>logs+=d);
 try{
  let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,80));try{if((await fetch(origin+'/api/health')).ok){ready=true;break;}}catch{}}
  assert(ready,logs);const credentials=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json'))),sessions={};
  for(const name of ['operator','bank','tpp','reviewer','standards']){const c=credentials.find(x=>x.username===name),r=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(c)});assert.equal(r.status,200);const x=await r.json();sessions[name]={cookie:r.headers.get('set-cookie').split(';')[0],csrf:x.csrf};}
  async function call(name,url,method='GET',body,headers={}){const r=await fetch(origin+url,{method,headers:{Cookie:sessions[name].cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':sessions[name].csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data};}
  async function run(cid,count=5){const q=await call('bank','/api/runs','POST',{kind:'bank',connectionId:cid,sampleCount:count});assert.equal(q.status,201,JSON.stringify(q));for(let n=0;n<160;n++){const x=await call('bank','/api/runs/'+q.data.id);if(x.data.status==='completed')return x.data;if(x.data.status==='failed')assert.fail(x.data.error+'\n'+logs);await new Promise(r=>setTimeout(r,75));}assert.fail('Mock worker did not finish');}
  const workspace=(await call('bank','/api/workspace')).data;assert.equal(workspace.connections.filter(c=>c.synthetic).length,2);
  const drafts=workspace.rules.map(r=>[r.id,r.status]);
  const tbc=await run('mock-tbc',20);assert.equal(tbc.evidenceMode,'mock_http');assert.equal(tbc.counts.FAIL||0,0,JSON.stringify(tbc.results.filter(x=>x.verdict==='FAIL')));assert(tbc.results.some(r=>r.ruleId==='AIS-CURRENCY'&&r.verdict==='PASS'&&r.sourceHash));
  assert(tbc.metrics.find(m=>m.operation==='accounts').p95!==null);assert.equal(tbc.metrics.find(m=>m.operation==='accounts').attempts,20);
  assert(tbc.results.filter(r=>r.id.startsWith('MOCK-CONSENT')).every(r=>r.verdict==='PASS'));
  const pack=(await call('bank','/api/packs/'+tbc.packId)).data;assert.equal(pack.samples.filter(s=>s.kind==='positive').length,60);assert.equal(pack.mode,'mock_http');assert(pack.observations.every(o=>o.durationMs>=0&&o.requestId));
  const bog=await run('mock-bog');assert(bog.results.some(r=>r.ruleId==='AIS-CURRENCY'&&r.verdict==='FAIL'));assert(bog.results.some(r=>r.id==='MAP-0'&&r.verdict==='FAIL'));assert(bog.results.some(r=>r.id==='MAP-2'&&r.verdict==='PASS'));
  assert.equal((await call('tpp','/api/mock-banks/mock-bog/scenario','POST',{scenario:'healthy'})).status,404);
  assert.equal((await call('reviewer','/api/runs','POST',{kind:'bank',connectionId:'mock-tbc'})).status,403);
  const grant=(await call('tpp','/bridge/v1/connections/mock-bog/consents','POST',{})).data;assert(grant.consentId);const headers={'Consent-ID':grant.consentId};
  assert.equal((await call('tpp','/bridge/v1/connections/mock-bog/accounts','GET',undefined,headers)).status,422);
  assert.equal((await call('operator','/bridge/v1/connections/mock-bog/accounts','GET',undefined,headers)).status,403);
  assert.equal((await call('tpp','/bridge/v1/connections/mock-tbc/accounts','GET',undefined,headers)).status,403);
  const tx=await call('tpp','/bridge/v1/connections/mock-bog/accounts/'+grant.accounts[0]+'/transactions','GET',undefined,headers);assert.equal(tx.status,200);assert.deepEqual(tx.data.data.transactions.map(t=>t.status),['booked','pending']);assert.equal(tx.data.data.transactions[0].amount,'-30.00');assert(tx.data.meta.original.entries);
  await call('bank','/api/mock-banks/mock-bog/scenario','POST',{scenario:'healthy'});const fixed=await run('mock-bog');assert.equal(fixed.counts.FAIL||0,0);
  const comparison=await call('bank','/api/compare','POST',{before:bog.id,after:fixed.id});assert.equal(comparison.status,200);assert(JSON.stringify(comparison.data).includes('PASS'));
  assert.equal((await call('tpp','/bridge/v1/connections/mock-bog/accounts','GET',undefined,headers)).status,200);
  assert.equal((await call('tpp','/bridge/v1/connections/mock-bog/accounts/wrong-account/balances','GET',undefined,headers)).status,403);
  await call('tpp','/bridge/v1/connections/mock-bog/consents/'+grant.consentId,'DELETE');assert.equal((await call('tpp','/bridge/v1/connections/mock-bog/accounts','GET',undefined,headers)).status,403);
  for(const type of ['incompatibility','quality','json','csv']){const x=await call('bank','/api/runs/'+bog.id+'/export/'+type);assert.equal(x.status,200);if(type==='quality')assert.match(x.data,/Same-host measured HTTP/);}
  const gate=await call('bank','/api/gates','POST',{runId:fixed.id});assert.equal(gate.data.decision,'HOLD');
  await call('bank','/api/mock-banks/mock-bog/scenario','POST',{scenario:'outage'});const outage=await run('mock-bog');assert.equal(outage.metrics.find(x=>x.operation==='accounts').successes,0);assert(outage.results.some(r=>r.id==='HTTP-accounts'&&r.verdict==='FAIL'));assert(!outage.results.some(r=>r.ruleId==='AIS-CURRENCY'&&r.verdict==='PASS'));
  await call('bank','/api/mock-banks/mock-bog/scenario','POST',{scenario:'slow'});const slow=await run('mock-bog');assert.equal(slow.metrics.find(x=>x.operation==='accounts').timeouts,5);assert.equal(slow.metrics.find(x=>x.operation==='accounts').p50,null);
  assert.deepEqual((await call('bank','/api/workspace')).data.rules.map(r=>[r.id,r.status]),drafts,'Demo must not activate production rules');
  assert.equal((await call('reviewer','/api/packs/'+bog.packId)).status,403);
 }finally{proc.kill();await new Promise(resolve=>{if(proc.exitCode!==null)return resolve();proc.once('exit',resolve);});fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
