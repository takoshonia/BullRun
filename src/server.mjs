import {createProviderRouter} from './ai-providers.mjs';
import {generateNarrative} from './report-narrative.mjs';
import {aiConfig} from './ai-config.mjs';
import {createNarrativeJobs} from './report-narrative-jobs.mjs';
import {savedReports} from './report-store.mjs';
import {canReadReport} from './reports.mjs';
import http from 'node:http';
import {validateRegistration} from './connection-registration.mjs';
import {bankReadiness} from './bank-readiness.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {db,root,dataDir,seed,provisionDemoAccounts,all,get,put,remove,event} from './store.mjs';
import {id,sha,passwordMatch,redact,authorized,normalize,metrics,allowedURL} from './security.mjs';
import {profiles,initRules,sourceRegistry} from './rules.mjs';
import {validatePack} from './engine.mjs';
import {explain} from './ai.mjs';
import {contract} from './contracts.mjs';
import {compareRuns,specDiff} from './compare.mjs';
import {workspacePayload} from './workspace-access.mjs';
import {createAvailability,parseTargets} from './availability.mjs';
import {seedAdapterConnections,adapterTargets} from './adapters/registry.mjs';
import {createCommonAIS} from './adapters/common-ais.mjs';
const commonAIS=createCommonAIS();
const providerRouter=createProviderRouter({db});
const narrativeJobs=createNarrativeJobs(db,savedReports,{generate:(snapshot,options)=>generateNarrative(snapshot,{...options,router:providerRouter})});
const narrativeTick=setInterval(()=>{narrativeJobs.tick().catch(()=>console.error('Report explanation scheduler unavailable'))},1000);narrativeTick.unref();
const availability=createAvailability({db,targets:parseTargets(process.env.GEOBRIDGE_MOCK_TARGETS)});
availability.start();
seed();provisionDemoAccounts();initRules();
seedAdapterConnections({get,put});
for(const r of all('runs').filter(x=>['running','queued'].includes(x.status)))put('runs',{...r,status:'interrupted',error:'Server restarted. Rerun to obtain a complete result.'});
const reportBackfill=setInterval(()=>{try{const result=savedReports.backfill(1);for(const failure of result.errors)console.error('Report backfill failed for audit',failure.runId)}catch{console.error('Report backfill could not access storage')}},1000);reportBackfill.unref();
const PORT=Number(process.env.PORT||4317),HOST=process.env.GEOBRIDGE_HOST||'127.0.0.1';
const origin=process.env.GEOBRIDGE_ORIGIN||`http://127.0.0.1:${PORT}`;
const secure=origin.startsWith('https:');
const allowedHosts=(process.env.GEOBRIDGE_ALLOWED_HOSTS||'').split(',').filter(Boolean);
const loginAttempts=new Map();let active=null;
const safeUser=u=>({id:u.id,name:u.name,role:u.role,tenant:u.tenant});
const scope=(u,obj)=>['operator','bank','reviewer'].includes(u.role)&&obj&&authorized(u,obj.tenant)&&(obj.kind!=='platform'||u.role==='operator');
const error=(status,message)=>Object.assign(Error(message),{status});
function requireRole(u,...roles){if(!roles.includes(u.role))throw error(403,'Your role cannot perform this action')}
function visible(u,kind){return all(kind).filter(x=>scope(u,x))}
function enqueue(u,body){
 if(!u||u.disabled)throw error(403,'Account is disabled');
 requireRole(u,'operator','bank','reviewer');
 if(body.kind==='platform')requireRole(u,'operator');
 if(visible(u,'runs').some(x=>['queued','running'].includes(x.status)))throw error(409,'Finish or stop the current run first');
 if(!['platform','evidence','bank','spec'].includes(body.kind))throw error(400,'Select a valid audit mode');
 let pack;if(body.kind==='evidence'){pack=get('packs',body.packId);if(!scope(u,pack))throw error(404,'Evidence not found')}
 let connection;if(['bank','spec'].includes(body.kind)){connection=get('connections',body.connectionId);if(!scope(u,connection))throw error(404,'Connection not found')}
 if(body.kind==='bank'){const readiness=bankReadiness(connection,adapterTargets());if(!readiness.ready)throw error(409,readiness.reasons.map(r=>r.message).join(' '))}
 const r=put('runs',{id:id(),name:body.kind==='platform'?'System self-checks':body.kind==='spec'?'Specification review - '+connection.name:pack?'Evidence review · '+pack.name:(adapterTargets().some(t=>t.id===connection.id)?'Mock HTTP audit · ':'Sandbox readiness · ')+connection.name,tenant:connection?.tenant||pack?.tenant||u.tenant,actor:u.id,kind:body.kind,packId:pack?.id,connectionId:connection?.id,profile:pack?.profile||connection?.profile||'platform',status:'queued',progress:0,createdAt:new Date().toISOString(),results:[],metrics:[],counts:{}});
 event(u.id,'run_queued',r.id,{kind:r.kind});return r;
}
const tick=setInterval(()=>{try{
 if(!active){const run=all('runs').reverse().find(x=>x.status==='queued');if(run){active=new Worker(new URL('./worker.mjs',import.meta.url),{workerData:{id:run.id}});const current=active;active.runId=run.id;active.on('exit',()=>{if(active===current)active=null});active.on('error',e=>{put('runs',{...get('runs',run.id),status:'failed',error:e.message})})}}
 for(const s of all('schedules').filter(x=>x.enabled&&Date.parse(x.nextRun)<=Date.now())){try{enqueue(get('users',s.owner),{kind:s.kind,packId:s.packId,connectionId:s.connectionId});put('schedules',{...s,lastRun:new Date().toISOString(),nextRun:new Date(Date.now()+s.minutes*60000).toISOString(),lastError:null})}catch(e){put('schedules',{...s,lastError:e.message,nextRun:new Date(Date.now()+60000).toISOString()})}}
 }catch(e){console.error('Worker scheduling failed:',e.message)}},500);tick.unref();
