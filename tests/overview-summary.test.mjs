import test from 'node:test';import assert from 'node:assert/strict';import {categorySummary,workspacePayload} from '../src/workspace-access.mjs';
test('category summaries retain verdict counts without exposing raw finding evidence',()=>{
 const results=[{layer:'compatibility',verdict:'PASS',observed:'PRIVATE'},{category:'security',verdict:'FAIL'},{layer:'security',verdict:'NOT_ASSESSED'}];
 const summary=categorySummary(results);assert.equal(summary.compatibility.counts.PASS,1);assert.equal(summary.security.total,2);assert.equal(summary.latency.total,0);assert.equal(categorySummary(undefined),null);
 const services={records:kind=>kind==='runs'?[{id:'own',tenant:'a',kind:'bank',results},{id:'other',tenant:'b',kind:'bank',results}]:[],profiles:[],sources:[],canSee:(u,t)=>u.tenant===t};
 const w=workspacePayload({id:'a',role:'bank',tenant:'a'},services);assert.equal(w.runs.length,1);assert.deepEqual(w.runs[0].categorySummary,summary);assert.equal(w.runs[0].results,undefined);assert(!JSON.stringify(w).includes('PRIVATE'));
});
