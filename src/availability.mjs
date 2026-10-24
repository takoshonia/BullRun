import {targetTenant} from './organization-scope.mjs';
// Synthetic endpoint monitoring only. Targets are operator-configured, never user-supplied URLs.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import crypto from 'node:crypto';

export function parseTargets(raw='[]') {
 const list=JSON.parse(raw);
 if(!Array.isArray(list)||list.length>10)throw Error('Configure at most 10 synthetic monitoring targets');
 const seen=new Set();
 return list.filter(t=>t.monitor!==false).map(t=>{
  const url=new URL(t.origin);
  if(!/^[a-z0-9-]{1,50}$/.test(t.id)||seen.has(t.id)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid synthetic monitor target');
  seen.add(t.id);
  const adminKey=t.adminKeyFile?fs.readFileSync(t.adminKeyFile,'utf8').trim():'';
  if(adminKey&&Buffer.byteLength(adminKey)<32)throw Error('Mock admin key must be 32+ bytes');
  return {id:t.id,name:String(t.name||t.id).slice(0,100),tenant:targetTenant(t),origin:url.origin,adminKey,adminHeader:t.adapter==='bog-mock-v1'?'X-BOG-Mock-Admin-Key':'X-Gringott-Admin-Key'};
 });
}

export function requestJSON(url,{timeoutMs=2000,method='GET',body,headers={}}={}) {
 return new Promise(resolve=>{
  const start=performance.now();let done=false,timer;
  const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve({...result,durationMs:Math.round(performance.now()-start)});};
  const req=(url.startsWith('https:')?https:http).request(url,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{
   let text='',bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192){finish({outcome:'invalid_response',httpStatus:res.statusCode});res.destroy();req.destroy();}else text+=chunk;});
   res.on('end',()=>{let data;try{data=JSON.parse(text)}catch{}finish({outcome:res.statusCode===200&&data?.status==='ok'?'up':'down',httpStatus:res.statusCode,data});});
   res.on('error',()=>finish({outcome:'network_error',httpStatus:res.statusCode}));
  });
  // Absolute deadline includes DNS, connection, headers and body. Redirects are never followed.
  timer=setTimeout(()=>{finish({outcome:'timeout',httpStatus:null});req.destroy();},timeoutMs);
  req.on('error',()=>finish({outcome:'network_error',httpStatus:null}));
  req.end(body?JSON.stringify(body):undefined);
 });
}

export function summarize(samples,{from,to,enabled=true,intervalMs=30000,now=Date.now()}={}) {
 const rows=[...samples].sort((a,b)=>a.at-b.at);
 const first=from??rows[0]?.at??now,last=to??now;
 let upMs=0,downMs=0,incident=null;const incidents=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],prev=rows[i-1];
  const continuous=prev&&prev.epoch===row.epoch&&row.at-prev.at<=prev.intervalMs*2.5;
  if(prev&&continuous){const dt=Math.max(0,Math.min(row.at,last)-Math.max(prev.at,first));if(prev.outcome==='up')upMs+=dt;else downMs+=dt;}
  if(!continuous&&incident){incidents.push({...incident,endedAt:null,interrupted:true});incident=null;}
  if(row.outcome!=='up'&&!incident)incident={detectedAt:row.at,lastSuccessfulAt:continuous&&prev.outcome==='up'?prev.at:null,lastFailedAt:row.at,failedChecks:0};
  if(row.outcome!=='up'){incident.lastFailedAt=row.at;incident.failedChecks++;}
  else if(incident){incidents.push({...incident,endedAt:row.at,estimatedDurationMs:row.at-incident.detectedAt,interrupted:false});incident=null;}
 }
 if(incident)incidents.push({...incident,endedAt:null,interrupted:false});
 const measuredMs=upMs+downMs,latest=rows.at(-1),successes=rows.filter(r=>r.outcome==='up').length;
 const fresh=enabled&&latest&&now-latest.at<=intervalMs*2.5;
 return {window:{from:first,to:last},checks:rows.length,successes,failedChecks:rows.length-successes,successfulChecksPercent:rows.length?100*successes/rows.length:null,estimatedUptimePercent:measuredMs?100*upMs/measuredMs:null,estimatedUpMs:upMs,estimatedDownMs:downMs,unknownMs:Math.max(0,last-first-measuredMs),coveragePercent:last>first?100*measuredMs/(last-first):null,currentStatus:!enabled?'paused':!fresh?'unknown':latest.outcome==='up'?'up':'down',lastCheck:latest||null,incidents,limitations:['Synthetic health endpoint availability only; not authenticated AIS operation availability or real bank SLA.','Time estimates use last observed state between adjacent checks in the same process/configuration epoch.','Restart, pause, gaps over 2.5 intervals and time after the latest check are unknown.','Detection precision is bounded by the probe interval plus request deadline.']};
}

