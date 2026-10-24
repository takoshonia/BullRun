import crypto from 'node:crypto';
import {createAdapter,adapterTargets} from './registry.mjs';
import {requireResponse} from './http-transport.mjs';

const error=(status,message)=>Object.assign(Error(message),{status});

// Ephemeral, owner-scoped mock credentials. Restart requires fresh simulated consent.
// No token/code is persisted in SQLite or returned to a browser.
export function createCommonAIS({processResponse=(cid,op,body)=>({body,proof:null})}={}){
 const sessions=new Map(),pendingOwners=new Map();let pending=0;
 const prune=()=>{for(const [id,s]of sessions)if(s.expiresAt<=Date.now())sessions.delete(id);};
 function adapter(id){if(!adapterTargets().some(t=>t.id===id))throw error(503,'BANK_NOT_CONNECTED');return createAdapter(id,{signal:AbortSignal.timeout(15000)});}
 function session(user,connection,id){prune();const s=sessions.get(id);if(!s||s.owner!==user.id||s.tenant!==user.tenant||s.connection!==connection)throw error(403,'Consent missing, expired, revoked or outside your scope');return s;}
 return {
  async connect(user,connection){
   prune();if(sessions.size+pending>=500||[...sessions.values()].filter(s=>s.owner===user.id).length+(pendingOwners.get(user.id)||0)>=10)throw error(429,'Too many active mock consents');
   const a=adapter(connection);pending++;pendingOwners.set(user.id,(pendingOwners.get(user.id)||0)+1);let upstream;
   try{
    upstream=await a.createConsent();upstream=await a.completeAuthorization(upstream);
    const accounts=a.map('accounts',requireResponse(await a.listAccounts(upstream))).accounts;
    if(accounts.length>10)throw error(422,'Mock account budget exceeded');
    const id=crypto.randomUUID();sessions.set(id,{...upstream,owner:user.id,tenant:user.tenant,connection,accounts:new Set(accounts.map(x=>x.accountId))});
    return {consentId:id,expiresAt:new Date(upstream.expiresAt).toISOString(),accounts,synthetic:true,authorization:a.authorization};
   }catch(e){if(upstream)try{await a.revokeConsent(upstream)}catch{}throw e;}finally{pending--;const count=pendingOwners.get(user.id)-1;if(count)pendingOwners.set(user.id,count);else pendingOwners.delete(user.id);}
  },
  async revoke(user,connection,id){const s=session(user,connection,id);sessions.delete(id);await adapter(connection).revokeConsent(s);return {revoked:true,synthetic:true};},
  async read(user,connection,id,operation,account){
   const s=session(user,connection,id),a=adapter(connection);
   if(account&&!s.accounts.has(account))throw error(403,'Account not included in this consent');
   const current=await a.consentStatus(s);
   if(current.consentStatus!=='valid'||!Number.isFinite(Date.parse(current.validUntil))||Date.parse(current.validUntil)<=Date.now()){sessions.delete(id);throw error(403,'Upstream consent is not valid');}
   let data,proof=null;const mapped=(op,raw)=>{const result=processResponse(connection,op,raw);proof=result.proof;return a.map(op,result.body)};if(operation!=='accounts'&&!account)account=[...s.accounts][0];if(operation!=='accounts'&&!account)throw error(422,'No consented account available');
   if(operation==='accounts')data=mapped('accounts',requireResponse(await a.listAccounts(s)));
   else if(operation==='balances')data=mapped('balances',requireResponse(await a.getBalances(s,account)));
   else if(operation==='transactions')data=(await a.listTransactions(s,account)).data;
   else throw error(404,'Unsupported common operation');
   session(user,connection,id); // Reject a response if local revocation raced the upstream read.
   return {data,proof,meta:{synthetic:true,evidenceMode:'mock_http',connectionId:connection,adapterVersion:a.version,notice:'Synthetic API data; not an official bank observation.'}};
  },
  clearOwner(owner){for(const [id,s]of sessions)if(s.owner===owner)sessions.delete(id);}
 };
}
