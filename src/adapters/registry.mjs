import {targetTenant} from '../organization-scope.mjs';
import {MockTransport} from './http-transport.mjs';
import {GringottAdapter,GRINGOTT_VERSION} from './gringott.mjs';
import {TbcMockAdapter,TBC_MOCK_VERSION,mapTbcMock} from './tbc-mock.mjs';
import {mapGringott} from './gringott.mjs';
import {BogMockAdapter,BOG_MOCK_VERSION,mapBogMock} from './bog-mock.mjs';

const implementations=new Map([[GRINGOTT_VERSION,GringottAdapter],[TBC_MOCK_VERSION,TbcMockAdapter],[BOG_MOCK_VERSION,BogMockAdapter]]);
export function mapAdapter(version,operation,body){
 if(version===GRINGOTT_VERSION)return mapGringott(operation,body);
 if(version===TBC_MOCK_VERSION)return mapTbcMock(operation,body);
 if(version===BOG_MOCK_VERSION)return mapBogMock(operation,body);
 throw Error('Unknown evidence adapter version');
}

export function adapterTargets(raw=process.env.GEOBRIDGE_MOCK_TARGETS||'[]'){
 const targets=JSON.parse(raw);
 if(!Array.isArray(targets)||targets.length>10)throw Error('Invalid configured mock adapters');
 const result=targets.filter(t=>implementations.has(t.adapter)||(!t.adapter&&t.id==='gringott')).map(t=>{
  const url=new URL(t.origin);
  if(!/^[a-z0-9-]{1,50}$/.test(t.id)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid configured Gringott mock origin');
  return {id:'mock-'+t.id,name:t.name||t.id+' mock',origin:url.origin,tenant:targetTenant(t),adapter:t.adapter||GRINGOTT_VERSION};
 });
 if(new Set(result.map(t=>t.id)).size!==result.length)throw Error('Duplicate adapter target');
 return result;
}
export function createAdapter(connectionId,options={}){
 const target=adapterTargets().find(t=>t.id===connectionId);
 if(!target)throw Error('BANK_NOT_CONNECTED');
 const timeoutMs=Number(target.adapter===TBC_MOCK_VERSION?(process.env.GEOBRIDGE_TBC_MOCK_TIMEOUT_MS||10000):target.adapter===BOG_MOCK_VERSION?(process.env.GEOBRIDGE_BOG_MOCK_TIMEOUT_MS||2000):(process.env.GEOBRIDGE_GRINGOTT_TIMEOUT_MS||2000));
 if(!Number.isInteger(timeoutMs)||timeoutMs<200||timeoutMs>10000)throw Error('Mock deadline must be 200–10000ms');
 return new (implementations.get(target.adapter))(new MockTransport(target.origin,{timeoutMs,...options}));
}
export function seedAdapterConnections({get,put}){
 for(const target of adapterTargets()){
  const current=get('connections',target.id);
  if(current&&(current.adapter!==target.adapter||current.tenant!==target.tenant&&current.tenant!=='bank-demo'))throw Error('Configured mock connection conflicts with an existing record');
  put('connections',{...current,id:target.id,name:target.name,tenant:target.tenant,adapter:target.adapter,profile:'xs2a-0.8',environment:'synthetic_mock',synthetic:true,status:'mock_configured',baseUrl:target.origin,capabilities:{accounts:'mock_supported',balances:'mock_supported',transactions:'mock_supported'},createdAt:current?.createdAt||new Date().toISOString()});
 }
}
