import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {TbcMockAdapter,mapTbcMock} from '../src/adapters/tbc-mock.mjs';
import {adapterTargets,mapAdapter} from '../src/adapters/registry.mjs';
import {parseTargets} from '../src/availability.mjs';

const tx=id=>({transactionId:id,transactionAmount:{amount:'-123456789012345.1234',currency:'GEL'}});
test('TBC mapping explicitly supports omitted categories, preserves precision and refuses unknown/duplicate categories',()=>{
 const mapped=mapTbcMock('transactions',{transactions:{booked:[tx('1')]}});
 assert.equal(mapped.transactions[0].amount,'-123456789012345.1234');assert.equal(mapped.transactions[0].status,'booked');
 assert.equal(mapTbcMock('transactions',{transactions:{pending:[tx('2')]}}).transactions[0].status,'pending');
 for(const transactions of [{},{booked:null},{booked:[tx('1')],pending:[tx('1')]},{booked:[],future:[]}])assert.throws(()=>mapTbcMock('transactions',{transactions}));
 assert.throws(()=>mapAdapter('unknown','transactions',{}));
 const config=JSON.stringify([{id:'tbc',adapter:'tbc-mock-v1',origin:'https://example.invalid',monitor:false}]);
 assert.equal(adapterTargets(config)[0].id,'mock-tbc');assert.deepEqual(parseTargets(config),[]);
});

test('TBC pagination follows same-account links only, detects repeated pages and transactions',async()=>{
 let bodies;const transport={origin:'https://mock.invalid',request:async()=>({status:200,body:bodies.shift()})};
 const adapter=new TbcMockAdapter(transport),body=(id,href)=>({transactions:{booked:[tx(id)],...(href?{_links:{next:{href}}}:{})}});
 bodies=[body('1','/0.8/v1/accounts/a/transactions?page=2'),body('2')];
 assert.equal((await adapter.listTransactions({},'a')).data.transactions.length,2);
 for(const href of ['https://evil.invalid/0.8/v1/accounts/a/transactions','/0.8/v1/accounts/other/transactions','/0.8/v1/accounts/a/transactions']){
  bodies=[body('1',href)];await assert.rejects(adapter.listTransactions({},'a'));
 }
 bodies=[body('1','?page=2'),body('1')];await assert.rejects(adapter.listTransactions({},'a'),/Repeated transaction/);
});

test('TBC consent/session headers, AIS, captured reports and revocation through real local HTTP',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tbc-integration-')),sockets=new Set(),consents=new Map();let issued=0,app,logs='';
 const account={resourceId:'account-a',currency:'GEL'},balance={balanceAmount:{amount:'10.00',currency:'GEL'},balanceType:'interimBooked'};
 const mock=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  function reply(status,body){res.writeHead(status);res.end(body?JSON.stringify(body):undefined);}
  const url=new URL(req.url,'http://mock');
  if(url.pathname==='/openapi.json')return reply(200,{openapi:'3.0.1',paths:{'/v1/accounts':{}}});
  if(url.pathname==='/mock/docs/session'){
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw);assert.equal(body.family,'ais');assert.equal(body.version,'v1');assert(body.browserId);
   const id='consent-'+(++issued),token='PRIVATE_ACCESS_'+issued;consents.set(id,{token,active:true});
   return reply(200,{synthetic:true,consentId:id,accessToken:token,refreshToken:'PRIVATE_REFRESH',expiresAt:Date.now()+300000});
  }
  const consentPath=url.pathname.match(/^\/0.8\/v1\/consents\/([^/]+)(\/status)?$/);
  if(consentPath){const c=consents.get(consentPath[1]);if(!c)return reply(404,{});if(req.method==='DELETE'){c.active=false;return reply(204);}return reply(200,{consentStatus:c.active?'valid':'terminatedByTpp'});}
  const c=consents.get(req.headers['consent-id']);
  if(!c?.active||req.headers.authorization!=='Bearer '+c.token)return reply(401,{code:'CONSENT_INVALID',detail:'Invalid consent'});
  if(url.pathname==='/0.8/v1/accounts')return reply(200,{accounts:[account]});
  if(url.pathname==='/0.8/v1/accounts/account-a/balances')return reply(200,{balances:[balance]});
  if(url.pathname==='/0.8/v1/accounts/account-a/transactions')return reply(200,{transactions:{booked:[tx('1')]}});
  return reply(404,{code:'RESOURCE_UNKNOWN',detail:'Unknown account'});
 });
 mock.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:15377',targets=[{id:'tbc',adapter:'tbc-mock-v1',name:'TBC test',origin:'http://127.0.0.1:'+mock.address().port,monitor:false}];
 let cookie,csrf;
 async function call(route,method='GET',body,headers={}){
  const response=await fetch(base+route,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie||'','X-CSRF-Token':csrf||'',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert(response.ok,route+' HTTP '+response.status);return response;
 }
 try{
  app=spawn(process.execPath,['src/server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:'15377',GEOBRIDGE_ORIGIN:base,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_MOCK_TARGETS:JSON.stringify(targets)},stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',x=>logs+=x);app.stderr.on('data',x=>logs+=x);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50));}assert(ready,logs);
  const credentials=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json'))).find(c=>c.username==='operator');
  const login=await call('/api/login','POST',credentials);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
  assert((await (await call('/api/workspace')).json()).connections.some(c=>c.id==='mock-tbc'));
  const bridge='/bridge/v1/connections/mock-tbc',grant=await (await call(bridge+'/consents','POST',{})).json();
  assert.equal(grant.accounts.length,1);assert(!JSON.stringify(grant).includes('PRIVATE_'));
  for(const route of ['/accounts','/accounts/account-a/balances','/accounts/account-a/transactions'])await call(bridge+route,'GET',undefined,{'Consent-ID':grant.consentId});
  await call(bridge+'/consents/'+grant.consentId,'DELETE');
  const queued=await (await call('/api/runs','POST',{kind:'bank',connectionId:'mock-tbc'})).json();let run;
  for(let i=0;i<150;i++){run=await (await call('/api/runs/'+queued.id)).json();if(['completed','failed'].includes(run.status))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(run.status,'completed',run.error);assert.equal(run.adapterVersion,'tbc-mock-v1');assert(!run.counts.FAIL,JSON.stringify(run.results.filter(r=>r.verdict==='FAIL')));
  assert(run.results.some(r=>r.id==='TBC-MOCK-REVOKED'&&r.verdict==='PASS'));
  const pack=await (await call('/api/packs/'+run.packId)).json();assert(!JSON.stringify(pack).includes('PRIVATE_'));
  for(const type of ['quality','incompatibility','json','csv'])await call('/api/runs/'+run.id+'/export/'+type);
  const qualityQueued=await (await call('/api/runs','POST',{kind:'bank',connectionId:'mock-tbc',qualitySuite:true})).json();let qualityRun;
  for(let i=0;i<150;i++){qualityRun=await (await call('/api/runs/'+qualityQueued.id)).json();if(['completed','failed'].includes(qualityRun.status))break;await new Promise(r=>setTimeout(r,50))}assert.equal(qualityRun.status,'completed',qualityRun.error);assert.equal(qualityRun.quality.measurement.attempts,30);assert(qualityRun.quality.comparisonKey);
  assert([...consents.values()].every(c=>!c.active),'all test consents revoked');
 }finally{
  if(app&&app.exitCode===null){await new Promise(r=>{app.once('exit',r);app.kill()});}
  for(const socket of sockets)socket.destroy();await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});
 }
});
