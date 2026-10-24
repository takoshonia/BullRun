import fs from 'node:fs';
import {sha} from './security.mjs';

export const AI_PROVIDERS=['openai','gemini','claude','grok','compatible'];
function poolConfig(filename,env){
 const data=JSON.parse(fs.readFileSync(filename,'utf8'));if(!Array.isArray(data.connections))throw Error('Invalid provider pool');
 const ids=new Set(),connections=[];
 for(const entry of data.connections){
  if(entry.enabled===false)continue;
  if(!/^[a-z0-9_-]{1,80}$/i.test(entry.id||'')||ids.has(entry.id)||!AI_PROVIDERS.includes(entry.provider)||typeof entry.model!=='string'||!entry.model||entry.model.length>200||/[\s\u0000-\u001f]/.test(entry.model))throw Error('Invalid connection');
  ids.add(entry.id);let key='';try{key=entry.keyEnv?env[entry.keyEnv]||'':fs.readFileSync(entry.keyFile,'utf8').trim()}catch{}
  let baseUrl;if(entry.provider==='compatible'){const url=new URL(entry.baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid compatible endpoint');baseUrl=url.href.replace(/\/$/,'')}
  if(key)connections.push({id:entry.id,provider:entry.provider,model:entry.model,key,quotaGroup:entry.quotaGroup||entry.provider,...(baseUrl?{baseUrl}:{})});
 }
 const model='pool-'+sha(connections.map(c=>({...c,key:sha(c.key)}))).slice(0,24);
 return {key:'',model,connections,configured:connections.length>0};
}

// A mounted secret file can be updated without rebuilding an image or exposing a key in the UI.
export function aiConfig(env=process.env){
 if(env.GEOBRIDGE_AI_POOL_FILE&&fs.existsSync(env.GEOBRIDGE_AI_POOL_FILE)){try{return poolConfig(env.GEOBRIDGE_AI_POOL_FILE,env)}catch{return {key:'',model:'invalid-pool',connections:[],configured:false}}}
 let key=env.GEOBRIDGE_AI_KEY||'',model=env.GEOBRIDGE_AI_MODEL||'';
 try{if(!key&&env.GEOBRIDGE_AI_KEY_FILE)key=fs.readFileSync(env.GEOBRIDGE_AI_KEY_FILE,'utf8').trim()}catch{key=''}
 try{if(!model&&env.GEOBRIDGE_AI_MODEL_FILE)model=fs.readFileSync(env.GEOBRIDGE_AI_MODEL_FILE,'utf8').trim()}catch{model=''}
 return {key,model,configured:!!key&&!!model,connections:key&&model?[{id:'legacy-openai',provider:'openai',model,key,quotaGroup:'openai'}]:[]};
}
