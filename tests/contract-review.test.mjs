import test from 'node:test';import assert from 'node:assert/strict';
import {schemaDiff,validateSchema,copyAmount,createContractReview,contractHash} from '../src/contract-review.mjs';
const amount='1234567890123456789.00100';
const body={balances:[{balanceAmount:{amount,currency:'GEL'},balanceType:'closingBooked'}]};
const amountSchema={type:'object',required:['amount','currency'],properties:{amount:{type:'string'},currency:{type:'string',enum:['GEL','EUR']}}};
const balanceSchema={type:'object',required:['balanceAmount','balanceType'],properties:{balanceType:{type:'string'},balanceAmount:amountSchema}};
const doc={openapi:'3.0.3',info:{title:'Synthetic'},paths:{'/v1/accounts/{id}/balances':{get:{responses:{200:{content:{'application/json':{schema:{$ref:'#/components/schemas/Balances'}}}}}}}},components:{schemas:{Balances:{type:'object',required:['balances'],properties:{balances:{type:'array',items:balanceSchema}}}}}};

function setup(options={}){const records=new Map(),events=[];const all=kind=>[...(records.get(kind)?.values()||[])];const get=(kind,id)=>records.get(kind)?.get(id);const put=(kind,v)=>{if(!records.has(kind))records.set(kind,new Map());records.get(kind).set(v.id,structuredClone(v));return v};let unavailable=false,schema=structuredClone(doc);
 const service=createContractReview({...options,all,get,put,event:(...args)=>events.push(args),targets:()=>[{id:'mock-bog'}],adapterFactory:()=>({transport:{request:async()=>{if(unavailable)throw Error('TIMEOUT');return {status:200,body:structuredClone(schema)}}},createConsent:async()=>({}),completeAuthorization:async()=>({}),revokeConsent:async()=>{},listAccounts:async()=>({status:200,body:{accounts:[{accountId:'a'}]}}),getBalances:async()=>({status:200,body:structuredClone(body)}),map:(op,b)=>op==='accounts'?b:{balances:b.balances.map(x=>({amount:x.balanceAmount.amount,currency:x.balanceAmount.currency}))}})});
 return {service,all,get,put,events,unavailable:()=>unavailable=true,setSchema:next=>schema=next};}
