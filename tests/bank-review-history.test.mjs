import test from 'node:test';
import assert from 'node:assert/strict';
import {auditVisible,sharedBankReview} from '../src/audit-visibility.mjs';
import {workspacePayload} from '../src/workspace-access.mjs';
const users=[{id:'old-supervisor',role:'reviewer'},{id:'private-bank',role:'bank'}];
const run=(id,actor,verdict='FAIL',tenant='bank-bog')=>({id,actor,kind:'bank',tenant,status:'completed',results:[{layer:'security',verdict}],counts:{[verdict]:1}});
const rows=[run('op','operator'),run('nbg','old-supervisor'),run('own','private-bank'),run('pass','operator','PASS'),run('other','operator','FAIL','bank-tbc'),{...run('pending','operator'),status:'running'},...Array.from({length:105},(_,i)=>run('old-'+i,'operator'))];
const services={records:k=>k==='users'?users:k==='runs'?rows:[],profiles:[],sources:[],canSee:(u,t)=>u.role!=='bank'||u.tenant===t,reportSummaries:rows.map(r=>({id:'report-'+r.id,runId:r.id,tenant:r.tenant,kind:r.kind}))};
test('historical failed supervisory audits join bank counts exactly once without the old 100-run truncation',()=>{
 const bank=workspacePayload({role:'bank',tenant:'bank-bog'},services);
 assert.equal(bank.runs.length,108);assert.equal(new Set(bank.runs.map(r=>r.id)).size,108);
 assert.equal(bank.runs.filter(r=>r.bankReview).length,107);
 assert.equal(bank.savedReports.length,108);
 assert(bank.runs.some(r=>r.id==='own'));assert(!bank.runs.some(r=>['pass','pending','other'].includes(r.id)));
 for(const role of ['operator','reviewer']){const w=workspacePayload({role,tenant:'nbg'},services);assert(!w.runs.some(r=>r.id==='own'));assert(!w.savedReports.some(r=>r.runId==='own'))}
});
test('direct read policy matches history, resolves old actor roles and isolates tenants',()=>{
 for(const role of ['operator','reviewer'])assert.equal(auditVisible({role,tenant:'nbg'},rows[2],users),false);
 assert.equal(auditVisible({role:'bank',tenant:'bank-bog'},rows[1],users),true);
 assert.equal(auditVisible({role:'bank',tenant:'bank-tbc'},rows[1],users),false);
 assert.equal(auditVisible({role:'tpp',tenant:'bank-bog'},rows[1],users),false);
 assert.equal(sharedBankReview({...rows[0],results:[{verdict:'NEEDS_REVIEW'}]},users),false);
 assert.equal(sharedBankReview({...rows[0],status:'failed'},users),false);
});
