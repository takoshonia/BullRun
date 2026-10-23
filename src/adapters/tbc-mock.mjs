import crypto from 'node:crypto';
import {BankAdapter} from '../contracts.mjs';
import {normalize} from '../security.mjs';
import {requireResponse} from './http-transport.mjs';

export const TBC_MOCK_VERSION='tbc-mock-v1';
const prefix='/0.8/v1';
const identifier=value=>{if(typeof value!=='string'||!value||value.length>200)throw Error('Invalid mock resource identifier');return value;};

// The documented TBC mock represents an absent booked/pending category as empty.
// Preserve explicit categories and reject unknown array categories rather than guessing.
export function mapTbcMock(operation,body){
 if(operation!=='transactions')return normalize(operation,body);
 const tx=body.transactions;
 if(!tx||typeof tx!=='object'||Array.isArray(tx))throw Error('TBC transactions object missing');
 if(!('booked'in tx)&&!('pending'in tx))throw Error('No supported transaction category');
 for(const key of ['booked','pending'])if(key in tx&&!Array.isArray(tx[key]))throw Error('Invalid '+key+' transaction category');
 const data=normalize(operation,{...body,transactions:{...tx,booked:tx.booked??[],pending:tx.pending??[]}});
 const ids=data.transactions.map(t=>t.transactionId);
 if(new Set(ids).size!==ids.length)throw Error('Repeated transaction identifier');
 return data;
}

export class TbcMockAdapter extends BankAdapter {
 constructor(transport){super();this.transport=transport;this.version=TBC_MOCK_VERSION;this.authorization='TBC independent mock documentation-session simulation';}
 map(operation,body){return mapTbcMock(operation,body);}
 capabilities(){return {accounts:true,balances:true,transactions:true,consent:true,payments:false,synthetic:true,authorization:'mock_docs_session',adapterVersion:this.version};}
 async createConsent(){
  // A unique browserId avoids sharing/revoking another user's demo session.
  const data=requireResponse(await this.transport.request('/mock/docs/session',{method:'POST',body:{browserId:crypto.randomUUID(),family:'ais',version:'v1',force:true},sensitive:true}));
  const upstreamId=identifier(data.consentId),expiry=typeof data.expiresAt==='number'?data.expiresAt:Date.parse(data.expiresAt);
  if(!/^[A-Za-z0-9._~-]+$/.test(upstreamId))throw Error('Invalid mock consent header identifier');
  if(data.synthetic!==true||typeof data.accessToken!=='string'||!/^[A-Za-z0-9._~-]{1,2048}$/.test(data.accessToken)||!Number.isFinite(expiry)||expiry<=Date.now())throw Error('Invalid synthetic TBC session');
  return {upstreamId,token:data.accessToken,expiresAt:Math.min(expiry,Date.now()+900000)};
 }
 async completeAuthorization(consent){return consent;}
 async consentStatus(consent){const body=requireResponse(await this.transport.request(prefix+'/consents/'+encodeURIComponent(consent.upstreamId)+'/status'));return {...body,validUntil:new Date(consent.expiresAt).toISOString()};}
 async revokeConsent(consent){requireResponse(await this.transport.request(prefix+'/consents/'+encodeURIComponent(consent.upstreamId),{method:'DELETE'}),204);}
 listAccounts(consent,kind='positive'){return this.transport.request(prefix+'/accounts?withBalance=true',{token:consent.token,consentId:consent.upstreamId,operation:'accounts',kind});}
 getBalances(consent,account){return this.transport.request(prefix+'/accounts/'+encodeURIComponent(identifier(account))+'/balances',{token:consent.token,consentId:consent.upstreamId,operation:'balances',kind:'positive'});}
 async listTransactions(consent,account){
  const path=prefix+'/accounts/'+encodeURIComponent(identifier(account))+'/transactions';
  let next=path;const visited=new Set(),ids=new Set(),booked=[],pending=[];
  for(let page=0;page<20;page++){
   if(visited.has(next))throw Error('Repeated transaction page');visited.add(next);
   const body=requireResponse(await this.transport.request(next,{token:consent.token,consentId:consent.upstreamId,operation:'transactions',kind:'positive'}));
   const mapped=this.map('transactions',body);
   for(const t of mapped.transactions){if(ids.has(t.transactionId))throw Error('Repeated transaction across pages');ids.add(t.transactionId);}
   if(ids.size>1000)throw Error('Transaction budget exceeded');
   booked.push(...(body.transactions.booked??[]));pending.push(...(body.transactions.pending??[]));
   const nextLink=body.transactions._links?.next??body._links?.next;
   if(nextLink!==undefined&&nextLink!==null&&(typeof nextLink!=='object'||typeof nextLink.href!=='string'))throw Error('Invalid next-page link');
   const link=nextLink?.href;
   if(link===undefined||link===null)return {data:this.map('transactions',{transactions:{booked,pending}}),pages:page+1};
   if(typeof link!=='string'||!link)throw Error('Invalid next-page link');
   const url=new URL(link,this.transport.origin+next);
   if(url.origin!==this.transport.origin||url.pathname!==path||url.username||url.password||url.hash)throw Error('Transaction next link left its account scope');
   next=url.pathname+url.search;
  }
  throw Error('Transaction page limit exceeded');
 }
}
