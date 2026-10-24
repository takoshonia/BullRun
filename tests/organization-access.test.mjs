import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('organization accounts enforce bank isolation, NBG review powers and TPP privacy over HTTP',{timeout:45000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geobridge-role-access-')),origin='http://127.0.0.1:15481';
 const proc=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:'15481',GEOBRIDGE_ORIGIN:origin,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_MOCK_TARGETS:'[]'},stdio:'ignore'});
 try{
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break}catch{}await sleep(100)}
  const fixtureDB=new DatabaseSync(path.join(dir,'geobridge.sqlite'));
  for(const bank of ['bog','tbc','gringott']){const c={id:'bank-'+bank+'-sandbox',name:'Test-owned '+bank+' connection',tenant:'bank-'+bank,status:'not_connected',environment:'pending',profile:'xs2a-0.8',capabilities:{accounts:'unknown'}};fixtureDB.prepare('INSERT INTO records VALUES(?,?,?)').run('connections',c.id,JSON.stringify(c))}fixtureDB.close();
  const credentials=JSON.parse(fs.readFileSync(path.join(dir,'demo-credentials.json'))),sessions={};
  for(const c of credentials){const r=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(c)});assert.equal(r.status,200,c.username);const data=await r.json();sessions[c.username]={cookie:r.headers.get('set-cookie').split(';')[0],csrf:data.csrf}}
  assert.deepEqual(credentials.map(c=>c.username).sort(),['operator','bank-bog','bank-tbc','bank-gringott','nbg','tpp-demo'].sort());
  async function call(user,url,method='GET',body){const session=sessions[user];const r=await fetch(origin+url,{method,headers:{Origin:origin,Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}}
  for(const bank of ['bog','tbc','gringott']){const w=(await call('bank-'+bank,'/api/workspace')).data;assert(w.connections.length);assert(w.connections.every(c=>c.tenant==='bank-'+bank));assert(w.rules.every(r=>r.status==='approved'));assert.equal(w.diagnosticsRuns.length,0)}
  assert.equal((await call('bank-bog','/api/connections/bank-tbc-sandbox/readiness')).status,404);
  assert.equal((await call('bank-bog','/api/runs','POST',{kind:'spec',connectionId:'bank-tbc-sandbox'})).status,404);
  for(const user of ['nbg','tpp-demo'])assert.equal((await call(user,'/api/connections','POST',{})).status,403);
  const w=(await call('nbg','/api/workspace')).data;assert.equal(w.connections.length,3);assert(w.connections.every(c=>!c.authentication&&!c.baseUrl));assert(w.rules.some(r=>r.status==='draft'));
  for(const user of ['nbg','bank-bog','tpp-demo']){assert.equal((await call(user,'/api/diagnostics')).status,403);assert.equal((await call(user,'/api/schedules','POST',{kind:'platform',minutes:60})).status,403)}
  assert.equal((await call('nbg','/api/connections/bank-bog-sandbox/spec','POST',{spec:{}})).status,403);
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'examples/synthetic-evidence.json')));
  const pack=(await call('bank-bog','/api/packs','POST',fixture)).data;
  const run=(await call('nbg','/api/runs','POST',{kind:'evidence',packId:pack.id}));assert.equal(run.status,201);assert.equal(run.data.tenant,'bank-bog');
  let completed;for(let i=0;i<100;i++){completed=(await call('nbg','/api/runs/'+run.data.id)).data;if(completed.status==='completed')break;await sleep(100)}assert.equal(completed.status,'completed');
  for(const user of ['bank-tbc','bank-gringott','tpp-demo']){
   assert.equal((await call(user,'/api/runs/'+completed.id)).status,404);
   assert.equal((await call(user,'/api/runs/'+completed.id+'/export/json')).status,404);
   assert.equal((await call(user,'/api/reports/'+completed.reportId)).status,user==='tpp-demo'?403:404);
  }
  assert.equal((await call('bank-bog','/api/reports/'+completed.reportId)).status,200);
  const schedule=await call('nbg','/api/schedules','POST',{kind:'evidence',packId:pack.id,minutes:60});assert.equal(schedule.status,201);assert.equal(schedule.data.tenant,'bank-bog');assert.equal(schedule.data.owner,'nbg');
  assert((await call('bank-bog','/api/workspace')).data.schedules.some(s=>s.id===schedule.data.id));assert(!(await call('bank-tbc','/api/workspace')).data.schedules.some(s=>s.id===schedule.data.id));assert.equal((await call('bank-tbc','/api/schedules/'+schedule.data.id,'DELETE')).status,404);
  assert.equal((await call('bank-bog','/api/gates','POST',{runId:completed.id})).status,403);
  const gate=await call('nbg','/api/gates','POST',{runId:completed.id});assert.equal(gate.status,201);assert.equal(gate.data.tenant,'bank-bog');assert.equal(gate.data.actor,'nbg');
  assert.equal((await call('tpp-demo','/api/sources?file='+encodeURIComponent(w.rules[0].source))).status,403);
  assert(!(await call('tpp-demo','/api/events')).data.some(e=>e.target===completed.id));
  assert((await call('bank-bog','/api/events')).data.some(e=>e.target===schedule.data.id));assert(!(await call('bank-tbc','/api/events')).data.some(e=>e.target===schedule.data.id));
  assert.equal((await call('nbg','/api/rules/COMMON-JSON/review','POST',{approve:true,confirm:true,note:'Demo NBG applicability review of the original source.'})).status,200);
  assert.equal((await call('operator','/api/diagnostics')).status,200);
 }finally{proc.kill();await new Promise(resolve=>proc.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true})}
});

