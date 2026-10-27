import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createTbcSandbox} from '../src/tbc-sandbox.mjs';

function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tbc-flow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const encryptionKeyFile=path.join(dir,'key');fs.writeFileSync(encryptionKeyFile,crypto.randomBytes(32));
 const rows=new Map(),get=(k,id)=>rows.get(k+':'+id),put=(k,row)=>(rows.set(k+':'+row.id,row),row),remove=(k,id)=>rows.delete(k+':'+id),all=k=>[...rows.entries()].filter(([key])=>key.startsWith(k+':')).map(([,v])=>v);
 const user={id:'operator',role:'operator'},calls=[];put('users',user);let clock=Date.now(),valid=true;
 const transport={async request(url,options){calls.push({url,options});if(url.endsWith('/consents'))return {status:201,body:{consentId:'consent-1'},proof:{signerTrusted:true}};if(url.endsWith('/token'))return {status:200,body:{access_token:'PRIVATE_TEST_ACCESS_TOKEN',token_type:'Bearer',expires_in:3600}};return {status:200,body:{accounts:[{resourceId:'a',iban:'GE00PRIVATE',ownerName:'Private person'}]},proof:{signerTrusted:true}};}};
 const service=createTbcSandbox({get,put,remove,all,event:()=>{},sessionValid:()=>valid,origin:'https://app.example',config:{encryptionKeyFile,clientId:'test-client'},transport,now:()=>clock});
 return {service,user,calls,rows,get,put,setClock:n=>clock=n,revoke:()=>valid=false,now:()=>clock};
}
test('OAuth uses PKCE, private correlation cookie, encrypted storage and one-use callback',async t=>{
 const s=setup(t),start=await s.service.start(s.user,'session','1.1.1.1'),url=new URL(start.authorizationUrl),state=url.searchParams.get('state');
 assert.equal(url.searchParams.get('scope'),'AIS:consent-1');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(s.calls[0].options.redirectUri,'https://app.example/api/tbc-sandbox/callback');
 await assert.rejects(s.service.callback(new URLSearchParams({state,code:'test-code'}),'wrong-cookie'),/correlation/);
 await s.service.callback(new URLSearchParams({state,code:'test-code'}),start.cookie);
 const verifier=s.calls[1].options.form.code_verifier;
 assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'),url.searchParams.get('code_challenge'));
 assert.equal(s.service.status(s.user,'session').connected,true);
 assert.ok(!JSON.stringify([...s.rows]).includes('PRIVATE_TEST_ACCESS_TOKEN'));
 assert.ok(!JSON.stringify([...s.rows]).includes(verifier));
 await assert.rejects(s.service.callback(new URLSearchParams({state,code:'test-code'}),start.cookie),/expired/);
 const accounts=await s.service.accounts(s.user,'session','1.1.1.1');assert.equal(accounts.data.accounts[0].iban,'[REDACTED]');
 s.service.disconnect(s.user,'session');assert.equal(s.service.status(s.user,'session').connected,false);
});
test('demo QR sessions, non-operators and revoked sessions cannot connect',async t=>{
 const s=setup(t);await assert.rejects(s.service.start({id:'bank',role:'bank'},'session','1.1.1.1'),/operator/);
 s.put('demo_access_sessions',{id:'qr'});await assert.rejects(s.service.start(s.user,'qr','1.1.1.1'),/operator/);
 s.revoke();await assert.rejects(s.service.start(s.user,'session','1.1.1.1'),/operator/);assert.equal(s.calls.length,0);
});
test('pending flows expire and cannot be duplicated',async t=>{
 const s=setup(t),start=await s.service.start(s.user,'session','1.1.1.1');
 await assert.rejects(s.service.start(s.user,'session','1.1.1.1'),/pending/);
 s.setClock(s.now()+600001);
 await assert.rejects(s.service.callback(new URLSearchParams({state:new URL(start.authorizationUrl).searchParams.get('state'),code:'test'}),start.cookie),/expired/);
 assert.equal(s.calls.length,1);
});
test('callback cannot authorize after the initiating session is revoked',async t=>{
 const s=setup(t),start=await s.service.start(s.user,'session','1.1.1.1');s.revoke();
 await assert.rejects(s.service.callback(new URLSearchParams({state:new URL(start.authorizationUrl).searchParams.get('state'),code:'test'}),start.cookie),/operator/);
 assert.equal(s.calls.length,1);
});
