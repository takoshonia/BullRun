// Run inside the backend container. Keep the output file private: it grants Operator access.
import fs from 'node:fs';
import {get,put,event} from '../src/store.mjs';
import {createDemoAccess} from '../src/demo-access.mjs';
const access=createDemoAccess({get,put,event}),[action,arg]=process.argv.slice(2);
if(action==='revoke'){access.revoke(arg);console.log('Demo access revoked, including sessions created with it.');}
else if(action==='issue'&&arg){
 const origin=process.env.GEOBRIDGE_ORIGIN;
 if(!origin)throw Error('GEOBRIDGE_ORIGIN is required');
 if(fs.existsSync(arg))throw Error('Choose a new private output file');
 const issued=access.issue();
 fs.writeFileSync(arg,JSON.stringify({...issued,url:origin+'/#demo-access/'+issued.token},null,2),{mode:0o600,flag:'wx'});
 console.log('Private demo link saved. Expires '+issued.expiresAt);
}else throw Error('Usage: node scripts/demo-access.mjs issue PRIVATE_FILE | revoke GRANT_ID');
