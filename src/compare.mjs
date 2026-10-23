export function compareRuns(before,after){
 if(before.profile!==after.profile)throw Error('Compare runs using the same profile');
 if(before.evidenceMode!==after.evidenceMode)throw Error('Compare the same evidence mode');
 if(before.evidenceMode==='mock_http'&&before.connectionId!==after.connectionId)throw Error('Regression comparison requires the same mock connection');
 const key=r=>(r.ruleId||r.id)+'|'+(r.observationIndex??'');
 const old=new Map(before.results.map(r=>[key(r),r]));
 return {before:before.id,after:after.id,profile:after.profile,evidenceMode:after.evidenceMode,changes:after.results.filter(r=>old.has(key(r))&&old.get(key(r)).verdict!==r.verdict).map(r=>({id:r.ruleId||r.id,title:r.title,before:old.get(key(r)).verdict,after:r.verdict})),notice:'Comparison is meaningful only for equivalent fixtures/workloads and applicable rule coverage. Source/ruleset differences remain visible.',rulesetChanged:before.rulesetHash!==after.rulesetHash,evidenceChanged:before.evidenceHash!==after.evidenceHash};
}
export function specDiff(before,after){const removed=[],added=[],changed=[];for(const [route,ops]of Object.entries(before.paths||{})){if(!after.paths?.[route]){removed.push(route);continue}for(const op of ['get','post','put','patch','delete'])if(ops[op]&&!after.paths[route][op])removed.push(op.toUpperCase()+' '+route);else if(ops[op]&&JSON.stringify(ops[op])!==JSON.stringify(after.paths[route][op]))changed.push(op.toUpperCase()+' '+route)}for(const route of Object.keys(after.paths||{}))if(!before.paths?.[route])added.push(route);return {removed,added,changed,notice:'Structural endpoint diff only; semantic compatibility requires reviewed regression tests.'}}
