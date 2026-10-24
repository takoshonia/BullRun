import {sha,validateTarget} from './security.mjs';

export class ProviderFailure extends Error{constructor(reason,until=0){super(reason);this.reason=reason;this.until=until}}
const error=reason=>{throw new ProviderFailure(reason)};
const defaultOrigins={openai:'https://api.openai.com/v1',grok:'https://api.x.ai/v1',claude:'https://api.anthropic.com/v1',gemini:'https://generativelanguage.googleapis.com/v1beta'};
async function boundedJson(response,signal){
 const reader=response.body.getReader();let size=0,body='';const decoder=new TextDecoder();
 try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>300000)throw Error('Response too large');body+=decoder.decode(value,{stream:true})}body+=decoder.decode();return JSON.parse(body)}finally{await reader.cancel().catch(()=>{})}
}
export async function requestStructured(connection,{instructions,input,schema,signal,fetchImpl=fetch,now=Date.now}){
 const c=connection,base=c.baseUrl||defaultOrigins[c.provider];let url,body,headers={'Content-Type':'application/json'};
 if(c.provider==='compatible'){const endpoint=new URL(base);await validateTarget(base,[endpoint.hostname])}
 if(c.provider==='openai'){
  url=base+'/responses';headers.Authorization='Bearer '+c.key;body={model:c.model,store:false,instructions,input,text:{format:{type:'json_schema',name:'audit_explanations',strict:true,schema}},max_output_tokens:8000};
 }else if(c.provider==='grok'||c.provider==='compatible'){
  url=base+'/chat/completions';headers.Authorization='Bearer '+c.key;body={model:c.model,messages:[{role:'system',content:instructions},{role:'user',content:input}],response_format:{type:'json_schema',json_schema:{name:'audit_explanations',strict:true,schema}},max_tokens:8000};
 }else if(c.provider==='claude'){
  url=base+'/messages';headers['x-api-key']=c.key;headers['anthropic-version']='2023-06-01';body={model:c.model,max_tokens:8000,system:instructions,messages:[{role:'user',content:input}],output_config:{format:{type:'json_schema',schema}}};
 }else if(c.provider==='gemini'){
  url=base+'/models/'+encodeURIComponent(c.model.replace(/^models\//,''))+':generateContent';headers['x-goog-api-key']=c.key;body={systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{maxOutputTokens:8000,responseFormat:{text:{mimeType:'APPLICATION_JSON',schema}}}};
 }else error('unsupported_provider');
 const response=await fetchImpl(url,{method:'POST',signal,redirect:'error',headers,body:JSON.stringify(body)});
 let data;try{data=await boundedJson(response,signal)}catch{if(response.ok)error('invalid_response');data={}}
 if(!response.ok){
  const code=[data.error?.code,data.error?.type,data.error?.status].filter(Boolean).join(' ');
  const retry=response.headers.get('retry-after');let until=now()+60000;
  if(retry){const seconds=Number(retry);until=Number.isFinite(seconds)?now()+Math.max(0,seconds)*1000:Date.parse(retry)||until}
  if(response.status===401||response.status===403)throw new ProviderFailure('authentication_failed',now()+3600000);
  if(response.status===429||response.status===402){const quota=/quota|credit|billing|spend|usage_limit/i.test(code)||response.status===402;throw new ProviderFailure(quota?'quota_exhausted':'rate_limited',Math.max(until,now()+(quota?3600000:5000)))}
  throw new ProviderFailure(response.status>=500?'provider_unavailable':'provider_rejected',Math.max(until,now()+60000));
 }
 let text;
 if(c.provider==='openai'){if(data.status!=='completed')error('incomplete_response');const content=(data.output||[]).flatMap(o=>o.content||[]);if(content.some(o=>o.type==='refusal'))error('provider_refusal');text=content.filter(o=>o.type==='output_text').map(o=>o.text).join('')}
 else if(c.provider==='claude'){if(data.stop_reason==='refusal')error('provider_refusal');if(data.stop_reason!=='end_turn')error('incomplete_response');text=(data.content||[]).filter(o=>o.type==='text').map(o=>o.text).join('')}
 else if(c.provider==='gemini'){if(data.promptFeedback?.blockReason)error('provider_refusal');const candidate=data.candidates?.[0];if(candidate?.finishReason!=='STOP')error('incomplete_response');text=(candidate.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('')}
 else{const choice=data.choices?.[0];if(choice?.message?.refusal)error('provider_refusal');if(choice?.finish_reason!=='stop')error('incomplete_response');text=choice.message?.content}
 try{return JSON.parse(text)}catch{error('invalid_response')}
}

export function createProviderRouter({db=null,now=Date.now,attemptTimeoutMs=10000}={}){
 const memory=new Map();
 if(db)db.exec('CREATE TABLE IF NOT EXISTS ai_provider_cooldowns(id TEXT PRIMARY KEY,until INTEGER NOT NULL,reason TEXT NOT NULL)');
 const read=id=>db?db.prepare('SELECT until,reason FROM ai_provider_cooldowns WHERE id=?').get(id):memory.get(id);
 const write=(id,until,reason)=>{if(db)db.prepare('INSERT INTO ai_provider_cooldowns VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET until=MAX(ai_provider_cooldowns.until,excluded.until),reason=excluded.reason').run(id,until,reason);else memory.set(id,{until:Math.max(memory.get(id)?.until||0,until),reason})};
 const credentialId=c=>'key-'+sha([c.id,c.provider,c.baseUrl,c.key,c.model]);
 const quotaId=c=>'quota-'+sha([c.provider,c.quotaGroup||c.provider]);
 const rateId=c=>'rate-'+sha([c.provider,c.quotaGroup||c.provider,c.model]);
 return {async generate({connections,instructions,input,schema,validate,signal,fetchImpl=fetch,attemptBudget={remaining:10}}){
  const attempts=[];
  for(const c of connections){
   signal.throwIfAborted();
   const paused=[credentialId(c),quotaId(c),rateId(c)].map(read).find(s=>s?.until>now());
   if(paused){attempts.push({connectionId:c.id,provider:c.provider,reason:paused.reason,retryAt:new Date(paused.until).toISOString(),skipped:true});continue}
   if(attemptBudget.remaining<=0)break;attemptBudget.remaining--;
   const attemptSignal=AbortSignal.any([signal,AbortSignal.timeout(attemptTimeoutMs)]);
   try{const value=await requestStructured(c,{instructions,input,schema,signal:attemptSignal,fetchImpl,now});const checked=validate(value);return {value:checked,provider:c.provider,model:c.model,connectionId:c.id,attempts}}
   catch(e){const reason=e instanceof ProviderFailure?e.reason:attemptSignal.aborted?'timeout':'validation_or_transport_failed';const until=e.until||now()+30000;const id=reason==='quota_exhausted'?quotaId(c):reason==='rate_limited'?rateId(c):credentialId(c);write(id,until,reason);attempts.push({connectionId:c.id,provider:c.provider,reason,retryAt:new Date(until).toISOString(),skipped:false})}
  }
  const failure=new ProviderFailure('providers_unavailable');failure.attempts=attempts;throw failure;
 }};
}
export const defaultProviderRouter=createProviderRouter();
