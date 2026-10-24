import test from 'node:test';
import assert from 'node:assert/strict';
import {captureMock} from '../src/adapters/mock-audit.mjs';
import {generateNarrative} from '../src/report-narrative.mjs';
import {explain} from '../src/ai.mjs';

function fake({mappingFails=false,balanceFails=false,consentInvalid=false,emptyAccounts=false,setupFails=false,authenticationThrows=false}={}){
 const calls=[];let revoked=false;
 const adapter={version:'bog-mock-v1',transport:{request:async path=>{calls.push(path);if(path==='/openapi.json')return {status:200,body:{openapi:'3.0.3',paths:{}}};if(path.includes('not-a-real-account'))return {status:404,body:{}};if(authenticationThrows)throw Error('Authentication probe unavailable');return {status:401,body:{tppMessages:[{category:'ERROR',code:'UNAUTHORIZED',text:'Denied'}]}}}},
  async createConsent(){calls.push('create');if(setupFails)throw Error('Authorization setup failed');return {upstreamId:'consent'}},
  async completeAuthorization(c){calls.push('authorize');return c},async consentStatus(){return {consentStatus:consentInvalid?'invalid':'valid'}},
  async listAccounts(_c,kind){calls.push(kind==='negative'?'revoked-probe':'list');return {status:revoked?403:200,body:{accounts:[]}}},
  map(operation){if(operation==='accounts'){if(mappingFails)throw Error('Required account fields missing');return {accounts:emptyAccounts?[]:[{accountId:'a'},{accountId:'b'}]}}return {}},
  async getBalances(_c,id){calls.push('balances-'+id);if(balanceFails&&id==='a')throw Error('Invalid balance');return {status:200,body:{balances:[]}}},
  async listTransactions(_c,id){calls.push('transactions-'+id);return {data:{transactions:[]},pages:1}},
  async revokeConsent(){calls.push('revoke');revoked=true}
 };
 return {adapter,calls};
}
const capture=adapter=>captureMock({id:'mock-bog',adapter:'bog-mock-v1',profile:'xs2a-0.8'},{adapterFactory:()=>adapter});
const result=(run,key)=>run.results.find(f=>f.id==='BOG-MOCK-'+key);

test('account mapping failure preserves independent probes and explicitly blocks account-scoped families',async()=>{
 const {adapter,calls}=fake({mappingFails:true}),run=await capture(adapter);
 assert.equal(result(run,'ACCOUNTS').verdict,'FAIL');assert.equal(result(run,'UNKNOWN-ACCOUNT').verdict,'PASS');assert.equal(result(run,'REVOKED').verdict,'PASS');
 for(const key of ['BALANCES','PAGINATION']){assert.equal(result(run,key).verdict,'BLOCKED');assert.equal(result(run,key).blockedBy,'BOG-MOCK-ACCOUNTS');assert(result(run,key).observed.includes('Required account fields missing'));assert.equal(result(run,key).observationIndex,undefined)}
 assert(calls.includes('revoked-probe'));assert(!calls.some(c=>c.startsWith('balances-')||c.startsWith('transactions-')));assert(!result(run,'FLOW'));
});

test('one account balance failure does not suppress its transactions or other account checks',async()=>{
 const {adapter,calls}=fake({balanceFails:true}),run=await capture(adapter);assert.equal(result(run,'BALANCES-a').verdict,'FAIL');assert.equal(result(run,'PAGINATION-a').verdict,'PASS');assert.equal(result(run,'BALANCES-b').verdict,'PASS');assert.equal(result(run,'PAGINATION-b').verdict,'PASS');assert(calls.includes('transactions-b'));assert.equal(result(run,'REVOKED').verdict,'PASS');
});

test('empty account list is valid but dependent checks are explicitly blocked without invented account IDs',async()=>{
 const {adapter}=fake({emptyAccounts:true}),run=await capture(adapter);assert.equal(result(run,'ACCOUNTS').verdict,'PASS');assert.equal(result(run,'BALANCES').verdict,'BLOCKED');assert(result(run,'BALANCES').observed.includes('No accounts were returned'));assert.equal(result(run,'PAGINATION').verdict,'BLOCKED');assert.equal(result(run,'REVOKED').verdict,'PASS');
});

test('failed authorization setup records every unexecuted check family as blocked, not failed',async()=>{
 const {adapter}=fake({setupFails:true}),run=await capture(adapter);assert.equal(result(run,'FLOW').verdict,'FAIL');const blocked=run.results.filter(f=>f.verdict==='BLOCKED');assert.equal(blocked.length,8);assert(blocked.every(f=>f.blockedBy==='BOG-MOCK-FLOW'));assert.equal(run.results.filter(f=>f.verdict==='FAIL').length,1);
});

test('invalid consent blocks dependent work and performs cleanup without claiming a revocation test passed',async()=>{
 const {adapter,calls}=fake({consentInvalid:true}),run=await capture(adapter);assert.equal(result(run,'CONSENT').verdict,'FAIL');assert.equal(result(run,'ACCOUNTS').verdict,'BLOCKED');assert.equal(result(run,'REVOKED').verdict,'BLOCKED');assert(calls.includes('revoke'));assert(!calls.includes('list'));assert(!calls.includes('revoked-probe'));
});

test('an independent authentication probe exception does not abort valid account or revocation tests',async()=>{
 const {adapter}=fake({authenticationThrows:true}),run=await capture(adapter);assert.equal(result(run,'AUTH').verdict,'FAIL');assert.equal(result(run,'ERROR-SHAPE').verdict,'BLOCKED');assert.equal(result(run,'ACCOUNTS').verdict,'PASS');assert.equal(result(run,'REVOKED').verdict,'PASS');
});

test('blocked-only results never trigger an AI request',async()=>{
 const snapshot={run:{kind:'bank'},findings:[{id:'blocked',verdict:'BLOCKED',expected:'Account discovery',observed:'Blocked by account mapping',title:'Balances',impact:'Unknown',remediation:'Rerun after prerequisite'}]};let called=false;
 const narrative=await generateNarrative(snapshot,{config:{configured:true,key:'test',model:'test'},fetchImpl:()=>{called=true;throw Error('must not call')}});assert.equal(called,false);assert.equal(narrative.reason,'no_actionable_findings');assert.deepEqual(narrative.findings,[]);
 const finding=await explain(snapshot.findings[0],'en',{config:{configured:true,key:'test',model:'test'},fetchImpl:()=>{called=true;throw Error('must not call')}});assert.equal(finding.mode,'deterministic_template');assert.equal(called,false);
});
