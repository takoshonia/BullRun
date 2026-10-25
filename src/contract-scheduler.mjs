// Scheduling is independent of availability probes and per-response validation.
export function contractIntervalMinutes(value=process.env.GEOBRIDGE_CONTRACT_SCAN_MINUTES??'1440'){
 const minutes=Number(value);if(!Number.isInteger(minutes)||minutes<5||minutes>10080)throw Error('GEOBRIDGE_CONTRACT_SCAN_MINUTES must be 5-10080 minutes');return minutes;
}
export function createContractScheduler({targets,get,scan,minutes=contractIntervalMinutes(),clock=Date.now}){
 const running=new Set(),notifications=new Map();
 async function run(id,actor){if(running.has(id))return false;running.add(id);try{await scan(id,actor);return true}finally{running.delete(id)}}
 return {
  async tick(){for(const target of targets()){const at=Date.parse(get('contract_scan_status',target.id)?.checkedAt||'');if(Number.isFinite(at)&&clock()-at<minutes*60000)continue;try{await run(target.id,'scheduled_contract_scan')}catch{ /* Scan status retains failure; retry on the next configured interval. */ }}},
  // Internal integration seam only: a future provider-specific webhook must verify
  // its signature, timestamp and bank identity before calling this method.
  async notify(connectionId,{force=false}={}){if(!targets().some(t=>t.id===connectionId))throw Error('Unknown configured mock bank');const last=notifications.get(connectionId);if(!force&&last!==undefined&&clock()-last<30000)return false;notifications.set(connectionId,clock());return run(connectionId,'verified_bank_change_notification')}
 };
}
