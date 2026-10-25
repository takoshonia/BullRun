import crypto from 'node:crypto';
import {contractHash} from './contract-review.mjs';
const fail=message=>{throw Object.assign(Error(message),{status:409})};
export function createMappingAutomation({all,get,put,event,review,clock=Date.now}){
 let working=false;
 for(const run of all('contract_policy_runs').filter(x=>x.status==='running')){put('contract_policy_runs',{...run,status:'interrupted',error:'Worker restarted; inspect the current mapping before re-enabling automation.'});const p=get('contract_policies',run.policyId);if(p)put('contract_policies',{...p,status:'disabled'});event('system','contract_policy_failed',run.policyId,{connectionId:run.connectionId});}
 function candidateFor(p){const c=get('contract_candidates',p.candidateId);if(!c||c.connectionId!==p.connectionId||c.hash!==p.candidateHash||contractHash({mapping:c.mapping,snapshotId:c.snapshotId})!==p.candidateHash||c.snapshotId!==p.toSnapshotId||c.status!=='approved'||c.review?.hash!==c.hash)fail('Approved candidate changed; new policy review required');if(get('contract_baselines',p.connectionId)?.snapshotId!==p.baselineId)fail('Baseline changed; new policy review required');return c;}
 return {
  approve(candidateId,actor,note){
   if(typeof note!=='string'||note.trim().length<12||note.length>1000)fail('Explain the narrowly authorized mapping semantics');
   const c=get('contract_candidates',candidateId),test=c&&get('contract_tests',c.review?.testId),base=c&&get('contract_baselines',c.connectionId),from=base&&get('contract_snapshots',base.snapshotId),to=c&&get('contract_snapshots',c.snapshotId);
   if(!c||c.status!=='approved'||c.review?.hash!==c.hash||!test?.passed||test.candidateHash!==c.hash||test.baselineId!==base?.snapshotId||!from||!to||from.id===to.id)fail('Previously reviewed and tested exact schema transition required');
   const p={id:crypto.randomUUID(),connectionId:c.connectionId,candidateId:c.id,candidateHash:c.hash,fromSnapshotId:from.id,toSnapshotId:to.id,fromHash:from.hash,toHash:to.hash,baselineId:base.snapshotId,restoreOriginal:true,status:'approved',approvedBy:actor,note:note.trim(),approvedAt:new Date(clock()).toISOString(),expiresAt:new Date(clock()+7*86400000).toISOString()};put('contract_policies',p);event(actor,'contract_policy_approved',p.id,{connectionId:p.connectionId});return p;
  },
  enable(id,actor){const p=get('contract_policies',id);if(!p||!['approved','disabled'].includes(p.status)||Date.parse(p.expiresAt)<=clock())fail('Current pre-approved policy required');candidateFor(p);const scan=get('contract_scan_status',p.connectionId);if(scan?.status!=='ok'||scan.snapshotId!==p.fromSnapshotId)fail('Capture the exact original schema before enabling this future-change policy');if(all('contract_policies').some(x=>x.id!==id&&x.connectionId===p.connectionId&&x.status==='enabled'))fail('Only one automatic policy per bank may be enabled');const next={...p,status:'enabled',enabledBy:actor,enabledAt:new Date(clock()).toISOString()};put('contract_policies',next);event(actor,'contract_policy_enabled',id,{connectionId:p.connectionId});return next;},
  disable(id,actor){const p=get('contract_policies',id);if(!p)fail('Policy not found');put('contract_policies',{...p,status:'disabled',disabledBy:actor,disabledAt:new Date(clock()).toISOString()});event(actor,'contract_policy_disabled',id,{connectionId:p.connectionId});return {ok:true};},
  async tick(){if(working)return;working=true;try{for(const p of all('contract_policies').filter(x=>x.status==='enabled')){
   if(Date.parse(p.expiresAt)<=clock()){put('contract_policies',{...p,status:'expired'});event('system','contract_policy_disabled',p.id,{connectionId:p.connectionId,reason:'expired'});continue;}
   const scan=get('contract_scan_status',p.connectionId),restore=p.restoreOriginal&&scan?.snapshotId===p.fromSnapshotId&&scan?.fromSnapshotId===p.toSnapshotId&&get('contract_active',p.connectionId)?.candidateId===p.candidateId;
   if(scan?.status!=='ok'||!scan.transitionId||!restore&&(scan.snapshotId!==p.toSnapshotId||scan.fromSnapshotId!==p.fromSnapshotId)||Date.parse(scan.transitionAt)<Date.parse(p.enabledAt))continue;
   const id=contractHash({policy:p.id,transition:scan.transitionId});if(get('contract_policy_runs',id))continue;
   const run={id,policyId:p.id,connectionId:p.connectionId,transitionId:scan.transitionId,status:'running',startedAt:new Date(clock()).toISOString()};put('contract_policy_runs',run);
   try{
    if(Date.parse(p.expiresAt)<=clock())fail('Policy expired');candidateFor(p);
    if(get('contract_snapshots',p.fromSnapshotId)?.hash!==p.fromHash||get('contract_snapshots',p.toSnapshotId)?.hash!==p.toHash)fail('Pinned schema changed');
    const actor='automatic-policy:'+p.id;if(restore)await review.testDefault(p.connectionId,actor);else await review.test(p.candidateId,actor);
    if(get('contract_policies',p.id)?.status!=='enabled'||Date.parse(p.expiresAt)<=clock())fail('Policy disabled or expired during testing');
    candidateFor(p);const current=get('contract_scan_status',p.connectionId);if(current?.status!=='ok'||current.transitionId!==scan.transitionId||current.snapshotId!==scan.snapshotId)fail('Schema changed during automatic test');
    if(restore){const pointer=get('contract_active',p.connectionId);if(pointer?.candidateId!==p.candidateId)fail('Mapping changed during restore');put('contract_active',{...pointer,candidateId:null,previousId:p.candidateId,actor,at:new Date(clock()).toISOString()});event(actor,'contract_mapping_rolled_back',p.connectionId,{connectionId:p.connectionId,policyId:p.id});}
    else{review.approve(p.candidateId,actor,'Delegated exact-schema semantic authorization '+p.id+' by '+p.approvedBy+'. '+p.note);review.activate(p.candidateId,actor);}
    put('contract_policy_runs',{...run,status:restore?'restored_default':'activated',completedAt:new Date(clock()).toISOString()});event(actor,restore?'contract_mapping_rolled_back':'contract_policy_succeeded',p.id,{connectionId:p.connectionId});
   }catch{put('contract_policy_runs',{...run,status:'failed',error:'Automatic activation stopped. Inspect schema, baseline, consent and mapping tests; manual review required.',completedAt:new Date(clock()).toISOString()});put('contract_policies',{...get('contract_policies',p.id),status:'disabled'});event('system','contract_policy_failed',p.id,{connectionId:p.connectionId});}
  }}finally{working=false}},
  view(){return {policies:all('contract_policies'),runs:all('contract_policy_runs').slice(-50),notice:'Exact bank/schema transitions only. NBG authorizes semantics once; Operator enables the policy. Each recurrence is tested before activation. Seven-day expiry; no runtime AI.'};}
 };
}
