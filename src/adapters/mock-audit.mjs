import {createAdapter} from './registry.mjs';

import {requireResponse} from './http-transport.mjs';
import {sha,redact} from '../security.mjs';

export async function captureMock(connection,{adapterFactory=createAdapter,timeoutMs=connection.adapter==='tbc-mock-v1'?90000:45000}={}){
 const observations=[],results=[];
 const signal=AbortSignal.timeout(timeoutMs);
 const adapter=adapterFactory(connection.id,{signal,onObservation:o=>observations.push(o)});
 const contracts={
  'gringott-mock-v1':{tag:'GRINGOTT',label:'Gringott',base:'/api/v1',errorShape:'nested',linked:false},
  'tbc-mock-v1':{tag:'TBC-MOCK',label:'TBC independent mock',base:'/0.8/v1',errorShape:'problem',linked:true},
  'bog-mock-v1':{tag:'BOG-MOCK',label:'BOG-style independent mock',base:'/v1',errorShape:'messages',linked:false}
 };
 const {tag,label,base,errorShape,linked}=contracts[adapter.version];
 let consent,revoked=false,specHash=null;
 function finding(key,title,ok,expected,observed,layer='compatibility'){
  results.push({id:tag+'-'+key,title,layer,basis:'mock_contract',verdict:ok?'PASS':'FAIL',severity:ok?'info':'high',expected,observed,fix:ok?'Preserve this behavior.':'Inspect the original synthetic observation and correct the adapter or mock behavior.',observationIndex:observations.length?observations.length-1:undefined});
 }
 const checks=[
  ['AUTH','Unauthenticated AIS request returns expected denial status','401 or 403 without a bearer token','security'],
  ['ERROR-SHAPE','Mock errors contain documented code and message fields','Documented error fields','compatibility'],
  ['CONSENT','Synthetic consent is valid after authorization','valid','security'],
  ['ACCOUNTS','Accounts satisfy common mapping','Opaque identifiers and currency preserved','compatibility'],
  ['UNKNOWN-ACCOUNT','Unknown account is rejected','404 for unknown account','security'],
  ['BALANCES','Balances preserve exact amounts and types','Valid mapped balances for discovered accounts','compatibility'],
  ['PAGINATION','Transactions follow bounded pagination without repeats','Complete bounded transaction pagination for discovered accounts','compatibility'],
  ['REVOKED','Revoked consent denies AIS access','401 or 403 after revocation','security']
 ];
 const message=e=>redact(signal.aborted?'Audit deadline exceeded':String(e.message||'Request could not complete'));
 function blocked(key,title,expected,reason,dependency,layer='compatibility'){
  results.push({id:tag+'-'+key,title,layer,basis:'mock_contract',verdict:'BLOCKED',severity:'info',expected,observed:'Blocked by '+dependency+': '+reason,fix:'Resolve the prerequisite and rerun this check. No independent defect is established.',blockedBy:dependency});
 }
 function blockFamily(key,reason,dependency){const c=checks.find(c=>c[0]===key);blocked(...c.slice(0,3),reason,dependency,c[3])}
 function missing(reason,dependency){for(const [key] of checks){if(!results.some(r=>r.id===tag+'-'+key||(['BALANCES','PAGINATION'].includes(key)&&r.id.startsWith(tag+'-'+key+'-'))))blockFamily(key,reason,dependency)}}
 let stage='contract',validConsent=false,unavailableReason='Required setup was not completed';
 try{
  const specification=requireResponse(await adapter.transport.request('/openapi.json',{maxResponseBytes:2_000_000}));
  if(!/^3\./.test(specification.openapi||'')||!specification.paths)throw Error('Unexpected mock OpenAPI contract');
  specHash=sha(specification);stage='authorization';
  consent=await adapter.createConsent();consent=await adapter.completeAuthorization(consent);
  // Independent probes are isolated: a malformed positive response must not suppress these tests.
  stage='authentication probe';
  try{
   const unauthorized=await adapter.transport.request(base+'/accounts',{consentId:consent.upstreamId,operation:'accounts',kind:'negative'});
   finding('AUTH','Unauthenticated AIS request returns expected denial status',[401,403].includes(unauthorized.status),'401 or 403 (a different denial status does not alone prove unauthorized data access)',String(unauthorized.status),'security');
   if(unauthorized.transportError)blockFamily('ERROR-SHAPE','Authentication probe returned no inspectable response',tag+'-AUTH');
   else{
    const b=unauthorized.body;
    const ok=errorShape==='messages'?Array.isArray(b?.tppMessages)&&b.tppMessages.length>0&&b.tppMessages.every(m=>m.category==='ERROR'&&typeof m.code==='string'&&typeof m.text==='string'):errorShape==='problem'?typeof b?.code==='string'&&typeof b?.detail==='string':typeof b?.error?.code==='string'&&typeof b?.error?.message==='string';
    finding('ERROR-SHAPE','Mock errors contain documented code and message fields',ok,errorShape==='messages'?'tppMessages with ERROR category, code and text':errorShape==='problem'?'Mock problem code and detail':'Gringott error.code and error.message','Mock error shape inspected');
   }
  }catch(e){finding('AUTH','Unauthenticated AIS request returns expected denial status',false,'401 or 403 without a bearer token',message(e),'security');blockFamily('ERROR-SHAPE','Authentication probe returned no inspectable response',tag+'-AUTH')}
  stage='consent status';
  try{const status=await adapter.consentStatus(consent);validConsent=status.consentStatus==='valid';finding('CONSENT','Synthetic consent is valid after authorization',validConsent,'valid',String(status.consentStatus),'security');unavailableReason='Consent status is not established as valid'}catch(e){unavailableReason=message(e);finding('CONSENT','Synthetic consent is valid after authorization',false,'valid',unavailableReason,'security')}
  if(validConsent&&!signal.aborted){
   let accounts=null,accountReason='Account discovery did not complete';
   try{
    const body=requireResponse(await adapter.listAccounts(consent));accounts=adapter.map('accounts',body).accounts;
    if(!Array.isArray(accounts)||accounts.length>10)throw Error('Account limit or account-list shape invalid');
    finding('ACCOUNTS','Accounts satisfy common mapping',true,'Opaque identifiers and currency preserved',accounts.length+' synthetic accounts');
   }catch(e){accounts=null;accountReason=message(e);finding('ACCOUNTS','Accounts satisfy common mapping',false,'Opaque identifiers and currency preserved',accountReason)}
   if(!signal.aborted){try{const unknown=await adapter.transport.request(base+'/accounts/not-a-real-account',{token:consent.token,consentId:consent.upstreamId,operation:'accounts',kind:'negative'});finding('UNKNOWN-ACCOUNT','Unknown account is rejected',unknown.status===404,'404 for unknown account','HTTP '+unknown.status,'security')}catch(e){finding('UNKNOWN-ACCOUNT','Unknown account is rejected',false,'404 for unknown account',message(e),'security')}}
   if(accounts?.length){
    for(const account of accounts){
     if(signal.aborted){blocked('BALANCES-'+account.accountId,'Balances preserve exact amounts and types','Valid mapped balances','Audit deadline reached before this check','audit deadline');blocked('PAGINATION-'+account.accountId,'Transactions follow bounded pagination without repeats','Bounded complete pagination','Audit deadline reached before this check','audit deadline');continue}
     try{const balance=requireResponse(await adapter.getBalances(consent,account.accountId));adapter.map('balances',balance);finding('BALANCES-'+account.accountId,'Balances preserve exact amounts and types',true,'Decimal strings, currencies and balance types',account.accountId)}catch(e){finding('BALANCES-'+account.accountId,'Balance request and mapping',false,'Valid mapped balances',message(e))}
     if(signal.aborted){blocked('PAGINATION-'+account.accountId,'Transactions follow bounded pagination without repeats','Bounded complete pagination','Audit deadline reached before this check','audit deadline');continue}
     try{const tx=await adapter.listTransactions(consent,account.accountId);finding('PAGINATION-'+account.accountId,'Transactions follow bounded pagination without repeats',true,linked?'Follow account-scoped next links; unique IDs (server total not independently known)':'Bounded forward progress, unique IDs and declared total',tx.data.transactions.length+' transactions across '+tx.pages+' pages')}catch(e){finding('PAGINATION-'+account.accountId,'Transactions follow bounded pagination without repeats',false,'Complete within declared pagination, bounded and semantically preserved transactions',message(e))}
    }
   }else{
    const reason=accounts?'No accounts were returned; account-scoped checks have no target':accountReason;
    blockFamily('BALANCES',reason,tag+'-ACCOUNTS');blockFamily('PAGINATION',reason,tag+'-ACCOUNTS');
   }
   if(!signal.aborted){try{await adapter.revokeConsent(consent);revoked=true;const denied=await adapter.listAccounts(consent,'negative');finding('REVOKED','Revoked consent denies AIS access',[401,403].includes(denied.status),'401 or 403 after revocation','HTTP '+denied.status,'security')}catch(e){finding('REVOKED','Consent revocation and subsequent access denial',false,'Successful revocation followed by denied access',message(e),'security')}}
  }
  missing(signal.aborted?'Audit deadline reached':unavailableReason,signal.aborted?'audit deadline':tag+'-CONSENT');
 }catch(e){
  unavailableReason=message(e);finding('FLOW',label+' AIS workflow setup completed',false,'Complete '+stage+' with a pinned contract and authorized synthetic session',unavailableReason);missing(unavailableReason,tag+'-FLOW');
 }finally{
  if(consent&&!revoked){try{await adapter.revokeConsent(consent)}catch{results.push({id:tag+'-CLEANUP',title:'Synthetic consent cleanup not confirmed',basis:'mock_contract',layer:'security',verdict:'NOT_ASSESSED',expected:'Revoke created consent',observed:'Cleanup request could not complete; mock expiry or reset is required.'})}}
 }

 const samples=observations.map(o=>({operation:o.operation,kind:o.kind,timestamp:o.timestamp,durationMs:o.durationMs,outcome:o.transportError==='TIMEOUT'?'timeout':o.status===429?'rate_limited':!o.transportError&&o.status>=200&&o.status<300?'success':'error'}));
 return {results,pack:{name:label+' captured synthetic HTTP evidence',mode:'mock_http',synthetic:true,profile:connection.profile,environment:'synthetic_mock',captureMethod:'GeoBridge '+adapter.version+'; measured HTTP requests',adapterVersion:adapter.version,specHash,observations,samples}};
}
