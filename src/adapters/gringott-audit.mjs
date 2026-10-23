import {createAdapter} from './registry.mjs';
import {mapGringott} from './gringott.mjs';
import {requireResponse} from './http-transport.mjs';
import {sha} from '../security.mjs';

export async function captureGringott(connection){
 const observations=[],results=[];
 const signal=AbortSignal.timeout(45000);
 const adapter=createAdapter(connection.id,{signal,onObservation:o=>observations.push(o)});
 let consent,revoked=false,specHash=null;
 function finding(key,title,ok,expected,observed,layer='compatibility'){
  results.push({id:'GRINGOTT-'+key,title,layer,basis:'mock_contract',verdict:ok?'PASS':'FAIL',severity:ok?'info':'high',expected,observed,fix:ok?'Preserve this behavior.':'Inspect the original synthetic observation and correct the adapter or mock behavior.',observationIndex:observations.length?observations.length-1:undefined});
 }
 try{
  const specification=requireResponse(await adapter.transport.request('/openapi.json'));
  if(specification.openapi!=='3.0.3'||!specification.paths)throw Error('Unexpected Gringott OpenAPI contract');
  specHash=sha(specification);
  const unauthorized=await adapter.transport.request('/api/v1/accounts',{operation:'accounts',kind:'negative'});
  finding('AUTH','Unauthenticated AIS request is rejected',[401,403].includes(unauthorized.status),'401 or 403',String(unauthorized.status),'security');
  if(!unauthorized.transportError)finding('ERROR-SHAPE','Mock errors contain code and message',typeof unauthorized.body?.error?.code==='string'&&typeof unauthorized.body?.error?.message==='string','Gringott error.code and error.message','Mock error shape inspected');
  consent=await adapter.createConsent();consent=await adapter.completeAuthorization(consent);
  const status=await adapter.consentStatus(consent);
  finding('CONSENT','Synthetic consent is valid after authorization',status.consentStatus==='valid','valid',String(status.consentStatus),'security');
  if(status.consentStatus!=='valid')throw Error('Consent authorization not established');
  const list=await adapter.listAccounts(consent),body=requireResponse(list);
  const accounts=mapGringott('accounts',body).accounts;
  if(accounts.length>10)throw Error('Account limit exceeded');
  finding('ACCOUNTS','Accounts satisfy common mapping',true,'Opaque identifiers and currency preserved',accounts.length+' synthetic accounts');
  const unknown=await adapter.transport.request('/api/v1/accounts/not-a-real-account',{token:consent.token,operation:'accounts',kind:'negative'});
  finding('UNKNOWN-ACCOUNT','Unknown account is rejected',unknown.status===404,'404 for unknown account','HTTP '+unknown.status,'security');
  for(const account of accounts){
   try{const balance=requireResponse(await adapter.getBalances(consent,account.accountId));mapGringott('balances',balance);finding('BALANCES-'+account.accountId,'Balances preserve exact amounts and types',true,'Decimal strings, currencies and balance types',account.accountId);}catch(e){finding('BALANCES-'+account.accountId,'Balance request and mapping',false,'Valid mapped balances',e.message);}
   try{const tx=await adapter.listTransactions(consent,account.accountId);finding('PAGINATION-'+account.accountId,'Transactions paginate without repeats or omissions',true,'Bounded forward progress, unique IDs and declared total',tx.data.transactions.length+' transactions across '+tx.pages+' pages');}catch(e){finding('PAGINATION-'+account.accountId,'Transactions paginate without repeats or omissions',false,'Complete, bounded and semantically preserved transactions',e.message);}
  }
  await adapter.revokeConsent(consent);revoked=true;
  const denied=await adapter.listAccounts(consent,'negative');
  finding('REVOKED','Revoked consent denies AIS access',[401,403].includes(denied.status),'401 or 403 after revocation','HTTP '+denied.status,'security');
 }catch(e){finding('FLOW','Gringott AIS workflow completed',false,'Authorized synthetic HTTP workflow',signal.aborted?'Audit deadline exceeded':e.message);}
 finally{
  if(consent&&!revoked){try{await adapter.revokeConsent(consent);}catch{results.push({id:'GRINGOTT-CLEANUP',title:'Synthetic consent cleanup not confirmed',basis:'mock_contract',layer:'security',verdict:'NOT_ASSESSED',expected:'Revoke created consent',observed:'Cleanup request could not complete; mock expiry or reset is required.'});}}
 }
 const samples=observations.map(o=>({operation:o.operation,kind:o.kind,timestamp:o.timestamp,durationMs:o.durationMs,outcome:o.transportError==='TIMEOUT'?'timeout':o.status===429?'rate_limited':!o.transportError&&o.status>=200&&o.status<300?'success':'error'}));
 return {results,pack:{name:'Gringott captured synthetic HTTP evidence',mode:'mock_http',synthetic:true,profile:connection.profile,environment:'synthetic_mock',captureMethod:'GeoBridge Gringott adapter; measured HTTP requests',adapterVersion:'gringott-mock-v1',specHash,observations,samples}};
}
