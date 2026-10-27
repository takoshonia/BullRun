import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {TbcSandboxTransport} from './tbc-sandbox-transport.mjs';
import {redact} from './security.mjs';

const api='https://test-openbanking.tbcbank.ge/0.8/v1';
const tokenEndpoint='https://test-openbanking.tbcbank.ge/openbanking/oauth/token';
const authorizeEndpoint='https://test-api.tbcbank.ge/psd2/openbanking/oauth/authorize';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const random=()=>crypto.randomBytes(32).toString('base64url');
const fail=(status,message)=>Object.assign(Error(message),{status});
export const TBC_CALLBACK='/api/tbc-sandbox/callback';
export const TBC_COOKIE='geobridge_tbc_oauth';

// Real sandbox grants are deliberately separate from auto-authorized mock AIS.
export function createTbcSandbox({get,put,remove,all,event,sessionValid,origin,config,transport,now=Date.now}){
 if(!config)return {enabled:false,status:()=>({enabled:false})};
 const callback=new URL(TBC_CALLBACK,origin).href;
 if(new URL(origin).protocol!=='https:')throw Error('TBC sandbox requires an HTTPS application origin');
 const key=fs.readFileSync(config.encryptionKeyFile);
 if(key.length!==32)throw Error('TBC encryption key must contain exactly 32 bytes');
 const client=transport||new TbcSandboxTransport(config);
 const seal=(value,aad)=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')}};
 const open=(value,aad)=>{const cipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data,'base64')),cipher.final()]).toString('utf8'))};
 const gate=(user,session)=>{if(user?.role!=='operator'||user.disabled||!sessionValid(session,user.id)||get('demo_access_sessions',session))throw fail(403,'Sign in with the regular operator account to connect the real TBC sandbox')};
 const grantId=user=>'tbc-sandbox:'+user.id;
 const checked=async(target,options)=>{
  let r;try{r=await client.request(target,options)}catch{throw fail(502,'TBC sandbox request or response verification failed. No unverified bank data was accepted.')}
  if(r.status<200||r.status>=300)throw fail(502,'TBC sandbox rejected the request (HTTP '+r.status+').');
  return r;
 };
 let starting=false;
 return {
  enabled:true,
  status(user,session){gate(user,session);const row=get('tbc_sandbox_grants',grantId(user));return {enabled:true,environment:'TBC bank-operated sandbox',connected:!!row&&row.expires>now(),expires:row?.expires||null,callback,clientId:config.clientId};},
  async start(user,session,psuIp){
   gate(user,session);if(starting)throw fail(409,'A TBC connection request is already in progress');
   const pending=all('tbc_sandbox_pending').filter(x=>x.user===user.id&&x.expires>now());
   if(pending.length)throw fail(409,'An authorization is already pending. Finish it or wait ten minutes before reconnecting.');
   for(const row of all('tbc_sandbox_pending'))if(row.expires<=now())remove('tbc_sandbox_pending',row.id);
   starting=true;
   try{
    const r=await checked(api+'/consents',{method:'POST',redirectUri:callback,psuIp,body:{access:{accounts:[],balances:[],transactions:[]},recurringIndicator:true,validUntil:new Date(now()+7*86400000).toISOString().slice(0,10),frequencyPerDay:4,combinedServiceIndicator:false}});
    if(typeof r.body.consentId!=='string'||!r.proof?.signerTrusted)throw fail(502,'TBC did not return a verified consent');
    const state=random(),cookie=random(),verifier=random(),nonce=random(),id=hash(state);
    put('tbc_sandbox_pending',{id,user:user.id,session,cookieHash:hash(cookie),expires:now()+600000,sealed:seal({verifier,nonce,consentId:r.body.consentId},id)});
    const target=new URL(authorizeEndpoint);
    target.search=new URLSearchParams({client_id:config.clientId,scope:'AIS:'+r.body.consentId,response_type:'code',redirect_uri:callback,nonce,state,code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),ui_locales:'ka'}).toString();
    event(user.id,'tbc_sandbox_authorization_started','tbc-sandbox');
    return {authorizationUrl:target.href,cookie};
   }finally{starting=false}
  },
  async callback(params,cookie){
   const state=params.get('state');if(!state||state.length>200||!cookie)throw fail(400,'Invalid TBC authorization state');
   const id=hash(state),row=get('tbc_sandbox_pending',id),user=row&&get('users',row.user);
   if(!row||row.expires<=now()||row.cookieHash!==hash(cookie))throw fail(400,'TBC authorization expired or browser correlation failed. Start again.');
   gate(user,row.session);remove('tbc_sandbox_pending',id); // Consume before network I/O: replay cannot exchange twice.
   const code=params.get('code');if(params.has('error')||!code||code.length>8192)throw fail(400,'TBC authorization was not completed. Start again.');
   const pending=open(row.sealed,id);
   // OAuth token responses use authenticated mTLS, separately from AIS JWS.
   const r=await checked(tokenEndpoint,{method:'POST',form:{grant_type:'authorization_code',code,client_id:config.clientId,redirect_uri:callback,code_verifier:pending.verifier},verify:false});
   gate(get('users',user.id),row.session);
   if(typeof r.body.access_token!=='string'||!r.body.access_token||/[\r\n]/.test(r.body.access_token)||r.body.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(Number(r.body.expires_in))||Number(r.body.expires_in)<=0)throw fail(502,'TBC returned an invalid token response');
   const gid=grantId(user),expires=now()+Math.min(Number(r.body.expires_in),86400)*1000;
   put('tbc_sandbox_grants',{id:gid,user:user.id,expires,sealed:seal({token:r.body.access_token,consentId:pending.consentId},gid)});
   event(user.id,'tbc_sandbox_authorized','tbc-sandbox');
   return {connected:true};
  },
  async accounts(user,session,psuIp){
   gate(user,session);const row=get('tbc_sandbox_grants',grantId(user));
   if(!row||row.expires<=now())throw fail(409,'Connect TBC sandbox first; the authorization is missing or expired');
   const grant=open(row.sealed,row.id),r=await checked(api+'/accounts?withBalance=true',{token:grant.token,consentId:grant.consentId,psuIp});
   gate(get('users',user.id),session);
   if(!Array.isArray(r.body.accounts))throw fail(502,'TBC accounts response has an unexpected format');
   event(user.id,'tbc_sandbox_accounts_read','tbc-sandbox',{count:r.body.accounts.length});
   return {environment:'TBC bank-operated sandbox',data:redact(r.body),proof:r.proof,notice:'Verified sandbox response. This is not a completed compliance audit.'};
  },
  disconnect(user,session){gate(user,session);remove('tbc_sandbox_grants',grantId(user));for(const row of all('tbc_sandbox_pending'))if(row.user===user.id)remove('tbc_sandbox_pending',row.id);event(user.id,'tbc_sandbox_local_disconnect','tbc-sandbox');return {connected:false,notice:'Local access removed. Bank consent has not been revoked.'};}
 };
}

export function tbcSandboxConfig(env=process.env){
 const directory=env.GEOBRIDGE_TBC_SANDBOX_DIR;if(!directory)return null;
 if(!env.GEOBRIDGE_TBC_SANDBOX_CLIENT_ID)throw Error('TBC sandbox client ID is required');
 return {clientId:env.GEOBRIDGE_TBC_SANDBOX_CLIENT_ID,passwordFile:path.join(directory,'certificate-password.txt'),qwacFile:path.join(directory,'PSD2_QWAC.pfx'),qsealCertificateFile:path.join(directory,'qseal-cert.pem'),qsealKeyFile:path.join(directory,'qseal-key.pem'),tlsCaFile:path.join(directory,'gba-sandbox-root.pem'),signingCaFile:path.join(directory,'gba-sandbox-root.pem'),encryptionKeyFile:path.join(directory,'token-encryption.key')};
}
