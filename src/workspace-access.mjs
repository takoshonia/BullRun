// Assemble the minimum workspace payload for each role; hiding navigation is not authorization.
export function workspacePayload(user,{records,profiles,sources,aiConfigured,canSee}){
 const own=kind=>records(kind).filter(x=>canSee(user,x.tenant));
 const manager=['operator','bank'].includes(user.role),standards=['operator','standards'].includes(user.role),diagnostic=['operator','bank','reviewer'].includes(user.role);
 const connections=diagnostic?own('connections'):[];
 const packs=manager?own('packs'):[];
 const selectedProfiles=new Set([...connections,...packs].map(x=>x.profile));
 const rules=standards?records('rules'):user.role==='bank'?records('rules').filter(x=>selectedProfiles.has(x.profile)):[];
 const sourceNames=new Set(rules.map(x=>x.source));
 return {
  user:{id:user.id,name:user.name,role:user.role,tenant:user.tenant},
  connections,
  catalog:['tpp','operator'].includes(user.role)?records('connections').map(c=>({id:c.id,name:c.name,status:c.status,profile:c.profile,capabilities:c.capabilities,synthetic:!!c.synthetic,scenario:c.synthetic?c.scenario:undefined})):[],
  runs:diagnostic?own('runs').filter(x=>user.role!=='reviewer'||x.kind!=='platform').slice(0,100).map(({results,...r})=>r):[],
  packs:packs.map(({observations,samples,...x})=>({...x,observationCount:observations.length,sampleCount:samples.length})),
  profiles:['operator','standards'].includes(user.role)?profiles:user.role==='bank'?profiles.filter(x=>x.id!=='platform'):profiles.filter(x=>selectedProfiles.has(x.id)),
  rules,
  sources:standards?sources:user.role==='bank'?sources.filter(x=>sourceNames.has(x.file)):[],
  schedules:manager?own('schedules'):[],
  gates:manager?own('gates'):[],
  updates:standards?records('updates'):user.role==='bank'?records('updates').filter(x=>x.status==='approved'):[],
  ai:{configured:aiConfigured},
  capabilities:{bankRuntime:false,mockRuntime:true,reason:'Two synthetic mock adapters available; real bank integration pending'}
 };
}
