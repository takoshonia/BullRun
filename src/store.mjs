import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {id,passwordHash} from './security.mjs';
export const root=path.resolve(import.meta.dirname,'..');
export const dataDir=process.env.GEOBRIDGE_DATA_DIR||path.join(root,'data');
fs.mkdirSync(dataDir,{recursive:true});
export const db=new DatabaseSync(path.join(dataDir,'geobridge.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS records (kind TEXT,id TEXT,json TEXT,PRIMARY KEY(kind,id));
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT,csrf TEXT,expires INTEGER);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,actor TEXT,action TEXT,target TEXT,detail TEXT);
`);
export const all=kind=>db.prepare('SELECT json FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(x=>JSON.parse(x.json));
export const get=(kind,key)=>{const r=db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,key);return r?JSON.parse(r.json):null};
export const put=(kind,obj)=>{db.prepare('INSERT INTO records(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,obj.id,JSON.stringify(obj));return obj};
export const remove=(kind,key)=>db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,key);
export const event=(actor,action,target,detail={})=>db.prepare('INSERT INTO events(at,actor,action,target,detail) VALUES(?,?,?,?,?)').run(new Date().toISOString(),actor,action,target,JSON.stringify(detail));
export function seed(){
 if(all('users').length)return;
 const roles=[['operator','Platform operator','platform'],['bank','Bank engineer','bank-demo'],['tpp','TPP developer','tpp-demo'],['reviewer','Oversight reviewer','oversight'],['standards','Standards reviewer','standards']];
 const credentials=[];
 for(const [role,name,tenant]of roles){const password=id().replaceAll('-','').slice(0,18);put('users',{id:role,name,role,tenant,password:passwordHash(password)});credentials.push({username:role,password,role:name})}
 fs.writeFileSync(path.join(dataDir,'demo-credentials.json'),JSON.stringify(credentials,null,2),{mode:0o600});
 put('connections',{id:'bank-connection-a',name:'Sandbox connection A',tenant:'bank-demo',status:'not_connected',environment:'pending',profile:'xs2a-0.8',capabilities:{accounts:'unknown',balances:'unknown',transactions:'unknown'},baseUrl:'',specHash:null,adapter:null,createdAt:new Date().toISOString()});
 put('connections',{id:'bank-connection-b',name:'Sandbox connection B',tenant:'bank-demo',status:'not_connected',environment:'pending',profile:'xs2a-0.8',capabilities:{accounts:'unknown',balances:'unknown',transactions:'unknown'},baseUrl:'',specHash:null,adapter:null,createdAt:new Date().toISOString()});
 event('system','workspace_initialized','platform',{syntheticOnly:true});
}
