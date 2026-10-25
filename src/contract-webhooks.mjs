import fs from 'node:fs';
import crypto from 'node:crypto';
const error=(status,message)=>Object.assign(Error(message),{status});
export function webhookSignature(secret,timestamp,eventId,raw){return crypto.createHmac('sha256',secret).update(timestamp+'.'+eventId+'.').update(raw).digest('hex')}
export function webhookConfiguration(raw=process.env.GEOBRIDGE_CONTRACT_WEBHOOKS||'[]',targets=[]){
 const entries=JSON.parse(raw);if(!Array.isArray(entries)||entries.length>10)throw Error('Invalid contract webhook configuration');const seen=new Set(),secrets=new Set();
 return entries.map(x=>{if(!targets.some(t=>t.id===x.connectionId)||seen.has(x.connectionId)||typeof x.secretFile!=='string')throw Error('Webhook requires a unique configured bank and private secret file');seen.add(x.connectionId);const secret=fs.readFileSync(x.secretFile,'utf8').trim();if(Buffer.byteLength(secret)<32||secret.length>4096)throw Error('Webhook secret must be 32-4096 bytes');if(secrets.has(secret))throw Error('Each bank requires a distinct webhook signing secret');secrets.add(secret);const controlKey=x.demoControlKeyFile?fs.readFileSync(x.demoControlKeyFile,'utf8').trim():null;if(controlKey&&(Buffer.byteLength(controlKey)<32||controlKey===secret))throw Error('Mock push control key too short');return {connectionId:x.connectionId,secret,controlKey,synthetic:true}});
}
export async function webhookBody(req){let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)throw error(413,'Webhook exceeds 16 KB');chunks.push(chunk)}return Buffer.concat(chunks)}
export function createContractWebhooks({configuration,all,get,put,event,notify,scanStatus,clock=Date.now}){
 let working=false;
 // A process may have stopped after acknowledgement but before completing its scan.
 for(const r of all('contract_webhooks'))if(r.status==='processing')put('contract_webhooks',{...r,status:'retry',nextAttemptAt:clock()});
 function accept(connectionId,headers,raw){
  const config=configuration.find(x=>x.connectionId===connectionId);if(!config)throw error(404,'Webhook not configured');
  const timestamp=headers['x-geobridge-timestamp'],eventId=headers['x-geobridge-event-id'],signature=headers['x-geobridge-signature'];
  if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(clock()-Number(timestamp)*1000)>300000||typeof eventId!=='string'||!/^[a-f0-9-]{36}$/.test(eventId)||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))throw error(401,'Invalid or expired webhook signature');
  const expected=Buffer.from(webhookSignature(config.secret,timestamp,eventId,raw),'hex');if(!crypto.timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))throw error(401,'Invalid or expired webhook signature');
  let payload;try{payload=JSON.parse(raw)}catch{throw error(400,'Invalid webhook JSON')}
  if(!payload||Object.keys(payload).sort().join(',')!=='connectionId,revision,synthetic,type'||payload.connectionId!==connectionId||payload.type!=='api.contract.changed'||payload.synthetic!==true||typeof payload.revision!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(payload.revision))throw error(400,'Unsupported mock contract event');
  const id=crypto.createHash('sha256').update(connectionId+':'+eventId).digest('hex'),bodyHash=crypto.createHash('sha256').update(raw).digest('hex'),previous=get('contract_webhooks',id);
  if(previous){if(previous.bodyHash!==bodyHash)throw error(409,'Event identity reused with a different payload');return {eventId,duplicate:true,status:previous.status}}
  if(all('contract_webhooks').filter(r=>r.connectionId===connectionId&&['pending','retry','processing'].includes(r.status)).length>=50)throw error(429,'Webhook queue is full; retry later');
  put('contract_webhooks',{id,eventId,connectionId,revision:payload.revision,bodyHash,synthetic:true,status:'pending',attempts:0,receivedAt:new Date(clock()).toISOString(),nextAttemptAt:clock()});event('mock-bank','contract_webhook_received',connectionId,{eventId,revision:payload.revision,signatureVerified:true});return {eventId,duplicate:false,status:'pending'};
 }
 async function tick(){if(working)return;working=true;try{const pending=all('contract_webhooks').filter(r=>['pending','retry'].includes(r.status)&&r.nextAttemptAt<=clock()).sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt));for(const r of pending){
  const next={...r,status:'processing',attempts:r.attempts+1};put('contract_webhooks',next);
  try{const scanned=await notify(r.connectionId);if(!scanned)throw Error('Scan busy');const status=scanStatus(r.connectionId);if(status?.status!=='ok')throw Error('Scan unavailable');put('contract_webhooks',{...next,status:'processed',processedAt:new Date(clock()).toISOString(),snapshotId:status.snapshotId});event('system','contract_webhook_scanned',r.connectionId,{eventId:r.eventId,snapshotId:status.snapshotId})}
  catch{put('contract_webhooks',{...next,status:next.attempts>=8?'failed':'retry',lastError:'Scan could not complete; no contract change inferred.',nextAttemptAt:clock()+Math.min(60000,1000*2**(next.attempts-1))})}
 }}finally{working=false}}
 return {accept,tick,view:()=>({configuredBanks:configuration.map(c=>c.connectionId),deliveries:all('contract_webhooks').slice(0,50).map(({bodyHash,nextAttemptAt,...r})=>r)})};
}
