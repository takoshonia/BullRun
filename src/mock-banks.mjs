// Unofficial synthetic banks. The private HTTP listener is separate from the app listener.
import http from 'node:http';
import crypto from 'node:crypto';
import {all,get,put} from './store.mjs';
import {normalize,sha} from './security.mjs';
export const MOCKS=['mock-tbc','mock-bog'];
export const SCENARIOS={healthy:'Healthy responses',missing_currency:'Missing account currency',outage:'Service outage',slow:'Response exceeds timeout'};
export const isMock=c=>!!c&&MOCKS.includes(c.id)&&c.adapter==='geobridge-mock-v1';
const accountId=bank=>bank+'-savings-001';
const err=(status,message)=>Object.assign(Error(message),{status});
const selected=['AIS-RESOURCE','AIS-CURRENCY','AIS-OWNER','AIS-DETAILS','AIS-TYPE','AIS-BIC','AIS-NO-INLINE','COMMON-JSON','COMMON-REQUEST-ID','COMMON-TYPE','DOM-DEPOSIT'];
export function seedMocks(){for(const id of MOCKS){if(!get('specs',id)){const spec=mockSpecification(id);put('specs',{id,tenant:'bank-demo',spec,sha256:sha(spec),uploadedAt:new Date().toISOString()});}if(get('connections',id))continue;put('connections',{id,name:id==='mock-tbc'?'TBC-style mock':'BOG-style mock',tenant:'bank-demo',profile:'ofa-ais',status:'mock_connected',environment:'synthetic_mock',synthetic:true,unofficial:true,adapter:'geobridge-mock-v1',scenario:id==='mock-bog'?'missing_currency':'healthy',capabilities:{accounts:'mock_supported',balances:'mock_supported',transactions:'mock_supported'},createdAt:new Date().toISOString(),specHash:sha(mockSpecification(id))});}}
export function mockSpecification(bank){
 const response={description:'Synthetic JSON response',content:{'application/json':{schema:{type:'object',properties:{accounts:{type:'array',items:{type:'object',required:['resourceId','currency','bic','cashAccountType'],properties:{resourceId:{type:'string'},currency:{type:'string',pattern:'^[A-Z]{3}$'},bic:{type:'string'},cashAccountType:{type:'string',enum:['SVGS']}}}}}}}}};
 const paths={};for(const route of ['/accounts','/accounts/{accountId}/balances','/accounts/{accountId}/transactions'])paths['/mock-ais/v1'+route]={get:{parameters:[{name:'X-Request-ID',in:'header',required:true,schema:{type:'string',format:'uuid'}},{name:'Consent-ID',in:'header',required:true,schema:{type:'string'}},...(route.includes('{accountId}')?[{name:'accountId',in:'path',required:true,schema:{type:'string'}}]:[])],responses:{200:route==='/accounts'?response:{description:'Synthetic '+(route.endsWith('balances')?'balance':'transaction')+' JSON',content:{'application/json':{schema:{type:'object'}}}},403:{description:'Consent denied'}}}};
 return {openapi:'3.0.3',info:{title:(bank==='mock-tbc'?'TBC':'BOG')+'-style UNOFFICIAL MOCK',version:'1.0.0',description:'Synthetic demo contract. Not an official bank specification. BOG-style transaction entries use an explicit adapter.'},paths};
}
export function createMockConsent(bank,owner){if(!MOCKS.includes(bank))throw err(404,'Unknown mock bank');const consent={id:crypto.randomUUID(),bank,owner,status:'valid',expiresAt:Date.now()+15*60000,accounts:[accountId(bank)],synthetic:true};put('mock_consents',consent);return consent;}
export function revokeMockConsent(id,owner,bank){const c=get('mock_consents',id);if(!c||c.owner!==owner||c.bank!==bank)throw err(404,'Consent not found');put('mock_consents',{...c,status:'revoked'});}
export function setScenario(id,scenario){const c=get('connections',id);if(!isMock(c))throw err(404,'Mock not found');if(!Object.hasOwn(SCENARIOS,scenario))throw err(400,'Unknown scenario');put('connections',{...c,scenario});return {...c,scenario};}
function wireResponse(bank,operation,scenario){
 const bog=bank==='mock-bog';
 if(operation==='accounts'){const a={resourceId:accountId(bank),currency:'GEL',cashAccountType:'SVGS',bic:bog?'BAGAGE22':'TBCBGE22',status:'enabled',[bog?'displayName':'name']:bog?'Synthetic savings B':'Synthetic savings A'};if(scenario==='missing_currency')delete a.currency;return {accounts:[a]};}
 if(operation==='balances')return {balances:[{balanceAmount:{amount:bog?'950.25':'1250.50',currency:'GEL'},balanceType:'interimAvailable',referenceDate:'2026-10-22'},{balanceAmount:{amount:bog?'980.25':'1300.50',currency:'GEL'},balanceType:'interimBooked',referenceDate:'2026-10-22'}]};
 const transaction=(id,amount)=>({transactionId:bank+'-'+id,transactionAmount:{amount,currency:'GEL'},bookingDate:'2026-10-22',valueDate:'2026-10-22'});
 return bog?{entries:[{...transaction('001','-30.00'),bookingStatus:'BOOKED'},{...transaction('002','-10.00'),bookingStatus:'PENDING'}]}:{transactions:{booked:[transaction('001','-50.00')],pending:[transaction('002','-10.00')]}};
}
export function adaptMock(bank,operation,body){
 if(bank==='mock-bog'&&operation==='transactions'){
  if(!Array.isArray(body.entries)||body.entries.some(x=>!['BOOKED','PENDING'].includes(x.bookingStatus)))throw Error('Unknown BOG-style mock booking status; adapter refuses to guess');
  body={transactions:{booked:body.entries.filter(x=>x.bookingStatus==='BOOKED'),pending:body.entries.filter(x=>x.bookingStatus==='PENDING')}};
 }
 return normalize(operation,body);
}
export async function startMockService(){
 const key=crypto.randomBytes(32).toString('hex');
 const server=http.createServer(async(req,res)=>{
  const reply=(status,body)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
   if(req.headers['x-mock-service-key']!==key)throw err(401,'Private mock service');
   const m=new URL(req.url,'http://mock.local').pathname.match(/^\/(mock-tbc|mock-bog)\/mock-ais\/v1\/accounts(?:\/([^/]+)\/(balances|transactions))?$/);if(!m||req.method!=='GET')throw err(404,'Mock endpoint not found');
   const [,bank,account,op='accounts']=m,c=get('connections',bank);if(!isMock(c))throw err(404,'Mock not enabled');
   const consent=get('mock_consents',req.headers['consent-id']);
   if(!consent||consent.bank!==bank||consent.owner!==req.headers['x-mock-owner']||consent.status!=='valid'||consent.expiresAt<=Date.now())throw err(403,'CONSENT_INVALID');
   if(account&&!consent.accounts.includes(account))throw err(403,'ACCOUNT_NOT_CONSENTED');
   if(!/^[0-9a-f-]{36}$/i.test(req.headers['x-request-id']||''))throw err(400,'REQUEST_ID_INVALID');
   const scenario=req.headers['x-mock-scenario']||c.scenario;
   if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,600));
   if(scenario==='outage')return reply(503,{type:'urn:geobridge:synthetic:unavailable',title:'Synthetic outage'});
   reply(200,wireResponse(bank,op,scenario));
  }catch(e){reply(e.status||500,{type:'urn:geobridge:synthetic:error',title:e.status?e.message:'Mock error'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 process.env.GEOBRIDGE_MOCK_ORIGIN=`http://127.0.0.1:${server.address().port}`;process.env.GEOBRIDGE_MOCK_KEY=key;
 server.unref();return server;
}
export async function mockRequest(bank,operation,{owner,consentId,account,scenario,timeoutMs=250}={}){
 if(!MOCKS.includes(bank)||!['accounts','balances','transactions'].includes(operation))throw err(400,'Unsupported mock request');
 const base=process.env.GEOBRIDGE_MOCK_ORIGIN;if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base||'')||!process.env.GEOBRIDGE_MOCK_KEY)throw err(503,'Mock runtime unavailable');
 const requestId=crypto.randomUUID(),started=performance.now(),timestamp=new Date().toISOString();
 const suffix=operation==='accounts'?'/accounts':`/accounts/${encodeURIComponent(account||accountId(bank))}/${operation}`;
 try{
  const r=await fetch(base+'/'+bank+'/mock-ais/v1'+suffix,{headers:{'X-Mock-Service-Key':process.env.GEOBRIDGE_MOCK_KEY,'Consent-ID':consentId||'','X-Mock-Owner':owner||'','X-Request-ID':requestId,...(scenario?{'X-Mock-Scenario':scenario}:{})},signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
  const body=await r.json();return {operation,status:r.status,body,contentType:r.headers.get('content-type'),requestId,timestamp,durationMs:performance.now()-started,outcome:r.ok?'success':r.status===429?'rate_limited':'error',accountCategory:'SVGS'};
 }catch(e){return {operation,status:0,body:{},requestId,timestamp,durationMs:performance.now()-started,outcome:e.name==='TimeoutError'?'timeout':'error',transportError:e.name==='TimeoutError'?'Request exceeded 250 ms mock deadline':'Mock transport unavailable'};}
}
export async function collectMockEvidence(run){
 const c=get('connections',run.connectionId);if(!isMock(c))throw Error('Not a configured mock');
 const scenario=run.scenario||c.scenario,consent=createMockConsent(c.id,run.actor),observations=[],samples=[];
 try{
  for(const operation of ['accounts','balances','transactions'])for(let n=0;n<(run.sampleCount||5);n++){
   const o=await mockRequest(c.id,operation,{owner:run.actor,consentId:consent.id,scenario});
   samples.push({operation,kind:'positive',outcome:o.outcome,durationMs:o.durationMs,timestamp:o.timestamp});
   if(n===0)observations.push(o);
  }
  // Negative lifecycle probes are measured, but excluded from positive reliability.
  const invalid=await mockRequest(c.id,'accounts',{owner:run.actor,consentId:'invalid',scenario:'healthy'});
  revokeMockConsent(consent.id,run.actor,c.id);
  const revoked=await mockRequest(c.id,'accounts',{owner:run.actor,consentId:consent.id,scenario:'healthy'});
  for(const o of [invalid,revoked])samples.push({operation:'consent',kind:'negative',outcome:o.outcome,durationMs:o.durationMs,timestamp:o.timestamp});
  return {id:crypto.randomUUID(),tenant:c.tenant,name:c.name+' measured HTTP capture',synthetic:true,mode:'mock_http',profile:c.profile,connectionId:c.id,scenario,observations,samples,environment:'Same-host loopback mock APIs',captureMethod:'GeoBridge worker issued authenticated HTTP requests to private mock service',selectedRuleIds:selected,lifecycle:{invalidDenied:invalid.status===403,revokedDenied:revoked.status===403},createdAt:new Date().toISOString()};
 }finally{const current=get('mock_consents',consent.id);if(current?.status==='valid')revokeMockConsent(consent.id,run.actor,c.id);}
}
