import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {BogMockAdapter,mapBogMock} from '../src/adapters/bog-mock.mjs';
import {parseTargets,createAvailability} from '../src/availability.mjs';
import {DatabaseSync} from 'node:sqlite';

const root=path.resolve(import.meta.dirname,'..'),fixture=process.env.BOG_MOCK_TEST_ROOT||path.join(root,'untracked','bog-mock-sandbox');
const present=fs.existsSync(path.join(fixture,'src','server.mjs'));
const transaction=id=>({transactionId:id,transactionAmount:{amount:'-123456789012345.1234',currency:'GEL'}});

test('BOG mapper and page semantics reject duplicates, missing categories, omissions and changed query scope',async()=>{
 const tx=transaction('tx');assert.equal(mapBogMock('transactions',{transactions:{booked:[tx],pending:[]}}).transactions[0].amount,tx.transactionAmount.amount);
 assert.throws(()=>mapBogMock('transactions',{transactions:{booked:[tx]}}));
 assert.throws(()=>mapBogMock('transactions',{transactions:{booked:[tx],pending:[tx]}}));
 const page={transactions:{booked:[tx],pending:[]},mockPagination:{page:1,pageSize:3,total:2}};
 const adapter=new BogMockAdapter({origin:'https://mock.invalid',request:async()=>({status:200,body:page})});
 await assert.rejects(adapter.listTransactions({},'a'),/omitted/);
 page.transactions.booked=[transaction('1'),transaction('2'),transaction('3')];page.mockPagination.total=6;
 page._links={next:{href:'/v1/accounts/a/transactions?bookingStatus=booked&dateFrom=2020-01-01&pageSize=3&page=2'}};
 await assert.rejects(adapter.listTransactions({},'a'),/query scope/);
});

test('BOG authorization rejects mismatched state without exchanging a token',async()=>{
 const adapter=new BogMockAdapter({origin:'https://mock.invalid',request:async path=>{
  if(path.startsWith('/oauth/authorize?'))return {status:200,body:'<input name="challenge" value="approval_test">'};
  if(path==='/oauth/decision')return {status:302,location:'https://mock.invalid/callback?state=wrong&code=private'};
  throw Error('Token exchange must not happen');
 }});
 await assert.rejects(adapter.completeAuthorization({upstreamId:'test'}),/state invalid/);
});

test('BOG availability control uses its own admin header and no-response mode',async()=>{
 const target=parseTargets(JSON.stringify([{id:'bog',adapter:'bog-mock-v1',origin:'http://bog-mock:4183'}]))[0];target.adminKey='private-key';
 const db=new DatabaseSync(':memory:');let headers,body;
 const monitor=createAvailability({db,targets:[target],request:async(url,options)=>{headers=options.headers;body=options.body;return {httpStatus:200,data:{availability:{online:false}}};}});
 try{await monitor.switchMock('bog',false);assert.equal(headers['X-BOG-Mock-Admin-Key'],'private-key');assert(!headers['X-Gringott-Admin-Key']);assert.equal(body.mode,'no_response');}finally{monitor.stop();db.close();}
});

