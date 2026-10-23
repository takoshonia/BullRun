import crypto from 'node:crypto';
import {BankAdapter} from '../contracts.mjs';
import {normalize} from '../security.mjs';
import {requireResponse} from './http-transport.mjs';
import {collectLinkedTransactions} from './linked-pagination.mjs';

export const BOG_MOCK_VERSION='bog-mock-v1';
const clientId='geobridge-demo';
const resource=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(value))throw Error('Invalid BOG mock resource identifier');return value;};
export function mapBogMock(operation,body){
 const data=normalize(operation,body);
 if(operation==='transactions'&&new Set(data.transactions.map(t=>t.transactionId)).size!==data.transactions.length)throw Error('Repeated transaction identifier');
 return data;
}

export class BogMockAdapter extends BankAdapter {
 constructor(transport){super();this.transport=transport;this.version=BOG_MOCK_VERSION;this.authorization='BOG-style mock automated approval with S256 PKCE; no real customer authentication';}
 map(operation,body){return mapBogMock(operation,body);}
 capabilities(){return {accounts:true,balances:true,transactions:true,consent:true,payments:false,synthetic:true,authorization:'mock_pkce_approval',adapterVersion:this.version};}
 async createConsent(){
  // Non-recurring audit grants avoid expiring another user's existing recurring grant.
  const validUntil=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const body={access:{allPsd2:'allAccounts'},recurringIndicator:false,validUntil,frequencyPerDay:4,combinedServiceIndicator:false};
  const result=requireResponse(await this.transport.request('/v1/consents',{method:'POST',body}),201);
  return {upstreamId:resource(result.consentId)};
 }
 async completeAuthorization(consent){
  const verifier=crypto.randomBytes(48).toString('base64url'),state=crypto.randomBytes(24).toString('base64url');
  const redirectUri=this.transport.origin+'/callback';
  const query=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectUri,state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',consentId:consent.upstreamId});
  const html=requireResponse(await this.transport.request('/oauth/authorize?'+query,{sensitive:true,responseType:'text'}));
  const challenge=html.match(/name="challenge" value="([A-Za-z0-9_-]{1,200})"/)?.[1];
  if(!challenge)throw Error('Mock approval challenge missing');
  const decision=await this.transport.request('/oauth/decision',{method:'POST',body:{challenge,decision:'approve'},sensitive:true});
  requireResponse(decision,302);
  if(typeof decision.location!=='string')throw Error('Mock authorization redirect missing');
  const target=new URL(decision.location,this.transport.origin),code=target.searchParams.get('code');
  if(target.origin!==this.transport.origin||target.pathname!=='/callback'||target.hash||target.searchParams.get('state')!==state||target.searchParams.has('error')||!code||!/^[A-Za-z0-9_-]{1,2048}$/.test(code))throw Error('Mock authorization redirect/state invalid');
  const token=requireResponse(await this.transport.request('/oauth/token',{method:'POST',body:{grant_type:'authorization_code',client_id:clientId,redirect_uri:redirectUri,code,code_verifier:verifier},sensitive:true}));
  if(token.token_type!=='Bearer'||typeof token.access_token!=='string'||!/^[A-Za-z0-9._~-]{1,2048}$/.test(token.access_token)||!Number.isFinite(token.expires_in)||token.expires_in<=0)throw Error('Invalid BOG mock token response');
  return {...consent,token:token.access_token,expiresAt:Date.now()+Math.min(token.expires_in*1000,900000)};
 }
 async consentStatus(consent){const body=requireResponse(await this.transport.request('/v1/consents/'+resource(consent.upstreamId)+'/status'));return {...body,validUntil:new Date(consent.expiresAt).toISOString()};}
 async revokeConsent(consent){requireResponse(await this.transport.request('/v1/consents/'+resource(consent.upstreamId),{method:'DELETE'}),204);}
 listAccounts(consent,kind='positive'){return this.transport.request('/v1/accounts',{token:consent.token,consentId:consent.upstreamId,operation:'accounts',kind});}
 getBalances(consent,account){return this.transport.request('/v1/accounts/'+resource(account)+'/balances',{token:consent.token,consentId:consent.upstreamId,operation:'balances',kind:'positive'});}
 listTransactions(consent,account){
  let total;
  return collectLinkedTransactions({transport:this.transport,consent,path:'/v1/accounts/'+resource(account)+'/transactions',query:'?bookingStatus=both&dateFrom=2020-01-01&pageSize=3&page=1',map:mapBogMock,validatePage:({body,page,count,nextUrl})=>{
   const meta=body.mockPagination;
   if(!meta||meta.page!==page||meta.pageSize!==3||!Number.isInteger(meta.total)||meta.total<0||meta.total>1000)throw Error('Invalid BOG mock pagination metadata');
   if(total!==undefined&&meta.total!==total)throw Error('Transaction total changed during bounded snapshot');total=meta.total;
   const size=body.transactions.booked.length+body.transactions.pending.length;
   if(size>3||count>total||nextUrl&&size!==3||!nextUrl&&count!==total)throw Error('Pagination omitted declared transactions');
   if(nextUrl){const q=nextUrl.searchParams;
    if(q.get('bookingStatus')!=='both'||q.get('dateFrom')!=='2020-01-01'||q.get('pageSize')!=='3'||q.get('page')!==String(page+1)||[...q.keys()].length!==4)throw Error('Pagination changed query scope or did not advance');
   }
  }});
 }
}
