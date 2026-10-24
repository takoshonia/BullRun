import fs from 'node:fs';
import {sha} from './security.mjs';

// Pin the actual definition bytes, rather than claiming these are bank standards.
const definitions=new Map();
export function checkSource(file,locator,label='GeoBridge check definition'){
 if(!definitions.has(file))definitions.set(file,sha(fs.readFileSync(new URL(file,import.meta.url),'utf8')));
 return {source:file,section:locator,sourceHash:definitions.get(file),sourceType:'internal_check',sourceLabel:label};
}
const pointer=s=>s.replaceAll('~','~0').replaceAll('/','~1');
export function adapterSource(adapter){
 const file='adapters/'+(adapter==='gringott-mock-v1'?'gringott':adapter.replace('-v1',''))+'.mjs';
 return {type:'implementation',document:file,...checkSource(file,'adapter implementation')};
}
export function mockSource(adapter,key,spec){
 const family=key.startsWith('BALANCES-')?'BALANCES':key.startsWith('PAGINATION-')?'PAGINATION':key;
 const definition=checkSource('adapters/mock-audit.mjs',family,'GeoBridge synthetic mock check');
 const references=[adapterSource(adapter)];
 if(!spec)return {...definition,sourceReferences:references,sourceAvailability:'Mock OpenAPI contract was not captured'};
 const routes={AUTH:/\/accounts\/?$/, 'ERROR-SHAPE':/\/accounts\/?$/, ACCOUNTS:/\/accounts\/?$/, 'UNKNOWN-ACCOUNT':/\/accounts\/\{[^}]+\}\/?$/, BALANCES:/\/balances\/?$/, PAGINATION:/\/transactions\/?$/, CONSENT:/\/consents(?:\/|$)/,REVOKED:/\/consents(?:\/|$)/,CLEANUP:/\/consents(?:\/|$)/};
 const matches=Object.entries(spec.paths||{}).filter(([route])=>routes[family]?.test(route));
 for(const [route,path] of matches)for(const method of ['get','post','delete','put','patch'])if(path[method])references.push({type:'mock_contract',document:'Captured mock /openapi.json',version:spec.info?.version||null,hash:sha(spec),locator:'#/paths/'+pointer(route)+'/'+method,operation:method.toUpperCase()+' '+route});
 if(!matches.length)references.push({type:'mock_contract',document:'Captured mock /openapi.json',version:spec.info?.version||null,hash:sha(spec),locator:'#',note:'No matching operation locator recorded; check behavior is defined by GeoBridge.'});
 return {...definition,sourceReferences:references};
}
