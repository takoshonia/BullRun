import {auditVisible,sharedBankReview,auditActorRole} from './audit-visibility.mjs';
export function categorySummary(results){
 if(!Array.isArray(results))return null;
 return Object.fromEntries(['compatibility','reliability','latency','security'].map(layer=>{
  const rows=results.filter(f=>(f.layer||f.category)===layer),counts={};for(const f of rows)counts[f.verdict||'UNKNOWN']=(counts[f.verdict||'UNKNOWN']||0)+1;
  return [layer,{total:rows.length,counts}];
 }));
}
// Assemble the minimum workspace payload for each role; hiding navigation is not authorization.
export function workspacePayload(user,{records,profiles,sources,aiConfigured,canSee,reportSummaries=[]}){
 const users=records('users'),visibleRuns=records('runs').filter(r=>canSee(user,r.tenant)&&auditVisible(user,r,users)),visibleIds=new Set(visibleRuns.map(r=>r.id));
 const own=kind=>records(kind).filter(x=>canSee(user,x.tenant));
 const manager=['operator','bank'].includes(user.role),standards=['operator','reviewer'].includes(user.role),diagnostic=['operator','bank','reviewer'].includes(user.role);
 const connections=diagnostic?own('connections').map(c=>user.role==='reviewer'?{id:c.id,name:c.name,tenant:c.tenant,bankName:c.bankName,status:c.status,environment:c.environment,profile:c.profile,capabilities:c.capabilities,synthetic:c.synthetic,specHash:c.specHash}:c):[];
 const packs=manager?own('packs'):[];
 const selectedProfiles=new Set([...connections,...packs].map(x=>x.profile));
 const rules=standards?records('rules'):user.role==='bank'?records('rules').filter(x=>x.status==='approved'&&selectedProfiles.has(x.profile)):[];
 const sourceNames=new Set(rules.map(x=>x.source));
 return {
  user:{id:user.id,name:user.name,role:user.role,tenant:user.tenant},
  connections,
  savedReports:diagnostic?reportSummaries.filter(r=>visibleIds.has(r.runId)&&r.kind!=='platform'):[],
  catalog:['tpp','operator'].includes(user.role)?records('connections').filter(c=>user.role==='operator'||c.published===true||c.synthetic&&c.status==='mock_configured').map(c=>({id:c.id,name:c.name,status:c.status,profile:c.profile,capabilities:c.capabilities})):[],
  runs:diagnostic?visibleRuns.filter(x=>x.kind!=='platform').map(({results,...r})=>({...r,actorRole:auditActorRole(r,users),bankReview:user.role==='bank'&&sharedBankReview({...r,results},users),categorySummary:categorySummary(results)})):[],
  diagnosticsRuns:user.role==='operator'?own('runs').filter(x=>x.kind==='platform').slice(0,100).map(({results,...r})=>r):[],
  packs:(user.role==='reviewer'?own('packs'):packs).map(({observations,samples,...x})=>({...x,observationCount:observations.length,sampleCount:samples.length})),
  profiles:['operator','reviewer'].includes(user.role)?profiles:user.role==='bank'?profiles.filter(x=>x.id!=='platform'):profiles.filter(x=>selectedProfiles.has(x.id)),
  rules,
  sources:standards?sources:user.role==='bank'?sources.filter(x=>sourceNames.has(x.file)):[],
  schedules:diagnostic?own('schedules').filter(x=>x.kind!=='platform'||user.role==='operator'):[],
  gates:diagnostic?own('gates'):[],
  updates:standards?records('updates'):user.role==='bank'?records('updates').filter(x=>x.status==='approved'):[],
  ai:{configured:aiConfigured},
  capabilities:{bankRuntime:false,mockRuntime:records('connections').some(c=>['gringott-mock-v1','tbc-mock-v1','bog-mock-v1'].includes(c.adapter)),reason:'Only explicitly configured synthetic adapters can execute; real bank authorization is pending'}
 };
}
