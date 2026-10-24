// Assemble the minimum workspace payload for each role; hiding navigation is not authorization.
export function workspacePayload(user,{records,profiles,sources,aiConfigured,canSee,reportSummaries=[]}){
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
  savedReports:diagnostic?reportSummaries.filter(r=>canSee(user,r.tenant)&&r.kind!=='platform'):[],
  catalog:['tpp','operator'].includes(user.role)?records('connections').filter(c=>user.role==='operator'||c.published===true||c.synthetic&&c.status==='mock_configured').map(c=>({id:c.id,name:c.name,status:c.status,profile:c.profile,capabilities:c.capabilities})):[],
  runs:diagnostic?own('runs').filter(x=>x.kind!=='platform').slice(0,100).map(({results,...r})=>r):[],
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
