// Local-only launcher. Existing BOG and Gringott mocks must already be running.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
import {createMockPushBank} from './mock-push-bank.mjs';
const root=path.resolve(import.meta.dirname,'..'),dir=process.env.PUSH_DEMO_DATA_DIR||path.join(root,'data','push-preview');fs.mkdirSync(dir,{recursive:true});
function key(name){const file=path.join(dir,name);if(!fs.existsSync(file))fs.writeFileSync(file,crypto.randomBytes(32).toString('hex'),{mode:0o600});return {file,value:fs.readFileSync(file,'utf8').trim()}}
const signing=key('webhook-signing.key'),admin=key('publisher-admin.key');
const port=Number(process.env.PUSH_DEMO_PORT||4320),bankPort=Number(process.env.PUSH_BANK_PORT||4185),base='http://127.0.0.1:'+port;
const publisher=createMockPushBank({upstreamOrigin:process.env.MOCK_PUSH_UPSTREAM||'http://127.0.0.1:4183',callbackUrl:base+'/api/webhooks/contracts/mock-bog',connectionId:'mock-bog',secret:signing.value,adminKey:admin.value,stateFile:path.join(dir,'publisher-state.json')});
await new Promise(r=>publisher.server.listen(bankPort,'127.0.0.1',r));
const targets=[{id:'bog',name:'BOG push demo — synthetic publisher',adapter:'bog-mock-v1',origin:'http://127.0.0.1:'+bankPort},{id:'gringott',name:'Gringott unchanged mock',origin:process.env.MOCK_PUSH_GRINGOTT||'http://127.0.0.1:4184'}];
const app=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),GEOBRIDGE_ORIGIN:base,GEOBRIDGE_DATA_DIR:dir,GEOBRIDGE_MOCK_TARGETS:JSON.stringify(targets),GEOBRIDGE_CONTRACT_WEBHOOKS:JSON.stringify([{connectionId:'mock-bog',secretFile:signing.file,demoControlKeyFile:admin.file}])},stdio:'inherit',windowsHide:true});
console.log('Local push demo: '+base+'; synthetic publisher is a separate HTTP server.');
let closing=false;async function close(){if(closing)return;closing=true;app.kill();await publisher.close()}
process.on('SIGTERM',()=>close().then(()=>process.exit()));process.on('SIGINT',()=>close().then(()=>process.exit()));app.on('exit',()=>close().then(()=>process.exit()));
