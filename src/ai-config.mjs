import fs from 'node:fs';
import {sha} from './security.mjs';
import {parseEnv} from 'node:util';

export const AI_PROVIDERS=['openai','gemini','claude','grok','compatible'];
const keyProviders={OPENAI:'openai',GOOGLE:'gemini',GEMINI:'gemini',ANTHROPIC:'claude',CLAUDE:'claude',XAI:'grok',GROK:'grok'};
const modelNames={openai:['OPENAI_MODEL'],gemini:['GEMINI_MODEL','GOOGLE_MODEL'],claude:['CLAUDE_MODEL','ANTHROPIC_MODEL'],grok:['GROK_MODEL','XAI_MODEL']};
function envFileConfig(filename){
 if(fs.statSync(filename).size>1000000)throw Error('Credential file too large');
 const text=fs.readFileSync(filename,'utf8'),values=parseEnv(text),connections=[],warnings=[],seen=new Set();
 const orderedNames=[...new Set([...text.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm)].map(m=>m[1]))];
 for(const name of orderedNames){
  const key=values[name];
  const match=name.match(/^(OPENAI|GOOGLE|GEMINI|ANTHROPIC|CLAUDE|XAI|GROK)_API_KEY(?:_(\d+))?$/);
  if(!match||typeof key!=='string'||!key.trim())continue;
  const provider=keyProviders[match[1]],suffix=match[2]?'_'+match[2]:'';
  const names=modelNames[provider],model=names.map(n=>values[n+suffix]).find(Boolean)||names.map(n=>values[n]).find(Boolean);
  if(!model||model.length>200||/[\s\u0000-\u001f]/.test(model)){warnings.push('Set '+names[0]+' for '+name);continue}
  if(/[\s\u0000-\u001f]/.test(key)){warnings.push('Invalid key formatting in '+name);continue}
  const identity=sha([provider,model,key]);if(seen.has(identity))continue;seen.add(identity);
  const quotaGroup=values[match[1]+'_QUOTA_GROUP'+suffix]||values[match[1]+'_QUOTA_GROUP']||provider;
  connections.push({id:'env-'+name.toLowerCase(),provider,model,key,quotaGroup});
 }
 return {key:'',model:'env-pool-'+sha(connections.map(c=>({...c,key:sha(c.key)}))).slice(0,24),connections,configured:connections.length>0,warnings};
}
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
 if(env.GEOBRIDGE_AI_ENV_FILE&&fs.existsSync(env.GEOBRIDGE_AI_ENV_FILE)){try{return envFileConfig(env.GEOBRIDGE_AI_ENV_FILE)}catch{return {key:'',model:'invalid-env-file',connections:[],configured:false,warnings:['Private AI credential file could not be parsed']}}}
 if(env.GEOBRIDGE_AI_POOL_FILE&&fs.existsSync(env.GEOBRIDGE_AI_POOL_FILE)){try{return poolConfig(env.GEOBRIDGE_AI_POOL_FILE,env)}catch{return {key:'',model:'invalid-pool',connections:[],configured:false}}}
 let key=env.GEOBRIDGE_AI_KEY||'',model=env.GEOBRIDGE_AI_MODEL||'';
 try{if(!key&&env.GEOBRIDGE_AI_KEY_FILE)key=fs.readFileSync(env.GEOBRIDGE_AI_KEY_FILE,'utf8').trim()}catch{key=''}
 try{if(!model&&env.GEOBRIDGE_AI_MODEL_FILE)model=fs.readFileSync(env.GEOBRIDGE_AI_MODEL_FILE,'utf8').trim()}catch{model=''}
 return {key,model,configured:!!key&&!!model,connections:key&&model?[{id:'legacy-openai',provider:'openai',model,key,quotaGroup:'openai'}]:[]};
}
