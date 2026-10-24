import test from 'node:test';
import assert from 'node:assert/strict';
import {groupFindings,reviewReport,nextAction} from '../src/report-review.mjs';
import {generateNarrative,narrativeFacts,validateNarrative} from '../src/report-narrative.mjs';
import {renderFullReport} from '../src/reports.mjs';
const pass={id:'request-id',ruleId:'REQUEST-ID',title:'Request ID',layer:'compatibility',verdict:'PASS',severity:'low',expected:'UUID header',observed:'UUID inspected',remediation:'Send a UUID header.'};
const draft={id:'draft',ruleId:'ACCOUNT-IBAN',title:'Account IBAN',layer:'compatibility',verdict:'NEEDS_REVIEW',expected:'Approved rule',observed:'Draft; not executed',remediation:'Return an IBAN.'};
const snapshot=findings=>({run:{id:'audit',name:'BOG mock <script>bad</script>',kind:'bank',evidenceMode:'mock_http'},findings,metrics:[],limitations:['Synthetic observations only.']});
const meta={id:'report',version:1,createdAt:'2026-10-24T12:00:00Z',schemaVersion:1,rendererVersion:'2.0.0',snapshotHash:'hash'};

test('equivalent passing observations are grouped without implying independent requirement coverage',()=>{
 const s=snapshot([...Array.from({length:20},(_,i)=>({...pass,observationIndex:i})),draft]);const review=reviewReport(s);assert.equal(review.passes.length,1);assert.equal(review.passes[0].count,20);assert.equal(review.passes[0].members.length,20);assert.equal(review.pending.length,1);assert.equal(review.counts.PASS,20);assert(review.summary.includes('20 passing observations'));assert(review.summary.includes('1 draft-rule observations'));
 const html=renderFullReport(s,meta);assert(html.includes('Counts are observations'));assert(html.includes('20 passing observations are grouped into 1'));assert(!html.includes('Send a UUID header.'));assert(!html.includes('Return an IBAN.'));assert(!html.includes('Preserve this behavior'));assert(!html.includes('<script>bad</script>'));assert(html.includes('finding-19'));assert(html.includes('observation 19'));
});

test('different defects, source references and severities never merge',()=>{
 const failed={...pass,verdict:'FAIL',observed:'Missing header'};
 const groups=groupFindings(snapshot([failed,{...failed,observed:'Invalid header'},{...failed,sourceHash:'different-source'},{...failed,severity:'critical'}]));assert.equal(groups.length,4);assert.equal(groups[0].severity,'critical');
});

test('per-observation mapping IDs group by equivalent operation while preserving each evidence reference',()=>{
 const s=snapshot([7,10,15].map(i=>({...pass,id:'MAP-'+i,ruleId:'MAP-'+i,title:'Common transactions mapping',basis:'platform_contract',observationIndex:i})));const groups=groupFindings(s);assert.equal(groups.length,1);assert.equal(groups[0].count,3);assert.deepEqual(groups[0].members.map(m=>m.observationIndex),[7,10,15]);
});

test('passing and review-only reports make zero provider requests even when AI is configured',async()=>{
 const s=snapshot([pass,draft]);let called=false;const result=await generateNarrative(s,{config:{configured:true,key:'test-key',model:'test-model'},fetchImpl:async()=>{called=true;throw Error('unnecessary request')}});assert.equal(called,false);assert.equal(result.reason,'no_actionable_findings');assert.equal(result.findings.length,0);assert.equal(narrativeFacts(s).length,0);
 const html=renderFullReport({...s,narrative:result},meta);assert(html.includes('No failing observations were recorded.'));assert(html.includes('Standards reviewer'));assert(html.includes('no established implementation defect'));assert(!html.includes('AI-assisted analysis · advisory'));
});

test('AI receives only distinct actionable groups, not passed results or draft-rule remediation',()=>{
 const failure={...pass,verdict:'FAIL',observed:'Missing header',impact:'Cannot correlate requests.'};const blocked={...pass,id:'blocked',ruleId:'AUTH',verdict:'BLOCKED',expected:'Authorization evidence',observed:'Missing consent',remediation:'Fix the bank implementation.'};
 const facts=narrativeFacts(snapshot([pass,draft,failure,{...failure,observationIndex:3},blocked]));assert.equal(facts.length,2);assert.equal(facts[0].verdict,'FAIL');assert.equal(facts[1].verdict,'BLOCKED');assert(facts[1].remediation.includes('missing setup or evidence'));assert(!JSON.stringify(facts).includes('Return an IBAN.'));assert(!JSON.stringify(facts).includes('Fix the bank implementation.'));assert(nextAction(draft).includes('no bank defect'));
});

test('AI analysis is attached by group reference, not array position; all original evidence remains',()=>{
 const failed={...pass,id:'failed',verdict:'FAIL',observed:'Missing header',impact:'Cannot correlate requests.'};const s=snapshot([pass,failed,draft]);s.narrative={mode:'live_ai_advisory',provider:'test-provider',model:'test-model',findings:[{reference:'group-1',summary:'The request has no correlation header.',impact:'Request correlation is unavailable.',remediation:'Add the required header and rerun the check.'}]};
 const html=renderFullReport(s,meta);assert(html.includes('The request has no correlation header.'));assert.equal(html.split('The request has no correlation header.').length-1,1);assert(html.includes('All 3 original observations'));assert(html.includes('finding-0'));assert(html.includes('finding-1'));assert(html.includes('finding-2'));assert(html.includes('Real bank behavior is outside this run'));assert(html.includes('no recorded checks'));
});

test('actionable AI analysis rejects the previous repetitive boilerplate',()=>{
 const facts=narrativeFacts(snapshot([{...pass,verdict:'FAIL',observed:'Missing header'}]));const f=facts[0];
 assert.throws(()=>validateNarrative({findings:[{reference:f.reference,verdict:f.verdict,expected:f.expected,observed:f.observed,summary:'This check verified the request header.',impact:'Correlation is unavailable.',remediation:'Preserve this behavior.'}]},facts),/Boilerplate/);
});
