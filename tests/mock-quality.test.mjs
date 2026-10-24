import test from 'node:test';
import assert from 'node:assert/strict';
import {captureQuality,assessMeasurements,comparisonView,validatePolicy,DEFAULT_POLICY,PLAN,qualityLayers} from '../src/mock-quality.mjs';
import {normalize} from '../src/security.mjs';

const goodSamples=Array.from({length:30},(_,i)=>({operation:'balances',kind:'positive',outcome:'success',durationMs:i+1,timestamp:new Date().toISOString()}));
test('demo thresholds use real positive samples and never manufacture p95 or pass incomplete work',()=>{
 const warmup={...goodSamples[0],kind:'warmup',durationMs:9999},negative={...warmup,kind:'negative'};
 const good=assessMeasurements([...goodSamples,warmup,negative],DEFAULT_POLICY);assert.equal(good.measurement.attempts,30);assert.equal(good.measurement.p95,29);assert(good.results.every(f=>f.verdict==='PASS'));
 const failed=assessMeasurements(goodSamples.map((s,i)=>i<3?{...s,outcome:'timeout'}:s),DEFAULT_POLICY);assert.equal(failed.results[0].verdict,'FAIL');assert.equal(failed.measurement.timeouts,3);
 const partial=assessMeasurements(goodSamples.slice(0,19),DEFAULT_POLICY);assert.equal(partial.measurement.p95,null);assert(partial.results.every(f=>f.verdict==='NOT_ASSESSED'));
 const slow=assessMeasurements(goodSamples.map(s=>({...s,durationMs:1500})),DEFAULT_POLICY);assert.equal(slow.results[1].verdict,'FAIL');
});
test('policy validation rejects arbitrary plans, invalid thresholds and NaN',()=>{
 for(const input of [{p95Ms:0},{p95Ms:Infinity},{minSuccessRate:0.5},{iterations:100000},[],null])assert.throws(()=>validatePolicy(input));
 assert.equal(validatePolicy({p95Ms:500,minSuccessRate:1}).p95Ms,500);
});
function factory({failure=false,changingShape=false}={}){
 let instance=0;const calls=[];
 return {calls,adapterFactory:(_id,options)=>{
  const performance=instance++>0;let revoked=false,balanceCalls=0;
  const accounts={accounts:[{resourceId:'a',currency:'GEL'}]},balance=()=>({balances:[{balanceAmount:{amount:'10.50',currency:changingShape&&balanceCalls%2?'USD':'GEL'},balanceType:'interimBooked'}]});
  const response=(status,body)=>({status,body});
  return {version:'bog-mock-v1',transport:{request:async path=>path==='/openapi.json'?response(200,{openapi:'3.0.3',paths:{'/v1/accounts':{get:{}}}}):path.includes('not-a-real-account')?response(404,{}):response(401,{tppMessages:[{category:'ERROR',code:'DENIED',text:'Denied'}]})},
   async createConsent(){return {upstreamId:'consent',token:'private-token'}},async completeAuthorization(c){return c},async consentStatus(){return {consentStatus:'valid'}},async revokeConsent(){revoked=true;calls.push({performance,cleanup:true})},
   async listAccounts(c){return response(revoked||c.token==='geobridge-invalid-demo-token'||c.upstreamId==='nonexistent-demo-consent'?403:200,accounts)},
   map:normalize,async getBalances(){balanceCalls++;calls.push({performance,balance:true});if(performance&&failure&&balanceCalls>PLAN.warmup)return {status:0,transportError:'TIMEOUT'};return response(200,balance())},async listTransactions(){return {data:{transactions:[]},pages:1}}
  };
 }};
}
test('quality suite runs bounded warmup and measured balance requests and pins provenance',async()=>{
 const {adapterFactory,calls}=factory();const output=await captureQuality({id:'mock-bog',profile:'xs2a-0.8'},{adapterFactory});
 assert.equal(calls.filter(c=>c.performance&&c.balance).length,33);assert.equal(output.quality.measurement.attempts,30);assert(output.quality.comparisonKey);assert.equal(output.quality.cleanup,'confirmed');
 assert(output.results.find(f=>f.id==='DEMO-INVALID-TOKEN').verdict==='PASS');assert(output.results.find(f=>f.id==='DEMO-EXPIRY').verdict==='NOT_ASSESSED');
 assert.equal(qualityLayers(output.results).security.verdict,'PARTIAL');
 assert(!JSON.stringify(output).includes('private-token'));assert(output.results.filter(f=>f.basis==='demo_quality').every(f=>f.sourceHash));
});
test('repeated failures stop safely and incomplete workloads cannot qualify for comparisons',async()=>{
 const {adapterFactory,calls}=factory({failure:true});const output=await captureQuality({id:'mock-bog',profile:'xs2a-0.8'},{adapterFactory});
 assert.equal(calls.filter(c=>c.performance&&c.balance).length,8);assert.equal(output.quality.measurement.timeouts,5);assert.equal(output.quality.comparisonKey,null);assert.equal(output.quality.complete,false);assert.equal(output.quality.cleanup,'confirmed');assert.match(output.quality.reason,/five/);
});
test('changing normalized dataset shape prevents comparable grouping',async()=>{
 const {adapterFactory}=factory({changingShape:true});const output=await captureQuality({id:'mock-bog',profile:'xs2a-0.8'},{adapterFactory});assert.equal(output.quality.comparisonKey,null);assert.equal(output.quality.complete,false);
});
test('comparison never ranks missing, failed, old or mismatched workload results',()=>{
 const batch={runIds:['one','two']},runs=['one','two'].map(id=>({id,status:'completed',quality:{comparisonKey:'group'},results:[]}));assert.equal(comparisonView(batch,runs).comparable,true);
 for(const altered of [[runs[0]],[runs[0],{...runs[1],status:'failed'}],[runs[0],{...runs[1],quality:null}],[runs[0],{...runs[1],quality:{comparisonKey:'other'}}]])assert.equal(comparisonView(batch,altered).comparable,false);
});
