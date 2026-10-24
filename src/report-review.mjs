import {sha} from './security.mjs';

export function groupFindings(snapshot){
 const groups=new Map();
 for(const [index,f] of snapshot.findings.entries()){
  // Group only equivalent assertions and outcomes. Distinct defects, sources and severities stay separate.
  const mapping=f.basis==='platform_contract'&&/^MAP-\d+$/.test(f.ruleId||f.id||'');
  const identity={rule:mapping?'mapping:'+f.title:f.ruleId||f.title,layer:f.layer,verdict:f.verdict,severity:f.severity,expected:f.expected,observed:f.observed,source:f.source,sourceHash:f.sourceHash,section:f.section,basis:f.basis,remediation:f.remediation,assessmentLimit:f.assessmentLimit};
  const key=sha(identity);
  if(!groups.has(key))groups.set(key,{...f,displayRule:mapping?'Common contract':f.ruleId||f.id,reference:'group-'+index,members:[],count:0});
  const group=groups.get(key);group.members.push({reference:'finding-'+index,id:f.id,observationIndex:f.observationIndex??null});group.count++;
 }
 const severity={critical:0,high:1,medium:2,low:3,unspecified:4};
 return [...groups.values()].sort((a,b)=>(severity[a.severity]??4)-(severity[b.severity]??4));
}
export function reviewReport(snapshot){
 const groups=groupFindings(snapshot),select=v=>groups.filter(g=>g.verdict===v),counts={};
 for(const f of snapshot.findings)counts[f.verdict]=(counts[f.verdict]||0)+1;
 const failures=select('FAIL'),blocked=select('BLOCKED'),pending=select('NEEDS_REVIEW'),passes=select('PASS'),unassessed=select('NOT_ASSESSED'),notApplicable=select('NOT_APPLICABLE');
 const mode=snapshot.run.evidenceMode;
 const scope=snapshot.run.kind==='platform'?'internal system diagnostics':mode==='mock_http'?'a synthetic mock HTTP audit':mode==='specification_only'?'a specification review':mode==='synthetic_fixture'?'a synthetic fixture review':'an imported-evidence review';
 const summary=`This run was ${scope}. It recorded ${counts.PASS||0} passing observations, ${counts.FAIL||0} failing observations and ${counts.BLOCKED||0} blocked observations. ${counts.NEEDS_REVIEW||0} draft-rule observations await approval and were not executed.`;
 return {groups,counts,failures,blocked,pending,passes,unassessed,notApplicable,summary};
}

export function nextAction(f,owner='Bank engineer / Operator'){
 if(f.verdict==='PASS')return 'No corrective action indicated by this check.';
 if(f.verdict==='NEEDS_REVIEW')return 'Standards reviewer: confirm the source, applicability and implementation before approval. Execute this check after approval; no bank defect has been established.';
 if(f.verdict==='BLOCKED')return owner+': resolve the missing setup or evidence described above, then rerun this check. A blocked check does not establish a bank defect.';
 if(f.verdict==='NOT_ASSESSED')return owner+': collect matching evidence and execute an applicable check before drawing a conclusion.';
 if(f.verdict==='NOT_APPLICABLE')return 'No action for this observation scope.';
 return f.remediation||'Inspect the referenced evidence, confirm applicability, correct the demonstrated defect and retest.';
}
