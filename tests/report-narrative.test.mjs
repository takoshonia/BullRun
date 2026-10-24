import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createReportStore} from '../src/reports.mjs';
import {createNarrativeJobs} from '../src/report-narrative-jobs.mjs';
import {aiConfig} from '../src/ai-config.mjs';
import {generateNarrative,narrativeFacts,templateNarrative,validateNarrative} from '../src/report-narrative.mjs';
const config={key:'test-key-never-persist',model:'test-model',configured:true};
function setup(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(kind TEXT,id TEXT,json TEXT,PRIMARY KEY(kind,id));CREATE TABLE events(id INTEGER PRIMARY KEY,at TEXT,actor TEXT,action TEXT,target TEXT,detail TEXT)');const reports=createReportStore(db);const run={id:'audit',tenant:'bank-a',kind:'evidence',status:'completed',results:[{id:'currency',title:'Currency',layer:'compatibility',verdict:'FAIL',expected:'Currency is present',observed:'Missing currency; Bearer secret-value',fix:'Return the currency.'}],metrics:[],counts:{FAIL:1}};const completed=reports.complete(run);return {db,reports,run,source:reports.get(completed.reportId)}}
function output(facts){return {findings:facts.map(f=>({reference:f.reference,verdict:f.verdict,expected:f.expected,observed:f.observed,summary:'The recorded currency check found missing data.',impact:'The common interface may not represent the response safely.',remediation:'Return the currency and repeat the recorded check.'}))}}
const response=value=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200});

test('structured English AI request uses only redacted findings and validates exact evidence',async()=>{
 const {db,source}=setup();let request;
 const result=await generateNarrative(source.snapshot,{config,fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(options.body);return response(output(narrativeFacts(source.snapshot)))}});
 assert.equal(result.mode,'live_ai_advisory');assert.equal(result.language,'en');assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert(!request.input.includes('secret-value'));assert(!request.input.includes('bank-a'));assert(!JSON.stringify(result).includes(config.key));assert.equal(result.findings[0].observed,source.snapshot.findings[0].observed);db.close();
});

test('missing configuration never calls a provider and produces complete English template explanations',async()=>{const {db,source}=setup();const result=await generateNarrative(source.snapshot,{config:{configured:false},fetchImpl:()=>{throw Error('must not call')}});assert.equal(result.mode,'deterministic_template');assert.equal(result.reason,'not_configured');assert.equal(result.findings.length,source.snapshot.findings.length);assert.equal(result.findings[0].verdict,'FAIL');db.close()});

test('unsupported claims, changed results, missing findings and non-English output are rejected',()=>{
 const {db,source}=setup(),facts=narrativeFacts(source.snapshot);
 for(const change of [v=>v.findings[0].verdict='PASS',v=>v.findings[0].reference='another-finding',v=>v.findings[0].observed='Changed',v=>v.findings[0].summary='Latency is 999 ms.',v=>v.findings[0].summary='This bank is fully compliant.',v=>v.findings[0].summary='The operation passed.',v=>v.findings[0].summary='ქართული განმარტება',v=>v.findings[0].remediation='<script>unsafe</script>',v=>v.findings.pop()]){const value=output(facts);change(value);assert.throws(()=>validateNarrative(value,facts))}db.close();
});

test('provider errors, refusal, malformed or incomplete output and timeout use labelled template fallback',async()=>{
 const {db,source}=setup();
 for(const [fetchImpl,reason] of [[async()=>new Response('{}',{status:401}),'authentication_failed'],[async()=>new Response('{}',{status:429}),'rate_limited'],[async()=>new Response('{}',{status:503}),'provider_unavailable'],[async()=>new Response(JSON.stringify({status:'incomplete'})),'incomplete_response'],[async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'refusal'}]}]})),'provider_refusal'],[async()=>response({findings:[]}),'validation_or_transport_failed'],[async(_url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});setTimeout(()=>reject(Error('test deadline')),50)}),'timeout']]){const value=await generateNarrative(source.snapshot,{config,fetchImpl,timeoutMs:10});assert.equal(value.mode,'deterministic_template');assert.equal(value.reason,reason);assert.equal(value.findings.length,1)}db.close();
});

test('batch output is checked against its own references and partial output is never saved',async()=>{
 const {db,source}=setup();source.snapshot.findings=Array.from({length:9},(_,i)=>({...source.snapshot.findings[0],id:'check-'+i}));let requests=0;
 const result=await generateNarrative(source.snapshot,{config,fetchImpl:async(_url,options)=>{requests++;const facts=JSON.parse(JSON.parse(options.body).input).findings;return response(output(facts))}});assert.equal(requests,2);assert.equal(result.mode,'live_ai_advisory');assert.equal(result.findings.length,9);db.close();
});

