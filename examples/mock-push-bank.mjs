// Synthetic publisher/proxy for a local BOG-style mock. Never point at a real bank.
import http from 'node:http';import https from 'node:https';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
import {webhookSignature} from '../src/contract-webhooks.mjs';
const safeEqual=(a,b)=>typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function balanceSchemaChange(document,enabled=true){
 const doc=structuredClone(document);
 function expand(node,depth=0){if(depth>20)throw Error('Schema reference depth exceeded');if(!node||typeof node!=='object')return node;if(Array.isArray(node))return node.map(x=>expand(x,depth+1));if(node.$ref){if(!node.$ref.startsWith('#/'))throw Error('External refs unsupported');const resolved=node.$ref.slice(2).split('/').reduce((v,k)=>v?.[k.replaceAll('~1','/').replaceAll('~0','~')],doc);if(!resolved)throw Error('Unresolved ref');return expand(resolved,depth+1)}const result=Object.fromEntries(Object.entries(node).map(([k,v])=>[k,expand(v,depth+1)]));if(enabled&&result.properties?.amount&&result.properties?.currency){result.properties.sum=result.properties.amount;delete result.properties.amount;if(result.required)result.required=result.required.map(x=>x==='amount'?'sum':x)}return result}
 for(const [name,item] of Object.entries(doc.paths||{}))if(/\/accounts\/\{[^}]+\}\/balances$/.test(name)){const response=item.get?.responses?.['200'];const schema=response?.content?.['application/json']?.schema;if(schema)response.content['application/json'].schema=expand(schema)}
 return doc;
}
export function createMockPushBank({upstreamOrigin,callbackUrl,connectionId='mock-bog',secret,adminKey,stateFile,clock=Date.now,fetchImpl=fetch}){
 const upstream=new URL(upstreamOrigin),callback=new URL(callbackUrl);if(!['http:','https:'].includes(upstream.protocol)||upstream.pathname!=='/'||upstream.username||upstream.password||upstream.search||upstream.hash)throw Error('Fixed upstream origin required');
 if(!['http:','https:'].includes(callback.protocol)||callback.username||callback.password||callback.hash||callback.search||callback.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(callback.hostname))throw Error('HTTPS webhook URL required except on loopback');
 if(Buffer.byteLength(secret||'')<32||Buffer.byteLength(adminKey||'')<32||safeEqual(secret,adminKey))throw Error('Separate 32-byte signing and administration keys required');
 let state=stateFile&&fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{enabled:false,sequence:0,events:[]},working=false;
 const save=()=>{if(!stateFile)return;fs.mkdirSync(path.dirname(stateFile),{recursive:true});const tmp=stateFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});fs.renameSync(tmp,stateFile)};
 async function deliver(){if(working)return;working=true;try{for(const entry of state.events.filter(x=>x.status==='pending'&&x.nextAttemptAt<=clock())){
  const timestamp=String(Math.floor(clock()/1000)),raw=Buffer.from(JSON.stringify(entry.payload));entry.attempts++;save();
  try{const response=await fetchImpl(callback,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','X-GeoBridge-Timestamp':timestamp,'X-GeoBridge-Event-Id':entry.eventId,'X-GeoBridge-Signature':'sha256='+webhookSignature(secret,timestamp,entry.eventId,raw)},body:raw});await response.body?.cancel();if(response.status!==202)throw Error('Delivery rejected');entry.status='acknowledged';entry.deliveredAt=new Date(clock()).toISOString()}
  catch{entry.status=entry.attempts>=8?'failed':'pending';entry.nextAttemptAt=clock()+Math.min(60000,1000*2**(entry.attempts-1));entry.error='Webhook delivery unavailable or rejected'}save();
 }}finally{working=false}}
 const timer=setInterval(()=>deliver().catch(()=>{}),1000);timer.unref();
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
  try{
   const incoming=new URL(req.url,'http://mock');if(incoming.pathname.startsWith('/__push/')){
    if(!safeEqual(req.headers['x-mock-push-admin-key'],adminKey))return send(403,{error:'Administration denied'});
    if(incoming.pathname==='/__push/admin/state'&&req.method==='GET')return send(200,{enabled:state.enabled,sequence:state.sequence,events:state.events.map(({payload,nextAttemptAt,...e})=>e),synthetic:true});
    if(incoming.pathname!=='/__push/admin/change'||req.method!=='POST')return send(404,{error:'Not found'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)return send(413,{error:'Body too large'})}const value=JSON.parse(raw);if(typeof value.enabled!=='boolean'||Object.keys(value).length!==1)return send(400,{error:'Explicit enabled boolean required'});
    if(state.enabled===value.enabled)return send(200,{changed:false,enabled:state.enabled,synthetic:true});
    if(state.events.filter(e=>e.status==='pending').length>=50)return send(429,{error:'Publisher queue full'});
    state.enabled=value.enabled;state.sequence++;const entry={eventId:crypto.randomUUID(),status:'pending',attempts:0,nextAttemptAt:clock(),createdAt:new Date(clock()).toISOString(),payload:{type:'api.contract.changed',connectionId,revision:(state.enabled?'sum-':'amount-')+state.sequence,synthetic:true}};state.events.push(entry);save();send(202,{changed:true,eventId:entry.eventId,enabled:state.enabled,synthetic:true,notice:'Mock bank changed its response/schema and queued a signed webhook.'});void deliver().catch(()=>{});return;
   }
   if(incoming.pathname.startsWith('/api/admin/'))return send(403,{error:'Upstream administration not exposed'});
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1000000)return send(413,{error:'Request too large'});chunks.push(chunk)}
   const url=new URL(req.url,upstream);if(url.origin!==upstream.origin)return send(400,{error:'Fixed origin required'});
   const headers={...req.headers,'accept-encoding':'identity'};delete headers['x-mock-push-admin-key'];delete headers.connection;delete headers['transfer-encoding'];headers['content-length']=size;
   const reply=await new Promise((resolve,reject)=>{const request=(upstream.protocol==='https:'?https:http).request(url,{method:req.method,headers,timeout:10000},response=>{const data=[];let bytes=0;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>2000000){response.destroy();reject(Error('Response too large'))}else data.push(chunk)});response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(data)}));response.on('error',reject)});request.on('timeout',()=>request.destroy(Error('TIMEOUT')));request.on('error',reject);request.end(Buffer.concat(chunks))});
   let output=reply.body;if(reply.status===200&&(incoming.pathname==='/openapi.json'||state.enabled&&/\/accounts\/[^/]+\/balances$/.test(incoming.pathname))){const data=JSON.parse(output);if(incoming.pathname==='/openapi.json')output=Buffer.from(JSON.stringify(balanceSchemaChange(data,state.enabled)));else{for(const b of data.balances||[])if(b.balanceAmount&&Object.hasOwn(b.balanceAmount,'amount')){b.balanceAmount.sum=b.balanceAmount.amount;delete b.balanceAmount.amount}output=Buffer.from(JSON.stringify(data))}}
   const responseHeaders={...reply.headers,'content-length':output.length,'x-geobridge-synthetic-publisher':'true'};delete responseHeaders['transfer-encoding'];delete responseHeaders.connection;res.writeHead(reply.status,responseHeaders);res.end(output);
  }catch{if(!res.headersSent)send(502,{error:'Synthetic publisher operation failed'});else res.destroy()}
 });
 server.requestTimeout=15000;
 return {server,deliver,view:()=>structuredClone(state),close:async()=>{clearInterval(timer);server.closeAllConnections();if(server.listening)await new Promise(r=>server.close(r))}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=createMockPushBank({upstreamOrigin:process.env.MOCK_PUSH_UPSTREAM,callbackUrl:process.env.MOCK_PUSH_CALLBACK,connectionId:process.env.MOCK_PUSH_CONNECTION_ID||'mock-bog',secret:fs.readFileSync(process.env.MOCK_PUSH_SECRET_FILE,'utf8').trim(),adminKey:fs.readFileSync(process.env.MOCK_PUSH_ADMIN_KEY_FILE,'utf8').trim(),stateFile:process.env.MOCK_PUSH_STATE_FILE});
 app.server.listen(Number(process.env.PORT||4185),'127.0.0.1',()=>console.log('Synthetic bank push publisher running on loopback; real bank webhook support is not implied.'));process.on('SIGTERM',()=>app.close().then(()=>process.exit()));
}
