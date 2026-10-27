import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {signTbcRequest,verifyTbcResponse} from '../src/tbc-jws.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/tbc-jws.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const key=crypto.createPrivateKey(fixture.key),cert=new crypto.X509Certificate(fixture.certificate);
function response({alg='RS256',now=new Date(),body=Buffer.from('{"status":"ok"}')}={}){
 const headers={'x-request-id':'test-request',digest:'SHA-256='+crypto.createHash('sha256').update(body).digest('base64'),'content-type':'application/json'};
 const names=['(response-status)','x-request-id','digest','content-type'];
 const header={alg,b64:false,crit:['sigT','sigD','b64'],sigT:now.toISOString(),sigD:{pars:names,mId:'http://uri.etsi.org/19182/HttpHeaders'},x5c:[cert.raw.toString('base64')]};
 const encoded=Buffer.from(JSON.stringify(header)).toString('base64url');
 const payload=names.map(n=>n+': '+(n==='(response-status)'?'200':headers[n])).join('\n');
 const options=alg==='PS256'?{key,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}:key;
 headers['x-jws-signature']=encoded+'..'+crypto.sign('sha256',Buffer.from(encoded+'.'+payload),options).toString('base64url');
 return {status:200,headers,body,requestId:'test-request',rootCertificates:[fixture.certificate]};
}
test('request signing binds method, query, body digest and PSU headers',()=>{
 const url=new URL('https://test-openbanking.tbcbank.ge/0.8/v1/accounts?withBalance=true');
 const headers=signTbcRequest({method:'GET',url,headers:{'x-request-id':'test-request','psu-ip-address':'1.1.1.1'},body:Buffer.alloc(0),key,certificate:fixture.certificate});
 const [encoded,,signature]=headers['x-jws-signature'].split('.');
 const profile=JSON.parse(Buffer.from(encoded,'base64url'));
 const payload=profile.sigD.pars.map(n=>n+': '+(n==='(request-target)'?'get '+url.pathname+url.search:headers[n])).join('\n');
 assert.equal(crypto.verify('sha256',Buffer.from(encoded+'.'+payload),cert.publicKey,Buffer.from(signature,'base64url')),true);
 assert.ok(profile.sigD.pars.includes('psu-ip-address'));
 assert.throws(()=>signTbcRequest({method:'GET',url,headers:{'x-request-id':'bad\r\nheader'},body:Buffer.alloc(0),key,certificate:fixture.certificate}),/invalid/);
});
test('response verification accepts RS256 and PS256 only with explicit trust',()=>{
 for(const alg of ['RS256','PS256'])assert.equal(verifyTbcResponse(response({alg})).signerTrusted,true);
 const r=response();r.rootCertificates=[];
 assert.throws(()=>verifyTbcResponse(r),/trust anchor/);
});
test('a missing echoed request ID fails closed',()=>{
 const r=response();delete r.headers['x-request-id'];
 assert.throws(()=>verifyTbcResponse(r),/correlation/);
});
test('tampered body, correlation, status, signature and stale timestamps fail closed',()=>{
 const body=response();body.body=Buffer.from('{}');assert.throws(()=>verifyTbcResponse(body),/digest/);
 const correlation=response();correlation.requestId='different';assert.throws(()=>verifyTbcResponse(correlation),/correlation/);
 const status=response();status.status=201;assert.throws(()=>verifyTbcResponse(status),/signature/);
 const signature=response();signature.headers['x-jws-signature']=signature.headers['x-jws-signature'].slice(0,-8)+'AAAAAAAA';assert.throws(()=>verifyTbcResponse(signature),/signature/);
 assert.throws(()=>verifyTbcResponse(response({now:new Date(Date.now()-120000)})),/timestamp/);
 assert.throws(()=>verifyTbcResponse(response({now:new Date(Date.now()+120000)})),/timestamp/);
});
