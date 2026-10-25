import {copyAmount,contractHash} from './contract-review.mjs';
import {mapAdapter} from './adapters/registry.mjs';

// Operational disposition is separate from immutable audit verdict/severity.
export function bankAlerts(run,records){
 const cid=run.connectionId,connection=records('connections').find(x=>x.id===cid);
 const scan=records('contract_scan_status').find(x=>x.id===cid);
 const baseline=records('contract_baselines').find(x=>x.id===cid);
 const pointer=records('contract_active').find(x=>x.id===cid);
 const runtime=records('contract_runtime').find(x=>x.id===cid);
 const pack=records('packs').find(x=>x.id===run.packId);
 return (run.results||[]).filter(f=>f.verdict==='FAIL').map(f=>{
  const base={findingId:f.id,status:'bank_action_required',label:'Bank action required',reason:'No verified adapter resolution covers this finding. Review the original evidence; the bank must resolve the demonstrated defect.'};
  // Only the supported balance mapper can resolve these specific mapping failures.
  const observation=pack?.observations?.[f.observationIndex];
  if(f.layer!=='compatibility'||!['mock_contract','platform_contract'].includes(f.basis)||!(/BALANCES|balance/i.test(f.id+' '+f.title))||observation?.operation!=='balances'||observation.kind!=='positive'||observation.status!==200||observation.transportError||!connection)return base;
  const candidates=records('contract_candidates').filter(c=>c.connectionId===cid&&c.snapshotId===scan?.snapshotId);
  for(const c of candidates){
   try{
    const mapped=copyAmount(observation.body,c.mapping);
    try{mapAdapter(connection.adapter,'balances',observation.body);continue}catch{}
    mapAdapter(connection.adapter,'balances',mapped);
    const tests=records('contract_tests').filter(t=>t.candidateId===c.id).sort((a,b)=>b.at.localeCompare(a.at));
    const t=tests[0],valid=scan?.status==='ok'&&c.hash===contractHash({mapping:c.mapping,snapshotId:c.snapshotId})&&c.status==='approved'&&c.review?.hash===c.hash&&t?.passed&&t.id===c.review?.testId&&t.candidateHash===c.hash&&t.baselineId===baseline?.snapshotId;
    if(valid&&pointer?.candidateId===c.id&&runtime?.status==='success'&&runtime.candidateId===c.id&&runtime.snapshotId===scan.snapshotId&&runtime.baselineId===baseline.snapshotId&&Date.parse(runtime.at)>=Date.parse(pointer.at))return {...base,status:'handled_by_adapter',label:'Handled by adapter',reason:'Original failed response replays successfully with the approved active mapping, and a TPP balance request succeeded after activation. The original bank audit failure remains.',mappingVersion:c.id,verifiedAt:runtime.at};
    base.status='review_pending';base.label='Review pending';base.reason='A candidate can map this recorded response. Testing, approval, activation and a successful TPP request are required before it is marked handled.';
   }catch{/* Missing, ambiguous or unsafe values remain bank action required. */}
  }
  if(base.status==='bank_action_required')for(const sourceField of ['sum','aggregation','value'])try{
   try{mapAdapter(connection.adapter,'balances',observation.body);break}catch{}
   mapAdapter(connection.adapter,'balances',copyAmount(observation.body,{operation:'balances',sourceField,destination:'balanceAmount.amount'}));
   base.status='review_pending';base.label='Review pending';base.reason='A supported exact field copy can structurally map this recorded response. Its meaning has not been established: propose, test and review a mapping before activation.';break;
  }catch{}
  return base;
 });
}
