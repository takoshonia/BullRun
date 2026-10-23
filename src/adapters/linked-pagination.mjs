import {requireResponse} from './http-transport.mjs';

// Shared safety limits; each adapter retains its own wire format and page semantics.
export async function collectLinkedTransactions({transport,consent,path,query='',map,validatePage=()=>{}}){
 let next=path+query;
 const visited=new Set(),ids=new Set(),booked=[],pending=[];
 for(let page=0;page<20;page++){
  if(visited.has(next))throw Error('Repeated transaction page');visited.add(next);
  const body=requireResponse(await transport.request(next,{token:consent.token,consentId:consent.upstreamId,operation:'transactions',kind:'positive'}));
  const mapped=map('transactions',body);
  for(const t of mapped.transactions){if(ids.has(t.transactionId))throw Error('Repeated transaction across pages');ids.add(t.transactionId);}
  if(ids.size>1000)throw Error('Transaction budget exceeded');
  booked.push(...(body.transactions.booked??[]));pending.push(...(body.transactions.pending??[]));
  const nested=body.transactions._links?.next,outer=body._links?.next;
  if(nested!=null&&outer!=null&&nested.href!==outer.href)throw Error('Conflicting next-page links');
  const nextLink=nested??outer;
  if(nextLink!=null&&(typeof nextLink!=='object'||typeof nextLink.href!=='string'||!nextLink.href))throw Error('Invalid next-page link');
  let nextUrl;
  if(nextLink!=null){
   nextUrl=new URL(nextLink.href,transport.origin+next);
   if(nextUrl.origin!==transport.origin||nextUrl.pathname!==path||nextUrl.username||nextUrl.password||nextUrl.hash)throw Error('Transaction next link left its account scope');
  }
  validatePage({body,page:page+1,count:ids.size,nextUrl});
  if(!nextUrl)return {data:map('transactions',{transactions:{booked,pending}}),pages:page+1};
  next=nextUrl.pathname+nextUrl.search;
 }
 throw Error('Transaction page limit exceeded');
}
