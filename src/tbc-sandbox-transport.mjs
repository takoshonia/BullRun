import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:https';
import tls from 'node:tls';
import {validateTarget} from './security.mjs';
import {signTbcRequest,verifyTbcResponse} from './tbc-jws.mjs';

export const TBC_SANDBOX_HOSTS=['test-api.tbcbank.ge','test-openbanking.tbcbank.ge'];
export class TbcSandboxTransport {
 constructor(config){
  this.config=config;
  this.passphrase=fs.readFileSync(config.passwordFile,'utf8').replace(/[\r\n]+$/,'');
  this.pfx=fs.readFileSync(config.qwacFile);this.certificate=fs.readFileSync(config.qsealCertificateFile);
  this.key=crypto.createPrivateKey({key:fs.readFileSync(config.qsealKeyFile),passphrase:this.passphrase});
  this.roots=config.signingCaFile?[fs.readFileSync(config.signingCaFile)]:[];
  // Trust additions apply only to this sandbox client, never the whole process.
  this.tlsCa=config.tlsCaFile?[...tls.rootCertificates,fs.readFileSync(config.tlsCaFile)]:undefined;
  if(!new crypto.X509Certificate(this.certificate).checkPrivateKey(this.key))throw Error('QSEAL certificate/key mismatch');
  this.cooldownUntil=0;
 }
 async request(target,{method='GET',body,form,token,consentId,psuIp,redirectUri,verify=true,diagnostic=false}={}){
  if(this.cooldownUntil>Date.now())throw Error('TBC request cooldown active');
  const {url,addresses}=await validateTarget(target,TBC_SANDBOX_HOSTS);
  const raw=Buffer.from(form?new URLSearchParams(form).toString():body===undefined?'':JSON.stringify(body));
  const requestId=crypto.randomUUID();
  let headers={accept:'application/json','x-request-id':requestId,...(raw.length?{'content-type':form?'application/x-www-form-urlencoded':'application/json','content-length':String(raw.length)}:{}),...(token?{authorization:'Bearer '+token}:{}),...(consentId?{'consent-id':consentId}:{}),...(psuIp?{'psu-ip-address':psuIp}:{})};
  if(redirectUri){const redirect=new URL(redirectUri);if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash)throw Error('Invalid TBC redirect URI');headers['tpp-redirect-uri']=redirect.href;}
  headers=signTbcRequest({method,url,headers,body:raw,key:this.key,certificate:this.certificate});
  const start=Date.now();
  const response=await new Promise((resolve,reject)=>{
   let timer,settled=false;
   const fail=message=>{if(settled)return;settled=true;clearTimeout(timer);req.destroy();reject(Error(message));};
   const lookup=(hostname,options,callback)=>{if(hostname!==url.hostname)return callback(Error('TBC hostname changed'));if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family)};
   const req=https.request(url,{method,headers,pfx:this.pfx,passphrase:this.passphrase,ca:this.tlsCa,lookup,rejectUnauthorized:true},res=>{
    const chunks=[];let size=0;const tlsVerified=res.socket.authorized;
    res.on('data',chunk=>{size+=chunk.length;if(size>2_000_000)fail('TBC response size exceeded');else chunks.push(chunk)});
    res.on('error',()=>fail('TBC response interrupted'));
    res.on('end',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve({status:res.statusCode,headers:res.headers,raw:Buffer.concat(chunks),tlsVerified,requestId,durationMs:Date.now()-start})});
   });
   timer=setTimeout(()=>fail('TBC request deadline exceeded'),15000);
   req.on('error',e=>fail('TBC network/TLS failure: '+(e.code||'CONNECTION_ERROR')));req.end(raw);
  });
  if(!response.tlsVerified)throw Error('TBC TLS validation failed');
  if(response.status===429)this.cooldownUntil=Date.now()+Math.min(3600,Math.max(60,Number(response.headers['retry-after'])||60))*1000;
  response.proof=verify?verifyTbcResponse({status:response.status,headers:response.headers,body:response.raw,requestId,rootCertificates:this.roots,issuerAnchor:this.certificate,expectedSignerOrganization:'PSDGE-NBG-TBCBGE22',requireTrust:!diagnostic}):null;
  try{response.body=JSON.parse(response.raw.toString('utf8'))}catch{throw Error('TBC returned a non-JSON response')}
  return response;
 }
}
