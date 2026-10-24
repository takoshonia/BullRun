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
 const password=id().replaceAll('-','').slice(0,18);
 put('users',{id:'operator',name:'Platform operator',role:'operator',tenant:'platform',password:passwordHash(password)});
 fs.writeFileSync(path.join(dataDir,'demo-credentials.json'),JSON.stringify([{username:'operator',password,role:'Platform operator'}],null,2),{mode:0o600});
 event('system','workspace_initialized','platform',{syntheticOnly:true});
}

// Add scoped demo identities without rotating Operator or guessing ownership of historical evidence.
export function provisionDemoAccounts(){
 const filename=path.join(dataDir,'demo-credentials.json');
 const credentials=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):[];
 const accounts=[['bank-bog','BOG bank engineer','bank','bank-bog'],['bank-tbc','TBC bank engineer','bank','bank-tbc'],['bank-gringott','Gringott demo bank engineer','bank','bank-gringott'],['nbg','NBG Reviewer (demo)','reviewer','nbg'],['tpp-demo','TPP developer (demo)','tpp','tpp-demo']];
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const username of ['bank','reviewer','standards','tpp']){const old=get('users',username);if(old&&!old.disabled){put('users',{...old,disabled:true});db.prepare('DELETE FROM sessions WHERE user_id=?').run(username)}}
  for(const schedule of all('schedules'))if(get('users',schedule.owner)?.disabled&&schedule.enabled)put('schedules',{...schedule,enabled:false,lastError:'Legacy shared account retired; recreate this schedule with an organization account.'});
  for(const [username,name,role,tenant] of accounts){
   if(!get('users',username)){const password=id().replaceAll('-','');put('users',{id:username,name,role,tenant,password:passwordHash(password)});credentials.push({username,password,role:name,tenant})}
   // Retire only untouched generated placeholders; keep customized or referenced records.
   if(role==='bank'){
    const placeholder=get('connections',tenant+'-sandbox');
    const referenced=['runs','schedules','specs'].some(kind=>all(kind).some(x=>x.connectionId===placeholder?.id||kind==='specs'&&x.id===placeholder?.id));
    if(placeholder&&placeholder.tenant===tenant&&placeholder.name===name.replace(' bank engineer','')+' sandbox'&&placeholder.status==='not_connected'&&placeholder.environment==='pending'&&!placeholder.baseUrl&&!placeholder.specHash&&!placeholder.adapter&&!referenced){put('retired_connections',{...placeholder,retiredReason:'Unused generated sandbox placeholder; demo uses configured mock bank.'});remove('connections',placeholder.id)}
   }
  }
  fs.writeFileSync(filename,JSON.stringify(credentials.filter(c=>!get('users',c.username)?.disabled),null,2),{mode:0o600});
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
}