test('schema hashing ignores key order and diff detects required/type/enum/endpoints',()=>{
 assert.equal(contractHash({b:1,a:2}),contractHash({a:2,b:1}));const next=structuredClone(doc);next.components.schemas.Balances.required=[];next.paths['/new']={get:{}};next.components.schemas.Balances.properties.balances.items.properties.balanceType.type='number';const changes=schemaDiff(doc,next);assert(changes.some(c=>c.path.endsWith('/required')));assert(changes.some(c=>c.path.endsWith('/type')));assert(changes.some(c=>c.classification==='additive_review'));
});
test('local-ref structural validation rejects absent fields, incompatible types and enum values',()=>{
 assert.deepEqual(validateSchema(doc,{$ref:'#/components/schemas/Balances'},body),[]);const bad=structuredClone(body);bad.balances[0].balanceAmount.currency='USD';delete bad.balances[0].balanceAmount.amount;const errors=validateSchema(doc,{$ref:'#/components/schemas/Balances'},bad);assert(errors.some(x=>x.includes('required')));assert(errors.some(x=>x.includes('enum')));
});
test('field copies preserve exact decimal strings and reject ambiguity, numbers and unallowlisted expressions',()=>{
 const raw=structuredClone(body);raw.balances[0].balanceAmount.sum=amount;delete raw.balances[0].balanceAmount.amount;const mapping={operation:'balances',sourceField:'sum',destination:'balanceAmount.amount'};assert.equal(copyAmount(raw,mapping).balances[0].balanceAmount.amount,amount);assert(!Object.hasOwn(raw.balances[0].balanceAmount,'amount'));raw.balances[0].balanceAmount.amount=amount;assert.throws(()=>copyAmount(raw,mapping));delete raw.balances[0].balanceAmount.amount;raw.balances[0].balanceAmount.sum=12;assert.throws(()=>copyAmount(raw,mapping));assert.throws(()=>copyAmount(raw,{...mapping,sourceField:'__proto__'}));
});
test('versioned workflow requires original baseline, successful test and semantic approval; rollback fails closed',async()=>{
 const {service:s,all,get}=setup();const original=await s.scan('mock-bog');await s.scan('mock-bog');assert.equal(all('contract_snapshots').length,1);s.baseline('mock-bog',original.id,'nbg','Reviewed original mock specification');s.demo('mock-bog',true,'operator');const changed=await s.scan('mock-bog');await s.scan('mock-bog');assert.equal(all('contract_changes').length,1);assert.equal(all('contract_notifications').length,1);assert.throws(()=>s.baseline('mock-bog',changed.id,'nbg','Review synthetic baseline'));
 assert.throws(()=>s.process('mock-bog','balances',body),/CONTRACT/);const c=await s.propose('mock-bog',{operation:'balances',sourceField:'sum',destination:'balanceAmount.amount'},'operator');assert.throws(()=>s.activate(c.id,'operator'));assert.throws(()=>s.approve(c.id,'nbg','Reviewed semantic equivalence'));
 await s.test(c.id,'operator');assert.throws(()=>s.activate(c.id,'operator'));s.approve(c.id,'nbg','Reviewed synthetic field origin and identical currency semantics');s.activate(c.id,'operator');const result=s.process('mock-bog','balances',body);assert.equal(result.body.balances[0].balanceAmount.amount,amount);assert.equal(result.proof.original[0].fields.sum,amount);assert.equal(result.proof.mappingVersion,c.id);
 s.rollback('mock-bog','operator');assert.throws(()=>s.process('mock-bog','balances',body),/CONTRACT/);s.demo('mock-bog',false,'operator');await s.scan('mock-bog');assert.equal(s.process('mock-bog','balances',body).body.balances[0].balanceAmount.amount,amount);assert.equal(get('contract_scan_status','mock-bog').snapshotId,original.id);
});
test('unavailable schema does not create a change and failure tests remain recorded',async()=>{
 const x=setup();const original=await x.service.scan('mock-bog');x.service.baseline('mock-bog',original.id,'nbg','Original reviewed contract');const c=await x.service.propose('mock-bog',{operation:'balances',sourceField:'sum',destination:'balanceAmount.amount'},'operator');await assert.rejects(x.service.test(c.id,'operator'));assert.equal(x.all('contract_tests')[0].passed,false);x.unavailable();await assert.rejects(x.service.scan('mock-bog'));assert.equal(x.all('contract_changes').length,0);assert.equal(x.get('contract_scan_status','mock-bog').status,'unavailable');
});

test('AI candidates are validated, contain no sample values, remain drafts and unavailable AI never prevents detection',async()=>{
 let input;const router={generate:async request=>{input=request.input;return {value:request.validate({sourceField:'sum'}),provider:'test',model:'test'}}};
 const x=setup({router,getAIConfig:()=>({configured:true,connections:[]})});await x.service.scan('mock-bog');x.service.demo('mock-bog',true,'operator');await x.service.scan('mock-bog');const c=await x.service.suggest('mock-bog','operator');assert.equal(c.origin,'live_ai_candidate');assert.equal(c.status,'draft');assert(!input.includes(amount));assert.equal(x.all('contract_active').length,0);
 router.generate=async request=>{request.validate({sourceField:'execute(code)'})};assert.equal((await x.service.suggest('mock-bog','operator')).mode,'unavailable');assert.equal(x.all('contract_candidates').length,1);
 const offline=setup({getAIConfig:()=>({configured:false})});await offline.service.scan('mock-bog');assert.equal((await offline.service.suggest('mock-bog','operator')).mode,'unavailable');assert.equal(offline.all('contract_snapshots').length,1);
});

test('schema revision invalidates an approved mapping instead of silently reusing it',async()=>{
 const x=setup(),s=x.service;const base=await s.scan('mock-bog');s.baseline('mock-bog',base.id,'nbg','Reviewed source baseline');s.demo('mock-bog',true,'operator');await s.scan('mock-bog');const c=await s.propose('mock-bog',{operation:'balances',sourceField:'sum',destination:'balanceAmount.amount'},'operator');await s.test(c.id,'operator');s.approve(c.id,'nbg','Reviewed exact demo alias semantics');s.activate(c.id,'operator');
 const next=structuredClone(doc);next.info.version='2';x.setSchema(next);await s.scan('mock-bog');assert.throws(()=>s.process('mock-bog','balances',body),/stale/);assert.throws(()=>s.activate(c.id,'operator'));assert.throws(()=>s.approve(c.id,'nbg','Reusing a stale proposal is forbidden'));
});
