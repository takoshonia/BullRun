import {createAdapter} from './registry.mjs';

import {requireResponse} from './http-transport.mjs';
import {sha} from '../security.mjs';

export async function captureMock(connection){
 const observations=[],results=[];
 const signal=AbortSignal.timeout(connection.adapter==='tbc-mock-v1'?90000:45000);
 const adapter=createAdapter(connection.id,{signal,onObservation:o=>observations.push(o)});
 const isTbc=adapter.version==='tbc-mock-v1',tag=isTbc?'TBC-MOCK':'GRINGOTT',label=isTbc?'TBC independent mock':'Gringott',base=isTbc?'/0.8/v1':'/api/v1';
 let consent,revoked=false,specHash=null;
 function finding(key,title,ok,expected,observed,layer='compatibility'){
  results.push({id:tag+'-'+key,title,layer,basis:'mock_contract',verdict:ok?'PASS':'FAIL',severity:ok?'info':'high',expected,observed,fix:ok?'Preserve this behavior.':'Inspect the original synthetic observation and correct the adapter or mock behavior.',observationIndex:observations.length?observations.length-1:undefined});
 }
 try{
  const specification=requireResponse(await adapter.transport.request('/openapi.json',{maxResponseBytes:2_000_000}));
  if(!/^3\./.test(specification.openapi||'')||!specification.paths)throw Error('Unexpected mock OpenAPI contract');
  specHash=sha(specification);
  const unauthorized=await adapter.transport.request(base+'/accounts',{operation:'accounts',kind:'negative'});
  finding('AUTH','Unauthenticated AIS request returns expected denial status',[401,403].includes(unauthorized.status),'401 or 403 (a different denial status does not alone prove unauthorized data access)',String(unauthorized.status),'security');
  if(!unauthorized.transportError)finding('ERROR-SHAPE','Mock errors contain documented code and message fields',isTbc?typeof unauthorized.body?.code==='string'&&typeof unauthorized.body?.detail==='string':typeof unauthorized.body?.error?.code==='string'&&typeof unauthorized.body?.error?.message==='string',isTbc?'Mock problem code and detail':'Gringott error.code and error.message','Mock error shape inspected');
  consent=await adapter.createConsent();consent=await adapter.completeAuthorization(consent);
  const status=await adapter.consentStatus(consent);
  finding('CONSENT','Synthetic consent is valid after authorization',status.consentStatus==='valid','valid',String(status.consentStatus),'security');
  if(status.consentStatus!=='valid')throw Error('Consent authorization not established');
  const list=await adapter.listAccounts(consent),body=requireResponse(list);
  const accounts=adapter.map('accounts',body).accounts;
  if(accounts.length>10)throw Error('Account limit exceeded');
  finding('ACCOUNTS','Accounts satisfy common mapping',true,'Opaque identifiers and currency preserved',accounts.length+' synthetic accounts');
  const unknown=await adapter.transport.request(base+'/accounts/not-a-real-account',{token:consent.token,consentId:consent.upstreamId,operation:'accounts',kind:'negative'});
  finding('UNKNOWN-ACCOUNT','Unknown account is rejected',unknown.status===404,'404 for unknown account','HTTP '+unknown.status,'security');
  for(const account of accounts){
   try{const balance=requireResponse(await adapter.getBalances(consent,account.accountId));adapter.map('balances',balance);finding('BALANCES-'+account.accountId,'Balances preserve exact amounts and types',true,'Decimal strings, currencies and balance types',account.accountId);}catch(e){finding('BALANCES-'+account.accountId,'Balance request and mapping',false,'Valid mapped balances',e.message);}
   try{const tx=await adapter.listTransactions(consent,account.accountId);finding('PAGINATION-'+account.accountId,'Transactions follow bounded pagination without repeats',true,isTbc?'Follow account-scoped next links; unique IDs (server total not independently known)':'Bounded forward progress, unique IDs and declared total',tx.data.transactions.length+' transactions across '+tx.pages+' pages');}catch(e){finding('PAGINATION-'+account.accountId,'Transactions follow bounded pagination without repeats',false,'Complete within declared pagination, bounded and semantically preserved transactions',e.message);}
  }
  await adapter.revokeConsent(consent);revoked=true;
  const denied=await adapter.listAccounts(consent,'negative');
  finding('REVOKED','Revoked consent denies AIS access',[401,403].includes(denied.status),'401 or 403 after revocation','HTTP '+denied.status,'security');
 }catch(e){finding('FLOW',label+' AIS workflow completed',false,'Authorized synthetic HTTP workflow',signal.aborted?'Audit deadline exceeded':e.message);}
 finally{
  if(consent&&!revoked){try{await adapter.revokeConsent(consent);}catch{results.push({id:tag+'-CLEANUP',title:'Synthetic consent cleanup not confirmed',basis:'mock_contract',layer:'security',verdict:'NOT_ASSESSED',expected:'Revoke created consent',observed:'Cleanup request could not complete; mock expiry or reset is required.'});}}
 }
 const samples=observations.map(o=>({operation:o.operation,kind:o.kind,timestamp:o.timestamp,durationMs:o.durationMs,outcome:o.transportError==='TIMEOUT'?'timeout':o.status===429?'rate_limited':!o.transportError&&o.status>=200&&o.status<300?'success':'error'}));
 return {results,pack:{name:label+' captured synthetic HTTP evidence',mode:'mock_http',synthetic:true,profile:connection.profile,environment:'synthetic_mock',captureMethod:'GeoBridge '+adapter.version+'; measured HTTP requests',adapterVersion:adapter.version,specHash,observations,samples}};
}