export function createAvailability({db,targets,clock=Date.now,request=requestJSON}) {
 db.exec(`CREATE TABLE IF NOT EXISTS availability_monitors(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,interval_ms INTEGER NOT NULL,timeout_ms INTEGER NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS availability_samples(id INTEGER PRIMARY KEY AUTOINCREMENT,target TEXT NOT NULL,at INTEGER NOT NULL,outcome TEXT NOT NULL,http_status INTEGER,duration_ms INTEGER NOT NULL,epoch TEXT NOT NULL,interval_ms INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS availability_target_time ON availability_samples(target,at);`);
 const live=new Set(),epochs=new Map(),due=new Map();let stopped=false,timer;
 for(const t of targets){db.prepare('INSERT OR IGNORE INTO availability_monitors VALUES(?,0,30000,2000,?)').run(t.id,clock());epochs.set(t.id,crypto.randomUUID());}
 const config=id=>db.prepare('SELECT * FROM availability_monitors WHERE id=?').get(id);
 const target=id=>{const t=targets.find(t=>t.id===id);if(!t)throw Error('Unknown configured mock target');return t;};
 function report(id,from=clock()-86400000,to=clock()){
  const t=target(id),c=config(id);
  if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to||to-from>30*86400000||to>clock()+1000)throw Error('Report window must be valid and at most 30 days');
  const samples=db.prepare('SELECT at,outcome,http_status AS httpStatus,duration_ms AS durationMs,epoch,interval_ms AS intervalMs FROM availability_samples WHERE target=? AND at>=? AND at<=? ORDER BY at,id').all(id,from,to);
  const summary=summarize(samples,{from,to,enabled:!!c.enabled,intervalMs:c.interval_ms,now:clock()});
  if(c.enabled&&samples.at(-1)?.epoch!==epochs.get(id))summary.currentStatus='unknown';
  return {id,name:t.name,tenant:t.tenant,synthetic:true,probe:'GET /api/health; HTTP 200 with JSON status=ok',enabled:!!c.enabled,intervalSeconds:c.interval_ms/1000,timeoutSeconds:c.timeout_ms/1000,...summary,recentSamples:samples.slice(-100)};
 }
 async function probe(id){
  const t=target(id),c=config(id);if(stopped||live.has(id)||!c.enabled||(due.get(id)||0)>clock())return false;
  live.add(id);const epoch=epochs.get(id),at=clock();due.set(id,at+c.interval_ms);
  try{
   let r;try{r=await request(t.origin+'/api/health',{timeoutMs:c.timeout_ms})}catch{r={outcome:'network_error',httpStatus:null,durationMs:0};}
   if(stopped||epoch!==epochs.get(id))return false;
   db.prepare('INSERT INTO availability_samples(target,at,outcome,http_status,duration_ms,epoch,interval_ms) VALUES(?,?,?,?,?,?,?)').run(id,clock(),r.outcome,r.httpStatus??null,r.durationMs,epoch,c.interval_ms);
   // Rolling 30-day evidence retention. No downtime is invented for removed samples.
   db.prepare('DELETE FROM availability_samples WHERE at<?').run(clock()-30*86400000);
   return true;
  }finally{live.delete(id);}
 }
 function configure(id,b){target(id);if(typeof b.enabled!=='boolean'||!Number.isInteger(b.intervalSeconds)||b.intervalSeconds<5||b.intervalSeconds>3600||!Number.isInteger(b.timeoutSeconds)||b.timeoutSeconds<1||b.timeoutSeconds>10||b.timeoutSeconds>=b.intervalSeconds)throw Error('Use interval 5–3600s and deadline 1–10s shorter than interval');
  db.prepare('UPDATE availability_monitors SET enabled=?,interval_ms=?,timeout_ms=? WHERE id=?').run(+b.enabled,b.intervalSeconds*1000,b.timeoutSeconds*1000,id);epochs.set(id,crypto.randomUUID());due.set(id,0);return report(id);
 }
 async function switchMock(id,online){const t=target(id);if(typeof online!=='boolean')throw Error('online must be boolean');if(!t.adminKey)throw Error('No private mock administration key configured');const r=await request(t.origin+'/api/admin/availability',{method:'POST',body:{online,mode:'no_response'},headers:{[t.adminHeader||'X-Gringott-Admin-Key']:t.adminKey},timeoutMs:2000});if(r.httpStatus!==200||r.data?.availability?.online!==online)throw Error('Mock switch failed');return {online,synthetic:true};}
 async function tick(){for(const t of targets){if(stopped)break;if(config(t.id).enabled&&(due.get(t.id)||0)<=clock())await probe(t.id);}}
 return {targets:()=>targets.map(({id,name,tenant,adminKey})=>({id,name,tenant,canSwitch:!!adminKey,synthetic:true})),report,configure,probe,switchMock,start(){timer=setInterval(()=>tick().catch(e=>console.error('Availability monitor:',e.message)),500);timer.unref();},stop(){stopped=true;clearInterval(timer);}};
}
