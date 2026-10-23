import fs from 'node:fs';
import path from 'node:path';
import {all,get,put,event,root} from './store.mjs';
import {assurance} from './assurance.mjs';
import {reviewSpecification} from './spec-audit.mjs';
import {id,sha,redact,normalize,metrics} from './security.mjs';
import {captureMock} from './adapters/mock-audit.mjs';
import {adapterTargets,mapAdapter} from './adapters/registry.mjs';

export function validatePack(p){
 if(!p||p.synthetic!==true)throw Error('Only explicitly synthetic evidence is accepted');
 if(!['synthetic_fixture','sandbox_capture'].includes(p.mode))throw Error('Evidence mode must be synthetic_fixture or sandbox_capture');
 if(!Array.isArray(p.observations)||p.observations.length>250)throw Error('At most 250 observations');
 if(!p.name||String(p.name).length>120)throw Error('Evidence name required');
 for(const o of p.observations){if(!['accounts','balances','transactions','consent'].includes(o.operation)||!Number.isInteger(o.status)||o.status<100||o.status>599)throw Error('Invalid observation operation/status');if(!o.body||typeof o.body!=='object')throw Error('JSON response body required');if(o.timestamp&&!Number.isFinite(Date.parse(o.timestamp)))throw Error('Invalid timestamp');}
 const samples=p.samples||[];if(!Array.isArray(samples)||samples.length>5000)throw Error('At most 5000 samples');
 for(const s of samples)if(!['accounts','balances','transactions','consent'].includes(s.operation)||!['positive','negative','warmup','setup'].includes(s.kind)||!['success','error','timeout','rate_limited'].includes(s.outcome)||!Number.isFinite(s.durationMs)||s.durationMs<0||s.durationMs>300000||!Number.isFinite(Date.parse(s.timestamp)))throw Error('Each sample needs operation, kind, outcome, finite durationMs and ISO timestamp');
 if(p.mode==='sandbox_capture'&&(!p.environment||!p.captureMethod))throw Error('Sandbox captures need environment and captureMethod');
 return {...p,samples};
}
const fail=(ok,expected,observed)=>({verdict:ok?'PASS':'FAIL',expected,observed});
export function evaluate(rule,o){const b=o.body;const a=b.accounts||[];const values=(b.balances||[]);switch(rule.id){
 case 'AIS-RESOURCE':return fail(a.length>0&&a.every(x=>typeof x.resourceId==='string'&&x.resourceId.length>0),'Every returned account has a nonempty resourceId','Identifier presence checked; tokenization algorithm NOT_ASSESSED');
 case 'AIS-CURRENCY':return fail(a.length>0&&a.every(x=>/^[A-Z]{3}$/.test(x.currency||'')),'Every account includes a three-letter currency','Account currency fields inspected');
 case 'AIS-OWNER':return fail(a.every(x=>!('ownerName'in x)),'ownerName must not be returned','ownerName field presence checked; ownerNames permission requires additional evidence');
 case 'AIS-DETAILS':return fail(a.every(x=>x.status==='blocked'?!!x.details:!('details'in x)),'details exists only for blocked accounts and explains the reason','Blocked-account details condition evaluated');
 case 'AIS-TYPE':return fail(a.length>0&&a.every(x=>['LOAN','SVGS'].includes(x.cashAccountType)),'LOAN or SVGS under the selected loan/deposit profile','cashAccountType inspected');
 case 'AIS-BIC':return fail(a.length>0&&a.every(x=>/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(x.bic||'')),'BIC present with valid length/syntax','Syntax checked, bank directory not assessed');
 case 'AIS-NO-INLINE':return fail(a.every(x=>!('balances'in x)),'No inline balances on loan/deposit account list','Inline balances property checked');
 case 'XS2A-JSON': case 'COMMON-JSON':return fail(/application\/(json|problem\+json)/i.test(o.contentType||''),'JSON response Content-Type','Observed '+(o.contentType||'missing'));
 case 'COMMON-TYPE':return o.status<400?{verdict:'NOT_APPLICABLE',expected:'Error response',observed:'Positive response'}:fail(typeof b.type==='string'&&!b.type.startsWith('https://berlingroup.com/error-codes/'),'Error type is present and avoids forbidden prefix','type field inspected; documentation URL reachability NOT_ASSESSED');
 case 'XS2A-REQUEST-ID': case 'COMMON-REQUEST-ID':return o.requestId?fail(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(o.requestId),'Client sends UUID X-Request-ID','Captured request ID inspected; replay behavior NOT_ASSESSED'):{verdict:'BLOCKED',expected:'Captured request ID',observed:'Request header evidence missing'};
 case 'DOM-LOAN':{const principal=values.filter(x=>x.balanceSubTypeProprietary==='principal');return principal.length?fail(principal.every(x=> /^-\d+(\.\d+)?$/.test(x.balanceAmount?.amount||'')&&Number(x.balanceAmount.amount)<0),'Loan principal negative','Principal balance sign checked'):{verdict:'NOT_APPLICABLE',expected:'Loan principal balance','observed':'No principal subtype in this observation'}}
 case 'DOM-DEPOSIT':return o.accountCategory==='SVGS'?fail(values.length>0&&values.every(x=>/^\d+(\.\d+)?$/.test(x.balanceAmount?.amount||'')),'Deposit amount is nonnegative','Deposit balance sign checked'):{verdict:'NOT_APPLICABLE',expected:'Deposit balance',observed:'No SVGS account-category evidence'};
 default:return {verdict:'NOT_ASSESSED',expected:'Authorized lifecycle test',observed:'Requires bank adapter and controlled customer flow'};
}}
export async function executeRun(run){
 const output=[];const start=new Date().toISOString();const ruleSnapshot=all('rules');
 if(run.kind==='platform')output.push(...assurance());
 if(run.kind==='spec'){const uploaded=get('specs',run.connectionId);if(!uploaded)throw Error('No specification uploaded');output.push(...reviewSpecification(uploaded.spec,ruleSnapshot.filter(r=>r.profile===run.profile)));}
 let pack=null;
 const target=run.kind==='bank'&&adapterTargets().find(t=>t.id===run.connectionId);
 if(target){
  const connection=get('connections',run.connectionId);if(connection?.tenant!==target.tenant)throw Error('Configured adapter scope mismatch');
  const capture=await captureMock(connection);output.push(...capture.results);
  pack=put('packs',{...capture.pack,id:id(),tenant:run.tenant,createdAt:new Date().toISOString(),hash:sha(capture.pack)});
  run={...run,packId:pack.id};
 }
 if(run.packId){pack=pack||get('packs',run.packId);if(!pack)throw Error('Evidence pack no longer exists');const rules=ruleSnapshot.filter(x=>x.profile===pack.profile);
 for(const r of rules){if(r.status!=='approved'){output.push({...r,id:r.id,verdict:'NEEDS_REVIEW',expected:'Human-approved rule and applicability',observed:'Rule is a draft; not executed'});continue}
 const obs=pack.observations.filter(o=>(r.operation==='all'||r.operation===o.operation)&&(pack.mode!=='mock_http'||o.status>0&&o.kind==='positive'));if(!obs.length){output.push({...r,verdict:'NOT_ASSESSED',expected:'Matching observation',observed:'No selected-operation evidence'});continue}
 for(const [i,o]of obs.entries())output.push({...r,...evaluate(r,o),observationIndex:pack.observations.indexOf(o),id:r.id+'-'+i,ruleId:r.id});}
 // Always enforce the common contract independently of standards approval.
 for(const [i,o]of pack.observations.entries()){if(o.status>=400||o.status===0||o.operation==='consent'||pack.mode==='mock_http'&&o.kind!=='positive')continue;try{(pack.mode==='mock_http'?mapAdapter(pack.adapterVersion,o.operation,o.body):normalize(o.operation,o.body));output.push({id:'MAP-'+i,title:'Common '+o.operation+' mapping',layer:'compatibility',basis:'platform_contract',verdict:'PASS',expected:'Exact semantic mapping',observed:'Required common fields preserved',observationIndex:i})}catch(e){output.push({id:'MAP-'+i,title:'Common '+o.operation+' mapping',layer:'compatibility',basis:'platform_contract',verdict:'FAIL',severity:'high',expected:'Safe common representation',observed:e.message,fix:'Correct the original fields or implement a reviewed explicit mapping. Never invent missing values.',observationIndex:i})}}
 }
 if(run.kind==='bank'&&!target)for(const layer of ['compatibility','reliability','latency','security'])output.push({id:'BANK-'+layer,title:'Bank '+layer+' checks',layer,verdict:'BLOCKED',expected:'Authorized sandbox with pinned profile and verified adapter',observed:'Bank access and adapter configuration pending',basis:'bank_connection'});
 const groups=pack?['accounts','balances','transactions','consent'].map(operation=>({operation,...metrics(pack.samples.filter(s=>s.operation===operation))})):[];
 const counts={};for(const r of output)counts[r.verdict]=(counts[r.verdict]||0)+1;
 const timestamps=pack?.samples.filter(s=>s.kind==='positive').map(s=>Date.parse(s.timestamp))||[];
 const result={...run,status:'completed',progress:100,startedAt:start,finishedAt:new Date().toISOString(),results:output,counts,metrics:groups,measurementWindow:timestamps.length?{start:new Date(Math.min(...timestamps)).toISOString(),end:new Date(Math.max(...timestamps)).toISOString(),environment:pack.environment,captureMethod:pack.captureMethod}:null,evidenceMode:run.kind==='platform'?'local_platform_controls':run.kind==='spec'?'specification_only':pack?.mode||'not_connected',rulesetHash:sha(ruleSnapshot),build:'0.1.0',adapterVersion:pack?.adapterVersion||null,specHash:pack?.specHash||null,limitations:['Selected checks only; not overall Georgian compliance or certification.','Platform fixtures do not establish bank conformance.','No production uptime inferred from short observations.',pack?.mode==='mock_http'?'Independent mock simulated authorization, no mTLS/JWS. Synthetic HTTP timings depend on hosting and network; they do not establish real bank performance.':'Imported samples are uploader-declared, not independently authenticated measurements.'],evidenceHash:pack?sha(pack):null};
 put('runs',result);event('worker','run_completed',run.id,{counts});return result;
}
