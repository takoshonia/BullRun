import {createAdapter} from './adapters/registry.mjs';
import {captureMock} from './adapters/mock-audit.mjs';
import {requireResponse} from './adapters/http-transport.mjs';
import {checkSource} from './check-sources.mjs';
import {sha,metrics,redact} from './security.mjs';

export const SUITE_VERSION='mock-quality-1';
export const DEFAULT_POLICY=Object.freeze({version:'demo-policy-1',minSuccessRate:0.95,p95Ms:500});
export const PLAN=Object.freeze({operation:'balances',iterations:30,warmup:3,concurrency:1,timeoutMs:2000,deadlineMs:90000,consecutiveFailureLimit:5});
export function validatePolicy(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['minSuccessRate','p95Ms'].includes(k)))throw Error('Only minSuccessRate and p95Ms can be configured');
 const policy={...DEFAULT_POLICY,...input};
 if(!Number.isFinite(policy.minSuccessRate)||policy.minSuccessRate<0.9||policy.minSuccessRate>1||!Number.isFinite(policy.p95Ms)||policy.p95Ms<50||policy.p95Ms>10000)throw Error('Demo success rate must be 90-100%; p95 must be 50-10000 ms');
 return policy;
}
const source=id=>checkSource('mock-quality.mjs',id,'GeoBridge mock quality suite');
const finding=(id,title,layer,verdict,expected,observed)=>({...source(id),id,title,layer,basis:'demo_quality',severity:verdict==='FAIL'?'high':'info',verdict,expected,observed,fix:'Inspect the recorded synthetic evidence and repeat the same suite after the change. Demo thresholds are not regulatory requirements.'});
export function assessMeasurements(samples,policy,plan=PLAN){
 const measurement=metrics(samples),complete=measurement.attempts===plan.iterations;
 const exhaustedErrorBudget=measurement.attempts-measurement.successes>plan.iterations*(1-policy.minSuccessRate);
 return {measurement,complete,results:[
  finding('DEMO-RELIABILITY','Valid balance response rate','reliability',exhaustedErrorBudget?'FAIL':!complete?'NOT_ASSESSED':measurement.successRate>=policy.minSuccessRate?'PASS':'FAIL',`At least ${policy.minSuccessRate*100}% valid responses across ${plan.iterations} measured requests`,`${measurement.successes}/${measurement.attempts} valid responses; ${measurement.errors} errors, ${measurement.timeouts} timeouts, ${measurement.rateLimited} rate limits${complete?'':exhaustedErrorBudget?'; stopped early; failures already exceed the full-plan error budget':'; incomplete workload, no passing verdict'}`),
  finding('DEMO-LATENCY','Balance response p95','latency',!complete||measurement.p95===null?'NOT_ASSESSED':measurement.p95<=policy.p95Ms?'PASS':'FAIL',`Successful-request p95 <= ${policy.p95Ms} ms, at least 20 successes and a complete workload`,measurement.p95===null?'Insufficient successful samples':`${measurement.p95} ms p95; ${measurement.successes} successes${complete?'':'; workload incomplete'}`)
 ]};
}
export async function captureQuality(connection,{policy=DEFAULT_POLICY,environment='configured-mock-network',adapterFactory=createAdapter}={}){
 const deadline=AbortSignal.timeout(PLAN.deadlineMs);
 const factory=(id,options={})=>adapterFactory(id,{...options,signal:options.signal?AbortSignal.any([deadline,options.signal]):deadline,timeoutMs:PLAN.timeoutMs,maxRequests:200});
 const capture=await captureMock(connection,{adapterFactory:factory,timeoutMs:PLAN.deadlineMs});
 const results=[...capture.results],samples=[],shapes=new Set(),sizes=[];
 const performanceObservations=[];
 const adapter=factory(connection.id,{onObservation:o=>performanceObservations.push(o)}),start=new Date().toISOString();let consent,cleanup='not_needed',reason=null;
 try{
  consent=await adapter.createConsent();consent=await adapter.completeAuthorization(consent);
  const accounts=adapter.map('accounts',requireResponse(await adapter.listAccounts(consent))).accounts;
  if(!accounts.length)throw Error('No discovered account for the balance workload');
  // Tokens are deliberately bogus, never captured or returned. This is not an expiry test.
  const denied=await adapter.listAccounts({...consent,token:'geobridge-invalid-demo-token'},'negative');
  results.push(finding('DEMO-INVALID-TOKEN','Invalid bearer token is denied','security',denied.transportError?'BLOCKED':[401,403].includes(denied.status)?'PASS':'FAIL','401 or 403 for an invalid bearer token',denied.transportError||'HTTP '+denied.status));
  if(adapter.version!=='gringott-mock-v1'){
   const mismatch=await adapter.listAccounts({...consent,upstreamId:'nonexistent-demo-consent'},'negative');
   results.push(finding('DEMO-CONSENT-BINDING','Unknown consent identifier is denied','security',mismatch.transportError?'BLOCKED':[401,403].includes(mismatch.status)?'PASS':'FAIL','401 or 403 for a token with an unknown consent identifier',mismatch.transportError||'HTTP '+mismatch.status));
  }else results.push(finding('DEMO-CONSENT-BINDING','Unknown consent identifier is denied','security','NOT_ASSESSED','Independent consent-header validation','This adapter authenticates resource access by token; no independent consent header is sent.'));
  let consecutive=0;
  for(let index=0;index<PLAN.warmup+PLAN.iterations;index++){
   if(deadline.aborted){reason='Suite deadline reached';break}
   const kind=index<PLAN.warmup?'warmup':'positive',timestamp=new Date().toISOString(),began=performance.now();let outcome='error',httpStatus=0,response;
   try{
    response=await adapter.getBalances(consent,accounts[0].accountId);httpStatus=response.status;
    const mapped=adapter.map('balances',requireResponse(response));
    if(!mapped.balances.length)throw Error('Empty balance workload');
    const shape=sha(mapped.balances.map(b=>({currency:b.currency,type:b.balanceType})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if(kind==='positive'){shapes.add(shape);sizes.push(Buffer.byteLength(JSON.stringify(response.body)))}
    outcome='success';consecutive=0;
   }catch(e){outcome=response?.transportError==='TIMEOUT'||String(e.message).includes('TIMEOUT')?'timeout':httpStatus===429?'rate_limited':'error';consecutive++;}
   samples.push({operation:'balances',kind,timestamp,durationMs:+(performance.now()-began).toFixed(3),outcome,httpStatus});
   if(consecutive>=PLAN.consecutiveFailureLimit){reason='Stopped after five consecutive failed requests';break}
  }
 }catch(e){reason=redact(String(e.message||'Workload setup failed'));}
 finally{if(consent){try{await adapter.revokeConsent(consent);cleanup='confirmed'}catch{cleanup='unconfirmed'}}}
 for(const [id,title] of [['DEMO-INVALID-TOKEN','Invalid bearer token is denied'],['DEMO-CONSENT-BINDING','Unknown consent identifier is denied']])if(!results.some(f=>f.id===id))results.push(finding(id,title,'security','BLOCKED','Authorized setup and inspectable response',reason||'Setup incomplete'));
 for(const [id,title,expected] of [['DEMO-EXPIRY','Expired token is denied','Controlled token expiry'],['DEMO-ACCOUNT-SCOPE','Consent cannot access an excluded account','A supported restricted-account consent fixture']])results.push(finding(id,title,'security','NOT_ASSESSED',expected,'Not supported by this common mock suite; no pass or defect is inferred.'));
 const assessment=assessMeasurements(samples,policy);results.push(...assessment.results);
 if(cleanup==='unconfirmed')results.push(finding('DEMO-CLEANUP','Workload consent cleanup','security','NOT_ASSESSED','Revoke workload consent','Cleanup could not be confirmed; mock expiry/reset may be required.'));
 const complete=assessment.complete&&shapes.size===1;
 const responseSizeBand=sizes.length?2**Math.ceil(Math.log2(Math.max(...sizes))):null;
 const workload={...PLAN,environment,profile:connection.profile,shape:shapes.size===1?[...shapes][0]:null,responseSizeBand};
 const definitionHash=sha({suite:source('suite').sourceHash,assertions:checkSource('adapters/mock-audit.mjs','mock assertions').sourceHash,commonContract:checkSource('security.mjs','normalize').sourceHash});
 const quality={suiteVersion:SUITE_VERSION,definitionHash,policy,plan:PLAN,workload,complete,comparisonKey:complete?sha({suite:SUITE_VERSION,definitionHash,policy,workload}):null,measurement:assessment.measurement,reason:reason||(shapes.size>1?'Response shape changed during the workload':null),cleanup,startedAt:start,finishedAt:new Date().toISOString(),limitations:['Synthetic mocks only; no real-bank rating or SLA.','Sequential balance workload only; this is not a load or penetration test.','Warm-up and negative probes are excluded from timing thresholds.','Only successful requests enter percentiles; errors remain in response-rate measurements.','Client plan is controlled; server background load, geography and network conditions are not independently controlled.','Response-size bands are coarse; group membership does not establish identical datasets.',
'Equal comparison groups require the same suite, policy, profile, normalized balance shape, response-size band and runner environment.']};
 return {results,quality,pack:{...capture.pack,name:capture.pack.name+' / '+SUITE_VERSION,observations:[...capture.pack.observations,...performanceObservations],samples:[...capture.pack.samples,...samples]}};
}

export function qualityLayers(results){
 return Object.fromEntries(['compatibility','security','reliability','latency'].map(layer=>{
  const rows=results.filter(f=>f.layer===layer&&['mock_contract','demo_quality'].includes(f.basis)),count=v=>rows.filter(f=>f.verdict===v).length;
  const pending=rows.filter(f=>!['PASS','FAIL','NOT_APPLICABLE'].includes(f.verdict)).length;
  return [layer,{verdict:count('FAIL')?'FAIL':pending?'PARTIAL':count('PASS')?'PASS':'NOT_ASSESSED',passed:count('PASS'),failed:count('FAIL'),pending,total:rows.length}];
 }));
}
// Align by explicit assertion identity, never bank-specific account IDs or display titles.
export function sharedChecks(runs){
 const groups=new Map();
 for(const [index,run] of runs.entries())for(const f of run.results||[]){
  let key;
  if(f.basis==='mock_contract'){
   const local=String(f.id).replace(/^(BOG-MOCK|TBC-MOCK|GRINGOTT)-/,'');
   key='mock:'+local.replace(/^(BALANCES|PAGINATION)(?:-.*)?$/,'$1');
  }else if(f.basis==='demo_quality')key='demo:'+f.id;
  else if(f.ruleId||f.verdict==='NEEDS_REVIEW')key='rule:'+(f.ruleId||f.id);
  else continue;
  if(!groups.has(key))groups.set(key,{key,title:f.title,layer:f.layer||'compatibility',cells:runs.map(()=>[])});
  groups.get(key).cells[index].push(f);
 }
 const priority=['FAIL','BLOCKED','NEEDS_REVIEW','NOT_ASSESSED','PASS','NOT_APPLICABLE'];
 return [...groups.values()].map(group=>{
  const cells=group.cells.map(findings=>{
   if(!findings.length)return {verdict:'NOT_ASSESSED',expected:[],observed:['No matching check recorded in this audit.'],count:0};
   const verdict=priority.find(v=>findings.some(f=>f.verdict===v))||'NOT_ASSESSED';
   return {verdict,count:findings.length,expected:[...new Set(findings.map(f=>f.expected).filter(Boolean))],observed:[...new Set(findings.map(f=>f.observed).filter(Boolean))]};
  });
  const missing=cells.some(c=>!c.count),different=new Set(cells.map(c=>c.verdict)).size>1;
  return {...group,cells,different,explanation:missing?'Coverage differs: a matching check was not recorded for every bank.':different?'Verdicts differ. Compare the recorded expectations and observations below; a blocked or unassessed check does not establish a bank defect.':'Same verdict across banks. Observations may differ because mock contracts and datasets differ.'};
 }).sort((a,b)=>Number(b.different)-Number(a.different)||a.layer.localeCompare(b.layer)||a.key.localeCompare(b.key));
}
export function comparisonView(batch,runs){
 const members=batch.runIds.map(id=>runs.find(r=>r.id===id)).filter(Boolean);
 const rows=members.map(run=>({runId:run.id,connectionId:run.connectionId,name:run.name,status:run.status,error:run.error||null,finishedAt:run.finishedAt,quality:run.quality||null,layers:run.quality?qualityLayers(run.results||[]):null,reportId:run.reportId||null}));
 const keys=rows.map(r=>r.quality?.comparisonKey);
 const comparable=rows.length===batch.runIds.length&&rows.every(r=>r.status==='completed')&&keys.every(Boolean)&&new Set(keys).size===1;
 return {...batch,rows,checks:sharedChecks(members),comparable,comparabilityReason:comparable?'Same recorded workload group. Network and background-load limitations still apply.':rows.some(r=>['queued','running'].includes(r.status))?'Waiting for all suites to finish.':'Incomplete suites or different workload shapes, response-size bands, profiles or policies. Measurements are descriptive; do not rank these mocks.'};
}
