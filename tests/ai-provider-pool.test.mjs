import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {aiConfig} from '../src/ai-config.mjs';
import {createProviderRouter,requestStructured} from '../src/ai-providers.mjs';
import {generateNarrative,narrativeFacts} from '../src/report-narrative.mjs';
const schema={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
const connection=(provider,id=provider,quotaGroup=provider)=>({id,provider,key:'private-'+id,model:'test-model',quotaGroup});
const options={instructions:'Return JSON',input:'input facts',schema,signal:AbortSignal.timeout(10000),validate:v=>v};
const json=value=>new Response(JSON.stringify(value));
function success(provider,value){if(provider==='openai')return json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});if(provider==='claude')return json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}]});if(provider==='gemini')return json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});return json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]})}

test('each official provider uses its correct authentication and structured-output protocol',async()=>{
 for(const provider of ['openai','gemini','claude','grok']){
  const result=await requestStructured(connection(provider),{...options,fetchImpl:async(url,request)=>{
   const body=JSON.parse(request.body);assert.equal(request.redirect,'error');if(provider==='gemini')assert(url.includes('test-model'));else assert.equal(body.model,'test-model');
   if(provider==='openai'){assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.text.format.strict,true)}
   if(provider==='grok'){assert.equal(url,'https://api.x.ai/v1/chat/completions');assert.equal(body.response_format.json_schema.strict,true)}
   if(provider==='claude'){assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(request.headers['x-api-key'],'private-claude');assert.equal(request.headers['anthropic-version'],'2023-06-01');assert.equal(body.output_config.format.type,'json_schema')}
   if(provider==='gemini'){assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent');assert.equal(request.headers['x-goog-api-key'],'private-gemini');assert.equal(body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON')}
   return success(provider,{value:'ok'});
  }});assert.deepEqual(result,{value:'ok'});
 }
});

test('rate-limit failover skips keys sharing the same model quota and respects Retry-After',async()=>{
 let now=100000,calls=0;const router=createProviderRouter({now:()=>now});
 const connections=[connection('openai','first'),connection('openai','second'),connection('gemini')];
 const fetchImpl=async url=>{calls++;return url.includes('openai')?new Response('{"error":{"code":"rate_limit_exceeded"}}',{status:429,headers:{'retry-after':'120'}}):success('gemini',{value:'ok'})};
 const first=await router.generate({...options,connections,fetchImpl});assert.equal(first.provider,'gemini');assert.equal(calls,2);assert.equal(first.attempts[1].skipped,true);
 const second=await router.generate({...options,connections,fetchImpl});assert.equal(second.provider,'gemini');assert.equal(calls,3);
 now+=121000;await router.generate({...options,connections,fetchImpl});assert.equal(calls,5);
});

test('invalid credentials cool only that connection; another permitted connection can answer',async()=>{
 const router=createProviderRouter();let calls=0;
 const result=await router.generate({...options,connections:[connection('openai','bad'),connection('openai','good')],fetchImpl:async()=>++calls===1?new Response('{}',{status:401}):success('openai',{value:'ok'})});assert.equal(result.connectionId,'good');assert.equal(result.attempts[0].reason,'authentication_failed');
 const changed=await router.generate({...options,connections:[connection('gemini','bad')],fetchImpl:async()=>success('gemini',{value:'ok'})});assert.equal(changed.provider,'gemini','changing provider must not inherit another provider credential failure');
});

test('exhausted quota is persisted across routers and shared across models of that quota group',async()=>{
 const db=new DatabaseSync(':memory:');const first=createProviderRouter({db});const c=connection('openai');
 await assert.rejects(()=>first.generate({...options,connections:[c],fetchImpl:async()=>new Response('{"error":{"code":"insufficient_quota"}}',{status:429})}),/providers_unavailable/);
 const restarted=createProviderRouter({db});let calls=0;const result=await restarted.generate({...options,connections:[{...c,model:'other-model'},connection('grok')],fetchImpl:async()=>{calls++;return success('grok',{value:'ok'})}});assert.equal(calls,1);assert.equal(result.provider,'grok');assert.equal(result.attempts[0].reason,'quota_exhausted');db.close();
});