test('durable job saves a new version from the original snapshot and duplicate requests reuse the job',async()=>{
 const {db,reports,source,run}=setup();let calls=0;const jobs=createNarrativeJobs(db,reports,{generate:async(snapshot)=>{calls++;return generateNarrative(snapshot,{config,fetchImpl:async()=>response(output(narrativeFacts(snapshot)))})}});
 const queued=jobs.enqueue(source.id,'bank-user');assert.equal(jobs.enqueue(source.id,'bank-user').id,queued.id);
 // Changes to mutable run records must not change the facts supplied to the model.
 db.prepare("UPDATE records SET json=? WHERE kind='runs' AND id=?").run(JSON.stringify({...run,results:[]}),run.id);
 await Promise.all([jobs.tick(),jobs.tick()]);const job=jobs.get(queued.id),saved=reports.get(job.reportId);
 assert.equal(calls,1);assert.equal(job.status,'completed');assert.equal(saved.version,2);assert.equal(saved.snapshot.narrative.mode,'live_ai_advisory');assert.equal(saved.snapshot.narrative.sourceReportId,source.id);assert.deepEqual(saved.snapshot.findings,source.snapshot.findings);assert.equal(reports.get(source.id).html,source.html);assert(saved.html.includes('AI-assisted advisory explanations'));assert.equal(jobs.enqueue(source.id).reportId,saved.id);db.close();
});

test('failed AI output still saves a complete fallback version, without mutating the base report',async()=>{const {db,reports,source}=setup();const jobs=createNarrativeJobs(db,reports,{generate:snapshot=>generateNarrative(snapshot,{config,fetchImpl:async()=>response({findings:[]})})});const job=jobs.enqueue(source.id);await jobs.tick();const saved=reports.get(jobs.get(job.id).reportId);assert.equal(saved.snapshot.narrative.reason,'validation_or_transport_failed');assert(saved.html.includes('Template explanations'));assert.deepEqual(saved.snapshot.findings,source.snapshot.findings);db.close()});

test('interrupted persisted job is recovered after its lease expires',async()=>{const {db,reports,source}=setup();const jobs=createNarrativeJobs(db,reports,{generate:async s=>templateNarrative(s)}),queued=jobs.enqueue(source.id);db.prepare("UPDATE report_narrative_jobs SET status='running',started_at=?,attempts=1 WHERE id=?").run('2000-01-01T00:00:00Z',queued.id);await jobs.tick();assert.equal(jobs.get(queued.id).status,'completed');assert.equal(jobs.get(queued.id).attempts,2);db.close()});

test('only newly completed configured reports enroll automatically; old reports stay untouched',async()=>{
 const {db,reports,source}=setup();const previousKey=process.env.GEOBRIDGE_AI_KEY,previousModel=process.env.GEOBRIDGE_AI_MODEL;
 try{process.env.GEOBRIDGE_AI_KEY='test';process.env.GEOBRIDGE_AI_MODEL='test-model';const run={id:'new',tenant:'bank-a',kind:'evidence',status:'completed',results:[],metrics:[]};const completed=reports.complete(run);const jobs=createNarrativeJobs(db,reports,{generate:async s=>templateNarrative(s,'no_findings')});await jobs.tick();assert.equal(reports.history('new').length,2);assert.equal(reports.history(source.runId).length,1);assert.equal(reports.get(completed.reportId).snapshot.narrative.reason,'pending_ai')}finally{if(previousKey===undefined)delete process.env.GEOBRIDGE_AI_KEY;else process.env.GEOBRIDGE_AI_KEY=previousKey;if(previousModel===undefined)delete process.env.GEOBRIDGE_AI_MODEL;else process.env.GEOBRIDGE_AI_MODEL=previousModel;db.close()}
});

test('secret files can be updated at runtime and unreadable configuration fails closed',()=>{
 const keyFile=path.join(os.tmpdir(),'geobridge-ai-'+crypto.randomUUID());
 try{fs.writeFileSync(keyFile,'test-secret');assert.equal(aiConfig({GEOBRIDGE_AI_KEY_FILE:keyFile,GEOBRIDGE_AI_MODEL:'test-model'}).configured,true);fs.writeFileSync(keyFile,'');assert.equal(aiConfig({GEOBRIDGE_AI_KEY_FILE:keyFile,GEOBRIDGE_AI_MODEL:'test-model'}).configured,false);assert.equal(aiConfig({GEOBRIDGE_AI_KEY_FILE:keyFile+'missing',GEOBRIDGE_AI_MODEL:'test-model'}).configured,false);assert.equal(aiConfig({GEOBRIDGE_AI_KEY_FILE:keyFile+'missing',GEOBRIDGE_AI_KEY:'explicit-env-key',GEOBRIDGE_AI_MODEL:'test-model'}).configured,true)}finally{fs.rmSync(keyFile,{force:true})}
});