async function body(req){let n=0,s='';for await(const c of req){n+=c.length;if(n>2_000_000)throw error(413,'Upload is limited to 2 MB');s+=c}if(!s)return {};try{return JSON.parse(s)}catch{throw error(400,'Invalid JSON')}}
function send(res,status,data,type='application/json; charset=utf-8',extra={}){res.writeHead(status,{'Content-Type':type,...extra});res.end(type.startsWith('application/json')?JSON.stringify(data):data)}
function csv(rows){const cell=v=>{let text=String(v??'');if(typeof v==='string'&&/^[=+@\t\r-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'};if(!rows.length)return 'No measurement samples\n';const keys=Object.keys(rows[0]);return keys.map(cell).join(',')+'\n'+rows.map(r=>keys.map(k=>cell(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])).join(',')).join('\n')}
function sendSavedReport(res,report){res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");return send(res,200,report.html,'text/html; charset=utf-8',{'Content-Disposition':`inline; filename="geobridge-${report.id}-v${report.version}.html"`,'X-Report-Id':report.id,'X-Report-Version':String(report.version),'X-Report-Hash':report.contentHash})}
function htmlReport(r,pack,type){const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return `<!doctype html><meta charset="utf-8"><title>GeoBridge ${esc(type)} report</title><style>body{font:15px system-ui;max-width:1100px;margin:40px auto;color:#30313b}h1{color:#467e80}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{padding:10px;text-align:left;border:1px solid #ddd}small{color:#666}@media print{button{display:none}}</style><h1>GeoBridge · ${esc(type)} report</h1><p>${esc(r.name)} · ${esc(r.id)}</p><p>Evidence: <b>${esc(r.evidenceMode)}</b> · Profile: ${esc(r.profile)} · ${esc(r.finishedAt)}</p><p>Selected checks only. No overall certification. ${esc(pack?.mode==='synthetic_fixture'?'Fictional fixture evidence; no bank was tested.':'')}</p><button onclick="window.print()">Print / Save PDF</button><h2>Verdicts</h2><p>${esc(JSON.stringify(r.counts))}</p>${type==='quality'?`<table><tr><th>Operation</th><th>Positive attempts</th><th>Successes</th><th>Errors</th><th>Timeouts</th><th>p50 ms</th><th>p95 ms</th></tr>${r.metrics.map(m=>`<tr>${[m.operation,m.attempts,m.successes,m.errors,m.timeouts,m.p50??'Not measured',m.p95??'Insufficient samples'].map(x=>'<td>'+esc(x)+'</td>').join('')}</tr>`).join('')}</table><p>Nearest-rank percentiles of successful positive requests only. p95 withheld below 20 successful samples. Negative, setup and warm-up requests excluded. No regulatory threshold configured.</p>`:`<table><tr><th>Check / source</th><th>Verdict</th><th>Expected</th><th>Observed</th><th>Guidance</th></tr>${r.results.map(f=>`<tr>${[f.title+' · '+(f.ruleId||f.id)+' §'+(f.section||'platform'),f.verdict,f.expected,f.observed,f.fix||'Inspect original evidence'].map(x=>'<td>'+esc(x)+'</td>').join('')}</tr>`).join('')}</table>`}<h2>Provenance and limits</h2><p>Build ${esc(r.build)} · Ruleset ${esc(r.rulesetHash)} · Evidence ${esc(r.evidenceHash||'No bank response')}</p><ul>${r.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul>`}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 try{
 const url=new URL(req.url,origin),p=url.pathname,method=req.method;
 if(!['GET','POST','DELETE','PATCH'].includes(method))throw error(405,'Method not allowed');
 if(!p.startsWith('/api/')&&!p.startsWith('/bridge/')){if(method!=='GET')throw error(405,'Read-only asset');const asset=p==='/'?'index.html':p.slice(1);if(!['index.html','app.js','style.css','logo.png','logo-login.png'].includes(asset))throw error(404,'Not found');const file=path.join(root,'public',asset);return send(res,200,fs.readFileSync(file),asset.endsWith('js')?'text/javascript':asset.endsWith('css')?'text/css':asset.endsWith('png')?'image/png':'text/html')}
 if(p==='/api/health')return send(res,200,{status:'ok',version:'0.1.0',bankConnections:adapterTargets().length?'mock_only':'not_configured',realBankConnections:'not_configured'});
 if(method!=='GET'&&req.headers.origin!==origin)throw error(403,'Origin check failed. Open '+origin);
 if(p==='/api/login'&&method==='POST'){
 const address=req.socket.remoteAddress,prev=loginAttempts.get(address)||{n:0,start:Date.now()};if(Date.now()-prev.start>60000){prev.n=0;prev.start=Date.now()}if(++prev.n>10)throw error(429,'Too many login attempts; wait one minute');loginAttempts.set(address,prev);
 const b=await body(req);if(typeof b.username!=='string'||typeof b.password!=='string')throw error(400,'Username and password must be text');const u=get('users',b.username);if(!u||u.disabled||!passwordMatch(String(b.password||''),u.password))throw error(401,'Invalid username or password');loginAttempts.delete(address);const sid=id()+id(),csrf=id();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sha(sid),u.id,csrf,Date.now()+8*3600000);event(u.id,'login','session');res.setHeader('Set-Cookie',`geobridge=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure?'; Secure':''}`);return send(res,200,{user:safeUser(u),csrf});
 }
 const sid=(req.headers.cookie||'').match(/(?:^|;\s*)geobridge=([^;]+)/)?.[1];const session=sid?db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(sha(sid),Date.now()):null;const u=session?get('users',session.user_id):null;
 if(!u||u.disabled)throw error(401,'Sign in to GeoBridge');if(method!=='GET'&&req.headers['x-csrf-token']!==session.csrf)throw error(403,'Request token missing or invalid');
 if(p==='/api/me')return send(res,200,{user:safeUser(u),csrf:session.csrf});
 if(p==='/api/availability'||p.startsWith('/api/availability/')){
  requireRole(u,'operator','bank','reviewer');
  const targets=availability.targets().filter(t=>authorized(u,t.tenant));
  if(p==='/api/availability'&&method==='GET')return send(res,200,{targets:targets.map(t=>({...t,canSwitch:u.role==='operator'&&t.canSwitch,report:availability.report(t.id)}))});
  const match=p.match(/^\/api\/availability\/([a-z0-9-]+)(?:\/(report|configure|probe|switch))?$/);
  if(!match||!targets.some(t=>t.id===match[1]))throw error(404,'Monitor not found');
  const [,target,action='report']=match;
  try{
   if(action==='report'&&method==='GET'){
    const from=url.searchParams.has('from')?Number(url.searchParams.get('from')):undefined;
    const to=url.searchParams.has('to')?Number(url.searchParams.get('to')):undefined;
    const report=availability.report(target,from,to),format=url.searchParams.get('format')||'json';
    if(format==='csv')return send(res,200,csv([{target:report.name,synthetic:true,from:new Date(report.window.from).toISOString(),to:new Date(report.window.to).toISOString(),checks:report.checks,successfulChecksPercent:report.successfulChecksPercent,estimatedUptimePercent:report.estimatedUptimePercent,estimatedUpMs:report.estimatedUpMs,estimatedDownMs:report.estimatedDownMs,unknownMs:report.unknownMs,coveragePercent:report.coveragePercent,incidents:JSON.stringify(report.incidents),limitations:report.limitations.join(' ')}]),'text/csv; charset=utf-8',{'Content-Disposition':`attachment; filename="availability-${target}.csv"`});
    if(format!=='json')throw Error('Supported formats: json, csv');
    return send(res,200,report,'application/json; charset=utf-8',{'Content-Disposition':`attachment; filename="availability-${target}.json"`});
   }
   if(method!=='POST')throw error(405,'Method not allowed');
   if(action==='switch'){
    requireRole(u,'operator');const b=await body(req);const result=await availability.switchMock(target,b.online);event(u.id,'mock_availability_changed',target,{online:b.online});return send(res,200,result);
   }
   requireRole(u,'operator','bank');
   if(action==='configure'){const result=availability.configure(target,await body(req));event(u.id,'availability_configured',target,{enabled:result.enabled,intervalSeconds:result.intervalSeconds,timeoutSeconds:result.timeoutSeconds});return send(res,200,result);}
   if(action==='probe')return send(res,200,{recorded:await availability.probe(target)});
   throw error(404,'Unknown monitoring action');
  }catch(e){if(e.status)throw e;throw error(400,e.message);}
 }
 if(p==='/api/contract'&&method==='GET')return send(res,200,contract);
 if(p==='/api/compare'&&method==='POST'){const b=await body(req),before=get('runs',b.before),after=get('runs',b.after);if(!scope(u,before)||!scope(u,after))throw error(404,'Run not found');if(before.status!=='completed'||after.status!=='completed')throw error(400,'Both runs must be completed');try{return send(res,200,compareRuns(before,after))}catch(e){throw error(400,e.message)}}
 if(p==='/api/spec-diff'&&method==='POST'){requireRole(u,'reviewer','operator');const b=await body(req);if(!b.before?.paths||!b.after?.paths)throw error(400,'Provide before and after OpenAPI objects with paths');return send(res,200,specDiff(b.before,b.after))}
 if(p==='/api/logout'&&method==='POST'){commonAIS.clearOwner(u.id);db.prepare('DELETE FROM sessions WHERE id=?').run(session.id);res.setHeader('Set-Cookie','geobridge=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return send(res,200,{ok:true})}
 if(p==='/api/workspace'&&method==='GET')return send(res,200,workspacePayload(u,{records:all,profiles,sources:sourceRegistry(),aiConfigured:aiConfig().configured,canSee:authorized,reportSummaries:savedReports.listVisible(u)}));
 if(p==='/api/connections'&&method==='POST'){requireRole(u,'bank','operator');const {errors,connection}=validateRegistration(await body(req),profiles);if(Object.keys(errors).length)throw Object.assign(error(400,'Check the required connection fields.'),{fieldErrors:errors});try{allowedURL(connection.baseUrl,allowedHosts)}catch(e){throw Object.assign(error(400,'Sandbox API host requires operator approval: '+e.message),{fieldErrors:{baseUrl:e.message}})}const c=put('connections',{...connection,id:id(),tenant:u.role==='operator'?'bank-demo':u.tenant,status:'not_connected',capabilities:Object.fromEntries(['accounts','balances','transactions'].map(op=>[op,'unknown'])),createdAt:new Date().toISOString(),adapter:null});event(u.id,'connection_registered',c.id);return send(res,201,c)}
 if(p.match(/^\/api\/connections\/[^/]+\/spec$/)&&method==='POST'){requireRole(u,'bank','operator');const cid=p.split('/')[3],c=get('connections',cid);if(!scope(u,c))throw error(404,'Connection not found');const b=await body(req),spec=b.spec;if(!spec||!/^3\./.test(spec.openapi)||!spec.paths)throw error(400,'Provide an OpenAPI 3 JSON document');const text=JSON.stringify(spec);if(text.includes('"$ref":"http'))throw error(400,'Remote $ref is not resolved. Bundle references locally.');const paths=Object.keys(spec.paths);if(paths.length>500)throw error(400,'Too many paths');put('specs',{id:cid,tenant:c.tenant,spec:redact(spec),sha256:sha(spec),uploadedAt:new Date().toISOString()});put('connections',{...c,specHash:sha(spec),operationCount:paths.length});event(u.id,'spec_uploaded',cid,{hash:sha(spec),paths:paths.length});let runId=null;try{runId=enqueue(u,{kind:'spec',connectionId:cid}).id}catch(e){if(e.status!==409)throw e}return send(res,200,{hash:sha(spec),paths:paths.length,runId,notice:runId?'Specification recorded; selected static checks queued. Runtime bank behavior is not assessed.':'Specification recorded. Finish the active run, then select Review specification on this connection.'})}
 if(p==='/api/packs'&&method==='POST'){requireRole(u,'bank','operator');const b=await body(req);let pack;try{pack=validatePack(b)}catch(e){throw error(400,e.message)}if(!profiles.some(x=>x.id===pack.profile))throw error(400,'Select a profile');const x=put('packs',{...redact(pack),id:id(),tenant:u.tenant,createdAt:new Date().toISOString(),hash:sha(redact(pack))});event(u.id,'synthetic_evidence_imported',x.id,{mode:x.mode});return send(res,201,{id:x.id,name:x.name})}
 if(p==='/api/example'&&method==='GET')return send(res,200,JSON.parse(fs.readFileSync(path.join(root,'examples','synthetic-evidence.json'),'utf8')));
 if(p==='/api/diagnostics'){requireRole(u,'operator');if(method==='GET')return send(res,200,{runs:visible(u,'runs').filter(r=>r.kind==='platform')});if(method==='POST')return send(res,201,enqueue(u,{kind:'platform'}))}
 if(p.match(/^\/api\/connections\/[^/]+\/readiness$/)&&method==='GET'){requireRole(u,'operator','bank','reviewer');const connection=get('connections',p.split('/')[3]);if(!scope(u,connection))throw error(404,'Connection not found');return send(res,200,bankReadiness(connection,adapterTargets()))}
 if(p==='/api/reports'&&method==='GET'){requireRole(u,'operator','bank','reviewer');const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)throw error(400,'Invalid report page');return send(res,200,{reports:savedReports.listVisible(u,{limit:50,offset:(page-1)*50}),page,pageSize:50})}
 const narrativeMatch=p.match(/^\/api\/reports\/([a-z0-9-]+)\/explanation$/);
 if(narrativeMatch&&method==='POST'){requireRole(u,'operator','bank','reviewer');const source=savedReports.metadata(narrativeMatch[1]);if(!source||!canReadReport(u,source))throw error(404,'Report not found');return send(res,202,narrativeJobs.enqueue(source.id,u.id))}
 const jobMatch=p.match(/^\/api\/report-explanations\/([a-z0-9-]+)$/);
 if(jobMatch&&method==='GET'){requireRole(u,'operator','bank','reviewer');const job=narrativeJobs.get(jobMatch[1]),source=job&&savedReports.metadata(job.sourceReportId);if(!source||!canReadReport(u,source))throw error(404,'Explanation not found');return send(res,200,job)}
 const reportMatch=p.match(/^\/api\/reports\/([a-z0-9-]+)(?:\/(html))?$/);
 if(reportMatch&&method==='GET'){requireRole(u,'operator','bank','reviewer');const reportMeta=savedReports.metadata(reportMatch[1]);if(!reportMeta||!canReadReport(u,reportMeta))throw error(404,'Report not found');const report=savedReports.get(reportMeta.id);if(reportMatch[2]==='html')return sendSavedReport(res,report);const {html,...json}=report;return send(res,200,json)}
 if(p==='/api/runs'&&method==='POST'){requireRole(u,'bank','operator','reviewer');return send(res,201,enqueue(u,await body(req)))}
 const runMatch=p.match(/^\/api\/runs\/([^/]+)(?:\/(.*))?$/);
 if(runMatch){const r=get('runs',runMatch[1]);if(!scope(u,r))throw error(404,'Run not found');const action=runMatch[2];
 if(action==='reports'){requireRole(u,'operator','bank','reviewer');if(method==='GET')return send(res,200,{reports:savedReports.history(r.id)});if(method==='POST'){requireRole(u,'operator','bank','reviewer');if(r.status!=='completed')throw error(409,'Audit is not completed');const b=await body(req);if(typeof b.reason!=='string'||b.reason.trim().length<12||b.reason.length>300)throw error(400,'Describe the reason for the new report version (12–300 characters)');if(typeof b.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId))throw error(400,'A unique request ID is required');const report=savedReports.createRevision(r,{reason:b.reason.trim(),requestId:b.requestId,createdBy:u.id});return send(res,201,report)}}
 if(!action&&method==='GET')return send(res,200,r);
 if(action==='stop'&&method==='POST'){requireRole(u,'operator','bank','reviewer');if(!['running','queued'].includes(r.status))throw error(409,'Run is already finished');if(active?.runId===r.id){const w=active;active=null;await w.terminate()}put('runs',{...r,status:'cancelled',finishedAt:new Date().toISOString()});event(u.id,'run_cancelled',r.id);return send(res,200,{ok:true})}
 if(action?.startsWith('export/')&&method==='GET'){const type=action.split('/')[1];const pack=r.packId?get('packs',r.packId):null;if(r.status!=='completed')throw error(409,'Run has not completed');if(type==='full'){requireRole(u,'operator','bank','reviewer');const report=savedReports.latest(r.id);if(!report)throw error(409,'Saved report is being prepared. Try again shortly.');return sendSavedReport(res,savedReports.get(report.id))}
 if(type==='json')return send(res,200,r,'application/json; charset=utf-8',{'Content-Disposition':`attachment; filename="geobridge-${r.id}.json"`});
 if(type==='csv'){requireRole(u,'operator','bank','reviewer');return send(res,200,csv(pack?.samples||[]),'text/csv; charset=utf-8',{'Content-Disposition':`attachment; filename="geobridge-${r.id}-samples.csv"`});}
 if(!['quality','incompatibility'].includes(type))throw error(404,'Export not found');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");return send(res,200,htmlReport(r,pack,type),'text/html; charset=utf-8',{'Content-Disposition':`inline; filename="geobridge-${type}.html"`})}
 if(action==='explain'&&method==='POST'){const b=await body(req);const f=r.results.find(x=>x.id===b.findingId);if(!f)throw error(404,'Finding not found');const key=sha({tenant:r.tenant,f,language:b.language,model:aiConfig().model,configured:aiConfig().configured,promptVersion:'finding-2'});const cached=f.verdict==='BLOCKED'?null:get('explanations',key);if(cached)return send(res,200,{...cached,cached:true});const result=await explain(f,b.language,{router:providerRouter});if(result.mode==='live_ai_advisory')put('explanations',{...result,id:key,tenant:r.tenant});event(u.id,'explanation_generated',r.id,{mode:result.mode});return send(res,200,result)}
 }
 if(p.match(/^\/api\/packs\/[^/]+$/)&&method==='GET'){requireRole(u,'bank','operator');const pack=get('packs',p.split('/')[3]);if(!scope(u,pack))throw error(404,'Evidence not found');return send(res,200,pack)}
 if(p==='/api/normalize'&&method==='POST'){requireRole(u,'tpp','operator');const b=await body(req);if(b.synthetic!==true)throw error(400,'Synthetic data confirmation required');try{return send(res,200,{data:normalize(b.operation,b.body),meta:{mode:'local_mapping_preview',bankCall:false,adapterVersion:'common-contract-0.1.0'}})}catch(e){throw error(422,'UPSTREAM_CONTRACT_VIOLATION: '+e.message)}}
 if(p.startsWith('/bridge/v1/')){
  requireRole(u,'tpp','operator');
  if(p==='/bridge/v1/connections')return send(res,200,{connections:all('connections').filter(c=>u.role==='operator'||c.published===true||c.synthetic&&c.status==='mock_configured').map(c=>({id:c.id,name:c.name,status:c.status,synthetic:!!c.synthetic,capabilities:c.capabilities})),notice:'Configured synthetic adapters only. No real bank connected.'});
  const match=p.match(/^\/bridge\/v1\/connections\/([a-z0-9-]+)\/(consents(?:\/([a-z0-9-]+))?|accounts(?:\/([^/]+)\/(balances|transactions))?)$/);
  if(!match)throw error(404,'Unknown common endpoint');
  const [,cid,route,consentId,accountId,operation='accounts']=match;
  if(u.role==='tpp'){const connection=get('connections',cid);if(connection&&!(connection.published===true||connection.synthetic&&connection.status==='mock_configured'))throw error(404,'Connection not published')}
  if(!adapterTargets().some(t=>t.id===cid))throw error(503,'BANK_NOT_CONNECTED');
  try{
   event(u.id,'common_api_request',cid,{operation:route.startsWith('accounts')?operation:'consent',method,synthetic:true});
   if(route==='consents'&&method==='POST')return send(res,201,await commonAIS.connect(u,cid));
   if(consentId&&method==='DELETE')return send(res,200,await commonAIS.revoke(u,cid,consentId));
   if(route.startsWith('accounts')&&method==='GET')return send(res,200,await commonAIS.read(u,cid,req.headers['consent-id'],operation,accountId?decodeURIComponent(accountId):undefined));
   throw error(405,'Method not allowed');
  }catch(e){event(u.id,'common_api_error',cid,{operation:route.startsWith('accounts')?operation:'consent',status:e.status||(e.message==='TIMEOUT'?504:422),synthetic:true});if(e.status)throw e;throw error(e.message==='TIMEOUT'?504:422,'UPSTREAM_CONTRACT_VIOLATION: '+e.message);}
 }
 if(p==='/api/sources'&&method==='GET'){requireRole(u,'operator','bank','reviewer');const name=url.searchParams.get('file');if(!sourceRegistry().some(s=>s.file===name))throw error(404,'Source not found');return send(res,200,fs.readFileSync(path.join(root,'sources',name),'utf8'),'text/plain; charset=utf-8')}
 if(p.match(/^\/api\/rules\/[^/]+\/review$/)&&method==='POST'){requireRole(u,'reviewer','operator');const rid=p.split('/')[3],rule=get('rules',rid);if(!rule)throw error(404,'Rule not found');const b=await body(req);if(!b.note||b.note.length<12||b.confirm!==true)throw error(400,'Read the source and record an applicability review note (12+ characters)');if(b.approve&&!rule.quoteVerified)throw error(409,'Source locator did not verify; correct the rule before approval');const next={...rule,status:b.approve?'approved':'draft',reviewer:u.id,reviewNote:b.note,reviewedAt:new Date().toISOString()};put('rules',next);event(u.id,'rule_'+next.status,rid,{note:b.note});return send(res,200,next)}
 if(p==='/api/updates'&&method==='POST'){requireRole(u,'reviewer','operator');const b=await body(req);if(!b.sourceId||!b.text||b.text.length>300000)throw error(400,'Select source and provide a text snapshot');const source=sourceRegistry().find(x=>x.id===b.sourceId);if(!source)throw error(400,'Unknown source');const old=fs.readFileSync(path.join(root,'sources',source.file),'utf8');const prev=new Set(old.split('\n'));const next=new Set(b.text.split('\n'));const added=[...next].filter(x=>!prev.has(x)&&x.trim()).slice(0,60);const removed=[...prev].filter(x=>!next.has(x)&&x.trim()).slice(0,60);const update=put('updates',{id:id(),sourceId:b.sourceId,title:b.title||'Candidate source snapshot',mode:'user_supplied_comparison',status:'draft',oldHash:sha(old),newHash:sha(b.text),added,removed,affectedRules:all('rules').filter(x=>x.source===source.file).map(x=>x.id),createdAt:new Date().toISOString(),notice:'Text diff only. Not an official new mandate. No rules automatically activated.'});event(u.id,'source_change_proposed',update.id);return send(res,201,update)}
 if(p==='/api/schedules'&&method==='POST'){requireRole(u,'bank','operator','reviewer');const b=await body(req);if(b.kind==='platform')requireRole(u,'operator');if(!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>1440||!['platform','evidence','bank'].includes(b.kind))throw error(400,'Interval 1–1440 minutes required');if(b.kind==='evidence'&&!scope(u,get('packs',b.packId)))throw error(404,'Evidence not found');if(b.kind==='bank'&&!scope(u,get('connections',b.connectionId)))throw error(404,'Connection not found');const scheduleTenant=b.kind==='bank'?get('connections',b.connectionId).tenant:b.kind==='evidence'?get('packs',b.packId).tenant:u.tenant;const s=put('schedules',{id:id(),tenant:scheduleTenant,owner:u.id,kind:b.kind,packId:b.packId,connectionId:b.connectionId,minutes:b.minutes,enabled:true,nextRun:new Date(Date.now()+b.minutes*60000).toISOString(),label:b.kind==='evidence'?'Replay review (not fresh bank probes)':b.kind==='platform'?'Platform assurance':adapterTargets().some(t=>t.id===b.connectionId)?'Mock fresh HTTP audit':'Sandbox readiness (no requests)'});event(u.id,'schedule_created',s.id);return send(res,201,s)}
 if(p.match(/^\/api\/schedules\/[^/]+$/)&&method==='DELETE'){requireRole(u,'bank','operator','reviewer');const s=get('schedules',p.split('/')[3]);if(!scope(u,s))throw error(404,'Schedule not found');remove('schedules',s.id);event(u.id,'schedule_removed',s.id);return send(res,200,{ok:true})}
 if(p==='/api/gates'&&method==='POST'){requireRole(u,'reviewer','operator');const b=await body(req),r=get('runs',b.runId);if(!scope(u,r)||r.status!=='completed')throw error(400,'Select a completed run');const f=r.results.filter(x=>x.verdict==='FAIL'),blocked=r.results.some(x=>['BLOCKED','NEEDS_REVIEW','NOT_ASSESSED'].includes(x.verdict));const bankReady=r.evidenceMode==='sandbox_capture'&&r.results.some(x=>x.basis==='standard_candidate');const decision=f.length?'REJECTED':blocked||!bankReady?'HOLD':'APPROVED';const g=put('gates',{id:id(),tenant:r.tenant,actor:u.id,runId:r.id,name:String(b.name||'Candidate release').slice(0,100),decision,reason:f.length?'Failed applicable checks require remediation':!bankReady?'Bank evidence and applicable reviewed coverage not established':blocked?'Essential coverage incomplete':'Selected reviewed checks passed',at:new Date().toISOString(),scope:'GeoBridge publication only; does not control external bank deployments'});event(u.id,'gate_evaluated',g.id,{decision});return send(res,201,g)}
 if(p==='/api/events'&&method==='GET'){const rows=db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 500').all();const runIds=new Set(['runs','connections','schedules','gates','packs'].flatMap(k=>visible(u,k).map(x=>x.id)));const orgActors=new Set(all('users').filter(x=>x.tenant===u.tenant).map(x=>x.id));return send(res,200,rows.filter(e=>u.role==='operator'||(e.action.startsWith('common_api_')?orgActors.has(e.actor):orgActors.has(e.actor)||u.role==='reviewer'&&['rule_approved','rule_draft','source_change_proposed'].includes(e.action)||runIds.has(e.target))).slice(0,100))}
 throw error(404,'Endpoint not found');
 }catch(e){send(res,e.status||500,{error:e.status?e.message:'Internal operation failed; inspect the local server log.',...(e.fieldErrors?{fieldErrors:e.fieldErrors}:{})});if(!e.status)console.error(e.stack)}
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'GeoBridge port is already in use. Close the previous instance or choose another PORT.':e.message);process.exitCode=1;clearInterval(tick)});
server.listen(PORT,HOST,()=>{console.log(`GeoBridge is running at ${origin}`);console.log('Demo credentials: '+path.join(dataDir,'demo-credentials.json'));console.log(adapterTargets().length?'Synthetic AIS adapters configured; no real bank connected.':'No bank adapters configured.');});
process.on('SIGTERM',()=>{availability.stop();clearInterval(narrativeTick);clearInterval(reportBackfill);clearInterval(tick);active?.terminate();server.close(()=>process.exit())});