test('invalid AI facts fail validation before moving to the next provider',async()=>{
 const snapshot={findings:[{id:'field',title:'Currency',verdict:'FAIL',expected:'Currency exists',observed:'Currency missing',impact:'Mapping may fail.',remediation:'Return the currency.'}]};
 const facts=narrativeFacts(snapshot),good={findings:facts.map(f=>({reference:f.reference,verdict:f.verdict,expected:f.expected,observed:f.observed,summary:'The recorded response lacks a currency.',impact:'Mapping may fail.',remediation:'Return the currency.'}))};const bad=structuredClone(good);bad.findings[0].verdict='PASS';
 const result=await generateNarrative(snapshot,{config:{configured:true,connections:[connection('openai'),connection('claude')]},router:createProviderRouter(),fetchImpl:async url=>url.includes('openai')?success('openai',bad):success('claude',good)});
 assert.equal(result.mode,'live_ai_advisory');assert.equal(result.provider,'claude');assert.equal(result.findings[0].verdict,'FAIL');assert.equal(result.attempts[0].reason,'validation_or_transport_failed');assert(!JSON.stringify(result).includes('private-'));
});

test('per-connection timeout leaves time for another provider and all exhausted providers use the template',async()=>{
 const router=createProviderRouter({attemptTimeoutMs:10});
 const result=await router.generate({...options,connections:[connection('openai'),connection('gemini')],fetchImpl:async(url,{signal})=>url.includes('openai')?new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});setTimeout(()=>reject(Error('test deadline')),30)}):success('gemini',{value:'ok'})});assert.equal(result.provider,'gemini');assert.equal(result.attempts[0].reason,'timeout');
 const snapshot={findings:[{id:'field',title:'Field',verdict:'FAIL',expected:'Evidence',observed:'Missing',impact:'Unknown.',remediation:'Capture evidence.'}]};let calls=0;
 const fallback=await generateNarrative(snapshot,{config:{configured:true,connections:[connection('openai'),connection('gemini'),connection('grok')]},fetchImpl:async()=>{calls++;return new Response('{}',{status:503})}});assert.equal(calls,3);assert.equal(fallback.mode,'deterministic_template');assert.equal(fallback.reason,'providers_unavailable');
});

test('attempt budget bounds failover even with many configured connections',async()=>{let calls=0;const router=createProviderRouter();await assert.rejects(()=>router.generate({...options,connections:Array.from({length:100},(_,i)=>connection('openai','key-'+i,'separate-account-'+i)),attemptBudget:{remaining:3},fetchImpl:async()=>{calls++;return new Response('{}',{status:503})}}));assert.equal(calls,3)});

test('private compatible endpoints are rejected before a key is sent',async()=>{let called=false;await assert.rejects(()=>requestStructured({...connection('compatible'),baseUrl:'https://127.0.0.1/v1'},{...options,fetchImpl:async()=>{called=true}}));assert.equal(called,false)});

test('pool configuration accepts ordered provider keys and arbitrary model IDs, rotates and disables at runtime',()=>{
 const filename=path.join(os.tmpdir(),'geobridge-pool-'+crypto.randomUUID()+'.json');
 try{const entries=['gemini','claude','grok','openai'].map((provider,i)=>({id:'key-'+i,provider,model:'chosen-model-'+i,keyEnv:'TEST_KEY_'+i}));const env={GEOBRIDGE_AI_POOL_FILE:filename,TEST_KEY_0:'private-0',TEST_KEY_1:'private-1',TEST_KEY_2:'private-2',TEST_KEY_3:'private-3'};
  fs.writeFileSync(filename,JSON.stringify({connections:entries}));const initial=aiConfig(env);assert(initial.configured);assert.deepEqual(initial.connections.map(c=>c.provider),['gemini','claude','grok','openai']);
  entries[0].enabled=false;entries.reverse();fs.writeFileSync(filename,JSON.stringify({connections:entries}));const changed=aiConfig(env);assert.equal(changed.connections.length,3);assert.notEqual(changed.model,initial.model);
  assert.notEqual(aiConfig({...env,TEST_KEY_1:'rotated-key'}).model,changed.model);
  entries.push({...entries[0]});fs.writeFileSync(filename,JSON.stringify({connections:entries}));assert.equal(aiConfig(env).configured,false,'duplicate IDs fail closed');
 }finally{fs.rmSync(filename,{force:true})}
});