test('upgrade preserves Operator, retires legacy shared identities and is idempotent',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'geobridge-role-upgrade-'));
 const env={...process.env,GEOBRIDGE_DATA_DIR:dir};
 async function run(source){const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd:root,env,stdio:'pipe'});let errors='';child.stderr.on('data',x=>errors+=x);const code=await new Promise(resolve=>child.once('exit',resolve));assert.equal(code,0,errors)}
 try{
  await run("import {seed,put,db} from './src/store.mjs';seed();put('users',{id:'bank',role:'bank',tenant:'bank-demo',password:'legacy'});put('users',{id:'standards',role:'standards',tenant:'standards',password:'legacy'});put('schedules',{id:'old',owner:'bank',enabled:true});db.close()");
  await run("import {put,db} from './src/store.mjs';put('connections',{id:'bank-bog-sandbox',tenant:'bank-bog',name:'BOG sandbox',status:'not_connected',environment:'pending',baseUrl:'',specHash:null,adapter:null});put('connections',{id:'bank-tbc-sandbox',tenant:'bank-tbc',name:'TBC sandbox',status:'not_connected',environment:'pending',baseUrl:'https://configured.example'});put('connections',{id:'bank-gringott-sandbox',tenant:'bank-gringott',name:'Gringott demo bank engineer sandbox',status:'not_connected',environment:'pending'});put('runs',{id:'historical',connectionId:'bank-gringott-sandbox'});db.close()");
  let db=new DatabaseSync(path.join(dir,'geobridge.sqlite'));const operator=db.prepare("SELECT json FROM records WHERE kind='users' AND id='operator'").get().json;db.close();
  const provision="import {provisionDemoAccounts,db} from './src/store.mjs';provisionDemoAccounts();db.close()";
  await run(provision);const original=fs.readFileSync(path.join(dir,'demo-credentials.json'),'utf8');await run(provision);assert.equal(fs.readFileSync(path.join(dir,'demo-credentials.json'),'utf8'),original);
  db=new DatabaseSync(path.join(dir,'geobridge.sqlite'));assert.equal(db.prepare("SELECT json FROM records WHERE kind='users' AND id='operator'").get().json,operator);assert.equal(JSON.parse(db.prepare("SELECT json FROM records WHERE kind='users' AND id='bank'").get().json).disabled,true);assert.equal(JSON.parse(db.prepare("SELECT json FROM records WHERE kind='schedules' AND id='old'").get().json).enabled,false);assert.equal(db.prepare("SELECT json FROM records WHERE kind='connections' AND id='bank-bog-sandbox'").get(),undefined);assert(db.prepare("SELECT json FROM records WHERE kind='retired_connections' AND id='bank-bog-sandbox'").get());assert(db.prepare("SELECT json FROM records WHERE kind='connections' AND id='bank-tbc-sandbox'").get());assert(db.prepare("SELECT json FROM records WHERE kind='connections' AND id='bank-gringott-sandbox'").get());db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
