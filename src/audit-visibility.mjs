// Resolve legacy ownership without rewriting historical evidence.
export function auditActorRole(run,users=[]){
 return run.actorRole||users.find(u=>u.id===run.actor)?.role||({'operator':'operator','nbg':'reviewer','bank':'bank'}[run.actor])||(run.actor?.startsWith('bank-')?'bank':null);
}
export function sharedBankReview(run,users=[]){return run?.kind==='bank'&&run.status==='completed'&&['operator','reviewer'].includes(auditActorRole(run,users))&&(run.results||[]).some(f=>f.verdict==='FAIL');}
export function auditVisible(user,run,users=[]){
 if(!run||!['operator','reviewer','bank'].includes(user.role))return false;
 if(run.kind==='platform')return user.role==='operator';
 const role=auditActorRole(run,users);
 if(run.kind!=='bank')return user.role==='operator'||run.tenant===user.tenant||user.role==='reviewer'&&run.tenant?.startsWith('bank-');
 if(user.role==='bank')return run.tenant===user.tenant&&(role==='bank'||!role||sharedBankReview(run,users));
 return role!=='bank'&&(user.role==='operator'||run.tenant===user.tenant||run.tenant?.startsWith('bank-'));
}
