import {normalize} from '../security.mjs';
import {requireResponse} from './http-transport.mjs';
import {BankAdapter} from '../contracts.mjs';

export const GRINGOTT_VERSION='gringott-mock-v1';

export function mapGringott(operation,body){
 if(operation!=='transactions')return normalize(operation,body);
 if(!Array.isArray(body.transactions))throw Error('Gringott transactions must be an array');
 const seen=new Set(),booked=[],pending=[];
 for(const t of body.transactions){
  if(!t.transactionId||seen.has(t.transactionId))throw Error('Missing or repeated transaction identifier');
  seen.add(t.transactionId);
  if(!['booked','pending'].includes(t.status))throw Error('Unknown transaction status; adapter refuses to guess');
  (t.status==='booked'?booked:pending).push(t);
 }
 return normalize('transactions',{transactions:{booked,pending}});
}

export class GringottAdapter extends BankAdapter {
 constructor(transport){super();this.transport=transport;}
 capabilities(){return {accounts:true,balances:true,transactions:true,consent:true,payments:false,synthetic:true,authorization:'simulated_code',adapterVersion:GRINGOTT_VERSION};}
 async createConsent(){
  const result=requireResponse(await this.transport.request('/api/v1/consents',{method:'POST',body:{permissions:['accounts','balances','transactions']}}),201);
  if(typeof result.consent?.consentId!=='string'||!result.consent.consentId||result.consent.consentId.length>200)throw Error('Consent identifier missing or invalid');
  return {upstreamId:result.consent.consentId};
 }
 async completeAuthorization(consent){
  const response=await this.transport.request('/oauth/authorize?consentId='+encodeURIComponent(consent.upstreamId),{sensitive:true});
  requireResponse(response,302);
  const redirect=new URL(response.location,this.transport.origin);
  if(redirect.origin!==this.transport.origin||redirect.pathname!=='/'||redirect.searchParams.get('consentId')!==consent.upstreamId||redirect.searchParams.get('oauth')!=='approved')throw Error('Invalid mock authorization redirect');
  const code=redirect.searchParams.get('code');if(!code)throw Error('Authorization code missing');
  const result=requireResponse(await this.transport.request('/oauth/token',{method:'POST',body:{code},sensitive:true}));
  if(typeof result.access_token!=='string'||!/^[A-Za-z0-9._~-]{1,2048}$/.test(result.access_token)||result.token_type!=='Bearer'||!Number.isFinite(result.expires_in)||result.expires_in<=0)throw Error('Invalid token response');
  return {...consent,token:result.access_token,expiresAt:Date.now()+Math.min(result.expires_in*1000,900000)};
 }
 async consentStatus(consent){return requireResponse(await this.transport.request('/api/v1/consents/'+encodeURIComponent(consent.upstreamId)+'/status'));}
 async revokeConsent(consent){requireResponse(await this.transport.request('/api/v1/consents/'+encodeURIComponent(consent.upstreamId),{method:'DELETE'}),204);}
 async listAccounts(consent,kind='positive'){return this.transport.request('/api/v1/accounts',{token:consent.token,operation:'accounts',kind});}
 async getBalances(consent,accountId){return this.transport.request('/api/v1/accounts/'+encodeURIComponent(accountId)+'/balances',{token:consent.token,operation:'balances',kind:'positive'});}
 async getAccountDetails(consent,accountId){return this.transport.request('/api/v1/accounts/'+encodeURIComponent(accountId),{token:consent.token,operation:'accounts',kind:'positive'});}
 async listTransactionsPage(consent,accountId,offset=0){return this.transport.request('/api/v1/accounts/'+encodeURIComponent(accountId)+'/transactions?limit=2&offset='+offset,{token:consent.token,operation:'transactions',kind:'positive'});}
 async listTransactions(consent,accountId){
  const transactions=[],seen=new Set();let offset=0,total;
  for(let page=0;page<20;page++){
   const response=await this.listTransactionsPage(consent,accountId,offset),body=requireResponse(response);
   mapGringott('transactions',body);
   if(!body.page||body.page.offset!==offset||!Number.isInteger(body.page.total)||body.page.total<0||body.page.total>1000||body.transactions.length>2)throw Error('Invalid pagination metadata');
   if(total!==undefined&&total!==body.page.total)throw Error('Transaction total changed during bounded snapshot');total=body.page.total;
   for(const t of body.transactions){if(seen.has(t.transactionId))throw Error('Repeated transaction across pages');seen.add(t.transactionId);transactions.push(t);}
   const next=body.page.nextOffset;
   if(next===null){if(transactions.length!==total)throw Error('Pagination ended before declared total');return {data:mapGringott('transactions',{transactions}),original:{transactions},pages:page+1};}
   if(!Number.isInteger(next)||next!==offset+body.transactions.length||next<=offset||next>=total)throw Error('Pagination made no valid forward progress');offset=next;
  }
  throw Error('Transaction page limit exceeded');
 }
}
