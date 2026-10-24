import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
test('HTTP workflows: authentication, CSRF, worker, evidence, reports, isolation, gates and mapper',{timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(root,'data','integration-'));const port=14317;const origin=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),GEOBRIDGE_ORIGIN:origin,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_ALLOWED_HOSTS:'sandbox.example.com'},stdio:['ignore','pipe','pipe']});
 let logs='';proc.stdout.on('data',x=>logs+=x);proc.stderr.on('data',x=>logs+=x);
 try{
  for(let n=0;n<80;n++){await new Promise(r=>setTimeout(r,100));if(fs.existsSync(path.join(dir,'demo-credentials.json'))){try{if((await fetch(origin+'/api/health')).ok)break}catch{}}}
  const credentials=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json')));const sessions={};
  async function login(name){const c=credentials.find(x=>x.username===name);const r=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(c)});assert.equal(r.status,200);const data=await r.json();sessions[name]={cookie:r.headers.get('set-cookie').split(';')[0],csrf:data.csrf};return data}
  async function call(name,url,method='GET',body){const s=sessions[name];const r=await fetch(origin+url,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:s.cookie,'X-CSRF-Token':s.csrf},body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data}}
  async function waitRun(name,id){for(let i=0;i<60;i++){const {data}=await call(name,'/api/runs/'+id);if(['completed','failed'].includes(data.status))return data;await new Promise(r=>setTimeout(r,100))}throw Error('Worker timeout')}
  assert.equal((await fetch(origin+'/api/workspace')).status,401);
  const loginLogo=await fetch(origin+'/logo-login.png');assert.equal(loginLogo.status,200);assert.match(loginLogo.headers.get('content-type'),/image\/png/);assert.deepEqual(Buffer.from(await loginLogo.arrayBuffer()),fs.readFileSync(path.join(root,'public','logo-login.png')));
  const logo=await fetch(origin+'/logo.png');assert.equal(logo.status,200);assert.match(logo.headers.get('content-type'),/image\/png/);assert.deepEqual(Buffer.from(await logo.arrayBuffer()),fs.readFileSync(path.join(root,'public','logo.png')));
  for(const name of ['operator','bank','tpp','reviewer','standards'])await login(name);
  const tppWorkspace=await call('tpp','/api/workspace');
  assert.equal(tppWorkspace.data.connections.length,0);assert.equal(tppWorkspace.data.rules.length,0);assert(tppWorkspace.data.catalog.length>0);assert(!JSON.stringify(tppWorkspace.data.catalog).includes('baseUrl'));
  const standardsWorkspace=await call('standards','/api/workspace');const newDrafts=standardsWorkspace.data.rules.filter(r=>r.id.startsWith('XS2A-ACCOUNT-'));assert.equal(newDrafts.length,6);assert(newDrafts.every(r=>r.status==='draft'&&r.quoteVerified&&r.profile==='xs2a-0.8'&&r.sourceHash&&r.references.length===2));
  assert.equal(standardsWorkspace.data.connections.length,0);assert.equal(standardsWorkspace.data.runs.length,0);assert(standardsWorkspace.data.rules.length>0);
  assert.equal((await fetch(origin+'/api/runs',{method:'POST',headers:{Origin:origin,Cookie:sessions.bank.cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await call('tpp','/api/runs','POST',{kind:'platform'})).status,403);
  for(const role of ['bank','tpp','reviewer','standards']){assert.equal((await call(role,'/api/diagnostics')).status,403);assert.equal((await call(role,'/api/diagnostics','POST',{})).status,403);assert.equal((await call(role,'/api/runs','POST',{kind:'platform'})).status,403);assert.equal((await call(role,'/api/schedules','POST',{kind:'platform',minutes:60})).status,403)}
  const badRegistration=await call('bank','/api/connections','POST',{name:'Only a name'});assert.equal(badRegistration.status,400);assert(badRegistration.data.fieldErrors.bankName);assert(badRegistration.data.fieldErrors.baseUrl);
  const registration={name:'Registered sandbox',bankName:'Test institution',country:'GE',contactEmail:'api@example.com',profile:'xs2a-0.8',baseUrl:'https://sandbox.example.com/api',documentationUrl:'https://developer.example.com/docs',authMethod:'api_key',credentialReference:'sandbox/test/credentials',apiKeyHeader:'X-API-Key',operations:['accounts','balances'],timeoutMs:5000};
  assert.equal((await call('tpp','/api/connections','POST',registration)).status,403);
  const notAllowed=await call('bank','/api/connections','POST',{...registration,baseUrl:'https://unapproved.example.com'});assert.equal(notAllowed.status,400);assert(notAllowed.data.fieldErrors.baseUrl);
  const registered=await call('bank','/api/connections','POST',{...registration,clientSecret:'secret-must-not-persist'});assert.equal(registered.status,201);assert.equal(registered.data.status,'not_connected');assert.equal(registered.data.bankName,registration.bankName);assert.equal(registered.data.authentication.apiKeyHeader,'X-API-Key');assert.equal(registered.data.clientSecret,undefined);assert(Object.values(registered.data.capabilities).every(v=>v==='unknown'));
  assert(!JSON.stringify((await call('tpp','/api/workspace')).data).includes('sandbox/test/credentials'));
  const run=await call('operator','/api/diagnostics','POST',{});assert.equal(run.status,201);const done=await waitRun('operator',run.data.id);assert.equal(done.status,'completed');assert.equal(done.counts.PASS,25);
  assert.equal((await call('tpp','/api/runs/'+run.data.id)).status,404);
  assert.equal((await call('reviewer','/api/runs/'+run.data.id)).status,404);
  assert.equal((await call('bank','/api/runs/'+run.data.id+'/export/incompatibility')).status,404);
  assert.equal((await call('reviewer','/api/runs/'+run.data.id+'/export/csv')).status,404,'oversight does not receive raw sample exports');
  assert((await call('operator','/api/runs/'+run.data.id+'/export/quality')).data.includes('No regulatory threshold configured'));
  const pack=JSON.parse(fs.readFileSync(path.join(root,'examples','synthetic-evidence.json')));const imported=await call('bank','/api/packs','POST',pack);assert.equal(imported.status,201);
  assert.equal((await call('reviewer','/api/packs/'+imported.data.id)).status,403,'oversight must not receive raw transaction evidence by default');
  const evidenceRun=await call('bank','/api/runs','POST',{kind:'evidence',packId:imported.data.id});const reviewed=await waitRun('bank',evidenceRun.data.id);assert.equal(reviewed.evidenceMode,'synthetic_fixture');assert(reviewed.counts.NEEDS_REVIEW>0);assert(reviewed.metrics.every(x=>x.p50===null));
  const gate=await call('operator','/api/gates','POST',{runId:done.id,name:'Platform-only candidate'});assert.equal(gate.data.decision,'HOLD');
  const valid=await call('tpp','/api/normalize','POST',{synthetic:true,operation:'balances',body:{balances:[{balanceAmount:{amount:'1.50',currency:'GEL'},balanceType:'interimAvailable'}]}});assert.equal(valid.data.data.balances[0].amount,'1.50');
  assert.equal((await call('tpp','/api/normalize','POST',{synthetic:true,operation:'balances',body:{balances:[{balanceAmount:{amount:'1.50'},balanceType:'interimAvailable'}]}})).status,422);
  assert.equal((await call('tpp','/bridge/v1/connections/test/accounts')).status,503);
  assert.equal((await call('bank','/api/rules/COMMON-JSON/review','POST',{approve:true,note:'reviewed enough',confirm:true})).status,403);
  assert.equal((await call('standards','/api/rules/COMMON-JSON/review','POST',{approve:true,note:'Test-only applicability review for JSON support',confirm:true})).status,200);
  assert.equal((await call('bank','/api/rules/XS2A-ACCOUNT-NO-BBAN/review','POST',{approve:true,note:'Review test: legacy payment accounts',confirm:true})).status,403);
  assert.equal((await call('standards','/api/rules/XS2A-ACCOUNT-NO-BBAN/review','POST',{approve:true,note:'Test-only review of section 9.3.3 prohibited BBAN row',confirm:true})).status,200);
  const seededPack={...pack,profile:'xs2a-0.8'};const seededImport=await call('bank','/api/packs','POST',seededPack);const seededRun=await call('bank','/api/runs','POST',{kind:'evidence',packId:seededImport.data.id});const seededResult=await waitRun('bank',seededRun.data.id);assert(seededResult.results.some(r=>r.ruleId==='XS2A-ACCOUNT-NO-BBAN'&&['PASS','FAIL'].includes(r.verdict)));assert(seededResult.results.some(r=>r.id==='XS2A-ACCOUNT-IBAN'&&r.verdict==='NEEDS_REVIEW'));

  const bankWorkspace=(await call('bank','/api/workspace')).data;assert.equal(bankWorkspace.diagnosticsRuns.length,0);assert(bankWorkspace.runs.every(r=>r.kind!=='platform'));
  const readiness=await call('bank','/api/connections/'+bankWorkspace.connections[0].id+'/readiness');assert.equal(readiness.data.ready,false);assert.equal(readiness.data.reasons.length,3);assert.equal((await call('bank','/api/runs','POST',{kind:'bank',connectionId:bankWorkspace.connections[0].id})).status,409);assert.equal((await call('tpp','/api/connections/'+bankWorkspace.connections[0].id+'/readiness')).status,403);
  const uploaded=await call('bank','/api/connections/'+bankWorkspace.connections[0].id+'/spec','POST',{spec:{openapi:'3.0.3',info:{title:'Synthetic specification',version:'1'},paths:{'/accounts':{get:{responses:{200:{content:{'application/json':{schema:{type:'object'}}}}}}}}}});
  assert.equal(uploaded.status,200);assert(uploaded.data.runId);
  const specRun=await waitRun('bank',uploaded.data.runId);assert.equal(specRun.evidenceMode,'specification_only');assert(specRun.counts.NEEDS_REVIEW>0);assert(specRun.results.some(r=>r.id==='SPEC-OPENAPI'&&r.verdict==='PASS'));
  const x=await call('operator','/api/runs/'+done.id+'/explain','POST',{findingId:'S01',language:'ka'});assert.equal(x.data.mode,'deterministic_template');
  assert.equal((await call('tpp','/api/events')).data.some(x=>x.target===done.id),false);
  console.log('HTTP workflow verification passed. '+done.counts.PASS+' actual local controls.');
 }catch(e){console.error(logs);throw e}finally{proc.kill();await new Promise(r=>proc.once('exit',r));}
});
