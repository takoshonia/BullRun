import test from 'node:test';
import assert from 'node:assert/strict';
import {mockSource,checkSource} from '../src/check-sources.mjs';
import {captureMock} from '../src/adapters/mock-audit.mjs';
import {reviewSpecification} from '../src/spec-audit.mjs';
import {snapshotAudit,renderFullReport} from '../src/reports.mjs';
import {sha} from '../src/security.mjs';

const spec={openapi:'3.0.3',info:{version:'mock-v2'},paths:{'/v1/accounts/{id}/transactions':{get:{responses:{}}}}};
test('mock provenance identifies a real operation and pins both contract and implementation',()=>{
 for(const adapter of ['bog-mock-v1','tbc-mock-v1','gringott-mock-v1']){
 const source=mockSource(adapter,'PAGINATION-account-one',spec);
 assert.equal(source.section,'PAGINATION');assert.match(source.sourceHash,/^[a-f0-9]{64}$/);
 const reference=source.sourceReferences.find(r=>r.type==='mock_contract');
 assert.equal(reference.locator,'#/paths/~1v1~1accounts~1{id}~1transactions/get');assert.equal(reference.hash,sha(spec));assert.equal(reference.version,'mock-v2');
 }
});
test('missing operations never acquire fabricated operation pointers',()=>{
 const source=mockSource('bog-mock-v1','BALANCES',spec);
 assert.equal(source.sourceReferences.at(-1).locator,'#');assert.match(source.sourceReferences.at(-1).note,/No matching operation/);
});
test('contract fetch failure preserves a source for all blocked checks without inventing a contract',async()=>{
 const run=await captureMock({id:'mock',adapter:'bog-mock-v1'},{adapterFactory:()=>({version:'bog-mock-v1',transport:{request:async()=>{throw Error('Unavailable')}}})});
 assert.equal(run.results.filter(f=>f.verdict==='BLOCKED').length,8);
 for(const f of run.results){assert(f.sourceHash);assert(f.section);assert.match(f.sourceAvailability,/not captured/);assert(!f.sourceReferences.some(r=>r.type==='mock_contract'))}
});
test('static review keeps normative source and adds independently pinned uploaded operation',()=>{
 const rule={id:'XS2A-JSON',title:'JSON',status:'approved',operation:'accounts',source:'standard.txt',section:'4.1',sourceHash:'original-standard-hash'};
 const results=reviewSpecification({...spec,paths:{'/accounts':{get:{responses:{200:{content:{'application/json':{}}}}}}}},[rule]);
 assert(results.every(f=>f.sourceHash));const f=results.find(f=>f.ruleId===rule.id);
 assert.equal(f.source,rule.source);assert.equal(f.sourceHash,rule.sourceHash);assert.equal(f.section,'4.1');assert.equal(f.sourceReferences[0].locator,'#/paths/~1accounts/get');
});

test('blocked sources survive snapshot storage and render separately from the dependency',()=>{
 const finding={...mockSource('bog-mock-v1','PAGINATION',spec),id:'BOG-MOCK-PAGINATION',title:'Pagination',verdict:'BLOCKED',blockedBy:'BOG-MOCK-ACCOUNTS',observed:'Account mapping unavailable'};
 const snapshot=snapshotAudit({id:'test',status:'completed',kind:'bank',results:[finding]});
 const saved=JSON.parse(JSON.stringify(snapshot));assert.deepEqual(saved.findings[0].sourceReferences,finding.sourceReferences);
 const html=renderFullReport(saved,{id:'report',version:1});
 assert(html.includes('GeoBridge synthetic mock check'));assert(html.includes('#/paths/~1v1~1accounts~1{id}~1transactions/get'));assert(html.includes('Account mapping unavailable'));assert(!html.includes('No source locator recorded'));
});
