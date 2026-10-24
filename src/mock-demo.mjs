import {requestJSON} from './availability.mjs';
const allowed=new Set(['slowResponse','revokedConsentBypass']);
// Persist restoration intent before changing a mock; expired controls survive application restarts.
export function createMockDemo({targets,records,get,put,event,request=requestJSON,clock=Date.now}){
 const busy=new Set();
 const supported=targets.filter(t=>t.adminKey&&['X-BOG-Mock-Admin-Key','X-Gringott-Admin-Key'].includes(t.adminHeader));
 const safe=x=>({id:x.id,target:x.target,defect:x.defect,status:x.status,expiresAt:x.expiresAt,lastError:x.lastError||null});
 const endpoint=t=>t.adminHeader==='X-BOG-Mock-Admin-Key'?'/api/admin/faults':'/api/admin/defects';
 async function write(t,defect,value){
  const r=await request(t.origin+endpoint(t),{method:'POST',body:{[defect]:value},headers:{[t.adminHeader]:t.adminKey},timeoutMs:2000});
  const state=r.data?.faults||r.data?.defects;
  if(r.httpStatus!==200||state?.[defect]!==value)throw Error('Mock did not confirm the requested fault state');
 }
 async function restore(patch,t){
  try{await write(t,patch.defect,patch.previous);put('mock_demo',{...patch,status:'restored',restoredAt:new Date(clock()).toISOString(),lastError:null});event('system','demo_fault_restored',t.id,{defect:patch.defect})}
  catch{put('mock_demo',{...patch,status:'restore_pending',lastError:'Could not confirm restoration; retrying automatically.'})}
 }
 return {
  list(){return {targets:supported.map(t=>({id:t.id,name:t.name})),controls:records('mock_demo').filter(p=>p.status!=='restored').map(safe)}},
  async change(id,{defect,enabled,durationSeconds=300}={},actor){
   const t=supported.find(t=>t.id===id);if(!t)throw Error('No supported mock fault control configured');
   if(!allowed.has(defect)||typeof enabled!=='boolean'||!Number.isInteger(durationSeconds)||durationSeconds<60||durationSeconds>600)throw Error('Choose an allowed mock fault and duration of 60-600 seconds');
   if(busy.has(id))throw Error('Mock control is busy');busy.add(id);
   const key=id+'-'+defect;
   try{
    const prior=get('mock_demo',key);
    if(!enabled){if(prior&&prior.status!=='restored'){await restore(prior,t);return safe(get('mock_demo',key))}return {id:key,target:id,defect,status:'restored'}}
    if(prior&&prior.status!=='restored')throw Error('Restore the active fault before enabling it again');
    const state=await request(t.origin+'/api/admin/state',{maxResponseBytes:2_000_000,headers:{[t.adminHeader]:t.adminKey},timeoutMs:2000});const value=(state.data?.faults||state.data?.defects)?.[defect];
    if(state.httpStatus!==200||typeof value!=='boolean')throw Error('Cannot verify the prior mock fault state');
    if(value)throw Error('This fault was already enabled outside GeoBridge; refusing to override it');
    const patch={id:key,target:id,defect,previous:false,status:'restore_pending',expiresAt:new Date(clock()+durationSeconds*1000).toISOString(),actor};
    put('mock_demo',patch);
    try{await write(t,defect,true);put('mock_demo',{...patch,status:'active'});event(actor,'demo_fault_enabled',id,{defect,expiresAt:patch.expiresAt});return safe(get('mock_demo',key))}
    catch(e){await restore(patch,t);throw e}
   }finally{busy.delete(id)}
  },
  async tick(){
   for(const patch of records('mock_demo').filter(p=>p.status==='restore_pending'||p.status==='active'&&Date.parse(p.expiresAt)<=clock())){
    const t=supported.find(t=>t.id===patch.target);if(!t||busy.has(t.id))continue;busy.add(t.id);try{await restore(patch,t)}finally{busy.delete(t.id)}
   }
  }
 };
}
