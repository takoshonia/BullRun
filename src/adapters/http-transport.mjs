import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import {redact} from '../security.mjs';

// Fixed-origin transport. Private HTTP is permitted only by the operator's mock registry.
// No redirects, automatic retries, remote pagination links or arbitrary browser URLs.
export class MockTransport {
 constructor(origin,{timeoutMs=2000,signal,onObservation=()=>{},maxRequests=80}={}){
  this.origin=new URL(origin).origin;this.timeoutMs=timeoutMs;this.signal=signal;
  this.onObservation=onObservation;this.remaining=maxRequests;
 }
 async request(path,{method='GET',body,token,consentId,operation='consent',kind='setup',sensitive=false,maxResponseBytes=1_000_000,responseType='json'}={}){
  if(!['json','text'].includes(responseType)||responseType==='text'&&!sensitive)throw Error('Text responses require sensitive capture suppression');
  if(!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>2_000_000)throw Error('Invalid response size budget');
  if(this.signal?.aborted)throw this.signal.reason;
  if(--this.remaining<0)throw Error('Mock request budget exhausted');
  const url=new URL(path,this.origin);
  if(url.origin!==this.origin||!path.startsWith('/')||path.startsWith('//')||url.username||url.password||path.includes('\\'))throw Error('Adapter request left its configured origin');
  const requestId=crypto.randomUUID(),start=performance.now(),timestamp=new Date().toISOString();
  const response=await new Promise(resolve=>{
   let settled=false,timer;
   const finish=result=>{if(settled)return;settled=true;clearTimeout(timer);this.signal?.removeEventListener('abort',abort);resolve(result);};
   const req=(url.protocol==='https:'?https:http).request(url,{method,headers:{Accept:'application/json','X-Request-ID':requestId,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(consentId?{'Consent-ID':consentId}:{})}},res=>{
    const chunks=[];let bytes=0;
    const headers={'content-type':res.headers['content-type']||'','x-request-id':res.headers['x-request-id']||''};
    res.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>maxResponseBytes){finish({status:res.statusCode,headers,transportError:'RESPONSE_TOO_LARGE'});res.destroy();req.destroy();}else chunks.push(chunk);});
    res.on('end',()=>{const raw=Buffer.concat(chunks);let data;try{data=responseType==='text'?raw.toString('utf8'):JSON.parse(raw.toString('utf8'))}catch{}
     finish({status:res.statusCode,headers,body:data,bodyHash:crypto.createHash('sha256').update(raw).digest('hex'),location:res.headers.location,transportError:data===undefined&&res.statusCode!==204&&res.statusCode!==302?'INVALID_JSON':undefined});
    });
    res.on('error',()=>finish({status:0,headers,transportError:'RESPONSE_INTERRUPTED'}));
   });
   const abort=()=>{finish({status:0,headers:{},transportError:'CANCELLED'});req.destroy();};
   this.signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>{finish({status:0,headers:{},transportError:'TIMEOUT'});req.destroy();},this.timeoutMs);
   req.on('error',()=>finish({status:0,headers:{},transportError:'NETWORK_ERROR'}));
   if(this.signal?.aborted){abort();return;}
   req.end(body?JSON.stringify(body):undefined);
  });
  const observation={operation,kind,method,path:url.pathname,status:response.status,contentType:response.headers['content-type']||'',requestId,responseRequestId:response.headers['x-request-id']||'',timestamp,durationMs:+(performance.now()-start).toFixed(3),transportError:response.transportError||null,bodyHash:sensitive?null:response.bodyHash||null,body:sensitive?{redacted:'Authorization material intentionally omitted'}:redact(response.body??{}),synthetic:true};
  this.onObservation(observation);
  if(this.signal?.aborted)throw this.signal.reason;
  return {...response,observation};
 }
}

export function requireResponse(response,status=200){
 if(response.transportError||response.status!==status)throw Object.assign(Error(response.transportError||'UPSTREAM_HTTP_'+response.status),{upstreamStatus:response.status,observation:response.observation});
 return response.body;
}