test('actual BOG mock -> PKCE -> common AIS -> reports and independently injected faults',{skip:!present,timeout:60000},async()=>{
 const {createApp}=await import(pathToFileURL(path.join(fixture,'src','server.mjs')));
 const adminKey='local-only-test-admin-key-at-least-32-bytes',mock=createApp({adminKey}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'bog-geobridge-'));
 await new Promise(r=>mock.server.listen(0,'127.0.0.1',r));
 const mockBase='http://127.0.0.1:'+mock.server.address().port,base='http://127.0.0.1:15378';let app,logs='',cookie,csrf;
 fs.writeFileSync(path.join(dir,'mock-admin.key'),adminKey,{mode:0o600});
 const targets=[{id:'bog',name:'BOG local test',adapter:'bog-mock-v1',origin:mockBase,adminKeyFile:path.join(dir,'mock-admin.key')},{id:'comparison-fixture',name:'Identical mock fixture',adapter:'bog-mock-v1',origin:mockBase,tenant:'bank-tbc'}];
 async function call(route,method='GET',body,headers={}){
  const r=await fetch(base+route,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie||'','X-CSRF-Token':csrf||'',...headers},...(body?{body:JSON.stringify(body)}:{})});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data};
 }
 async function audit(){const queued=await call('/api/runs','POST',{kind:'bank',connectionId:'mock-bog'});assert.equal(queued.status,201,JSON.stringify(queued.data));
  for(let i=0;i<300;i++){const run=(await call('/api/runs/'+queued.data.id)).data;if(['completed','failed'].includes(run.status)){assert.equal(run.status,'completed',run.error);return run}await new Promise(r=>setTimeout(r,25));}throw Error('Audit timeout '+logs);
 }
 async function fault(name,value){const r=await fetch(mockBase+'/api/admin/faults',{method:'POST',headers:{'Content-Type':'application/json','X-BOG-Mock-Admin-Key':adminKey},body:JSON.stringify({[name]:value})});assert(r.ok);}
 try{
  app=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:'15378',GEOBRIDGE_ORIGIN:base,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_MOCK_TARGETS:JSON.stringify(targets),GEOBRIDGE_BOG_MOCK_TIMEOUT_MS:'200'},stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',x=>logs+=x);app.stderr.on('data',x=>logs+=x);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,logs);
  const credentials=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json'))).find(c=>c.username==='operator');
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(credentials)});assert(login.ok);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
  assert.equal((await call('/api/connections/mock-bog/readiness')).data.ready,true);
  const bridge='/bridge/v1/connections/mock-bog',grant=await call(bridge+'/consents','POST',{});assert.equal(grant.status,201,JSON.stringify(grant.data));assert.equal(grant.data.accounts.length,3);
  const h={'Consent-ID':grant.data.consentId};
  assert.equal((await call(bridge+'/accounts','GET',undefined,h)).status,200);
  assert.equal((await call(bridge+'/accounts/bog-gel-001/balances','GET',undefined,h)).status,200);
  const tx=await call(bridge+'/accounts/bog-gel-001/transactions','GET',undefined,h);assert.equal(tx.status,200);assert.equal(tx.data.data.transactions.length,9);assert.equal(tx.data.data.transactions.filter(t=>t.status==='pending').length,2);
  const healthy=await audit();assert.equal(healthy.adapterVersion,'bog-mock-v1');assert(!healthy.counts.FAIL,JSON.stringify(healthy.results.filter(r=>r.verdict==='FAIL')));
  // Starting an audit must not expire the interactive user's existing grant.
  assert.equal((await call(bridge+'/accounts','GET',undefined,h)).status,200);
  assert.equal((await call(bridge+'/consents/'+grant.data.consentId,'DELETE')).status,200);assert.equal((await call(bridge+'/accounts','GET',undefined,h)).status,403);
  const pack=(await call('/api/packs/'+healthy.packId)).data;
  for(const obs of pack.observations.filter(o=>o.path.startsWith('/oauth/'))){assert.equal(obs.bodyHash,null);assert.deepEqual(obs.body,{redacted:'Authorization material intentionally omitted'});}
  assert.equal(pack.samples.filter(s=>s.kind==='positive'&&s.operation==='transactions').length,9);
  for(const type of ['quality','incompatibility','json','csv'])assert.equal((await call('/api/runs/'+healthy.id+'/export/'+type)).status,200);
  const qualityQueued=await call('/api/runs','POST',{kind:'bank',connectionId:'mock-bog',qualitySuite:true});assert.equal(qualityQueued.status,201);let qualityRun;
  for(let i=0;i<300;i++){qualityRun=(await call('/api/runs/'+qualityQueued.data.id)).data;if(['completed','failed'].includes(qualityRun.status))break;await new Promise(r=>setTimeout(r,25))}
  assert.equal(qualityRun.status,'completed',qualityRun.error);assert.equal(qualityRun.quality.measurement.attempts,30);assert(qualityRun.quality.comparisonKey);assert.equal(qualityRun.results.find(f=>f.id==='DEMO-INVALID-TOKEN').verdict,'PASS');
  const qualityReport=await call('/api/reports/'+qualityRun.reportId);assert.deepEqual(qualityReport.data.snapshot.quality,qualityRun.quality);
  assert((await call('/api/reports/'+qualityRun.reportId+'/html')).data.includes('Mock quality suite'));
  const compareRequest={connectionIds:['mock-bog','mock-comparison-fixture'],requestId:crypto.randomUUID()};
  const batch=await call('/api/mock-comparisons','POST',compareRequest);assert.equal(batch.status,201,JSON.stringify(batch.data));
  const duplicate=await call('/api/mock-comparisons','POST',compareRequest);assert.equal(duplicate.status,200);assert.equal(duplicate.data.id,batch.data.id);
  assert.equal((await call('/api/mock-comparisons','POST',{...compareRequest,policy:{p95Ms:999}})).status,409);
  let finishedBatch;for(let i=0;i<500;i++){finishedBatch=(await call('/api/mock-comparisons')).data.comparisons.find(b=>b.id===batch.data.id);if(finishedBatch.rows.every(r=>['completed','failed'].includes(r.status)))break;await new Promise(r=>setTimeout(r,25))}
  assert(finishedBatch.rows.every(r=>r.status==='completed'),JSON.stringify(finishedBatch));assert.equal(finishedBatch.comparable,true);assert(finishedBatch.rows.every(r=>r.quality.measurement.attempts===30&&r.reportId));
  // Demonstrate a reversible security failure without allowing arbitrary mock administration.
  assert.equal((await call('/api/mock-demo/bog','POST',{defect:'revokedConsentBypass',enabled:true,durationSeconds:60})).status,200);
  try{const defectRun=await audit();assert(defectRun.results.some(f=>f.id==='BOG-MOCK-REVOKED'&&f.verdict==='FAIL'))}finally{const restored=await call('/api/mock-demo/bog','POST',{defect:'revokedConsentBypass',enabled:false});assert.equal(restored.data.status,'restored')}
  const recovered=await audit();assert(recovered.results.some(f=>f.id==='BOG-MOCK-REVOKED'&&f.verdict==='PASS'));

  for(const [name,id] of [['missingCurrency','BOG-MOCK-ACCOUNTS'],['numericAmounts','BOG-MOCK-BALANCES-bog-gel-001'],['repeatPagination','BOG-MOCK-PAGINATION-bog-gel-001'],['revokedConsentBypass','BOG-MOCK-REVOKED'],['malformedErrors','BOG-MOCK-ERROR-SHAPE'],['wrongEndpoint','BOG-MOCK-BALANCES-bog-gel-001'],['rateLimited','BOG-MOCK-FLOW'],['slowResponse','BOG-MOCK-FLOW']]){
   await fault(name,true);try{const run=await audit();assert(run.results.some(r=>r.id===id&&r.verdict==='FAIL'),name+' must be detected');if(name==='missingCurrency'){assert(run.results.some(r=>r.id==='BOG-MOCK-UNKNOWN-ACCOUNT'&&r.verdict==='PASS'));assert(run.results.some(r=>r.id==='BOG-MOCK-REVOKED'&&r.verdict==='PASS'));assert(run.results.some(r=>r.id==='BOG-MOCK-BALANCES'&&r.verdict==='BLOCKED'));assert(run.results.some(r=>r.id==='BOG-MOCK-PAGINATION'&&r.verdict==='BLOCKED'))}}finally{await fault(name,false);}
  }
 }finally{
  if(app&&app.exitCode===null)await new Promise(r=>{app.once('exit',r);app.kill()});
  await mock.close();fs.rmSync(dir,{recursive:true,force:true});
 }
});
