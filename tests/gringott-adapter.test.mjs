import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {MockTransport} from '../src/adapters/http-transport.mjs';
import {GringottAdapter,mapGringott} from '../src/adapters/gringott.mjs';
import {adapterTargets} from '../src/adapters/registry.mjs';

test('Gringott mapping preserves exact decimals and booking status; invalid/duplicate values fail',()=>{
 const t={transactionId:'a',status:'pending',transactionAmount:{amount:'-123456789012345.1234',currency:'GEL'}};
 const out=mapGringott('transactions',{transactions:[t]});assert.equal(out.transactions[0].amount,t.transactionAmount.amount);assert.equal(out.transactions[0].status,'pending');
 assert.throws(()=>mapGringott('transactions',{transactions:[{...t,status:'UNKNOWN'}]}));
 assert.throws(()=>mapGringott('transactions',{transactions:[t,t]}));
 assert.throws(()=>mapGringott('transactions',{transactions:[{...t,transactionAmount:{amount:1.1,currency:'GEL'}}]}));
 assert.throws(()=>adapterTargets('[{"id":"gringott","origin":"http://user:pass@localhost"}]'));
 assert.throws(()=>adapterTargets('[{"id":"gringott","origin":"http://localhost/path"}]'));
});

test('pagination detects repeats, wrong offsets, changing totals and unbounded page chains',async()=>{
 const tx=id=>({transactionId:id,status:'booked',transactionAmount:{amount:'1.00',currency:'GEL'}});
 const page=(transactions,offset,total,nextOffset)=>({status:200,body:{transactions,page:{offset,total,nextOffset}}});
 let responses=[page([tx('1'),tx('2')],0,3,2),page([tx('3')],2,3,null)];
 const a=new GringottAdapter({request:async()=>responses.shift()});assert.equal((await a.listTransactions({token:'private'},'account')).data.transactions.length,3);
 responses=[page([tx('1'),tx('2')],0,4,2),page([tx('1'),tx('2')],2,4,null)];await assert.rejects(a.listTransactions({},'account'),/Repeated/);
 responses=[page([tx('1')],0,2,0)];await assert.rejects(a.listTransactions({},'account'),/progress/);
 responses=[page([tx('1'),tx('2')],0,4,2),page([tx('3')],2,3,null)];await assert.rejects(a.listTransactions({},'account'),/changed/);
});

test('transport bounds responses/deadlines and cancellation, never captures tokens or follows redirects',async()=>{
 const observations=[],sockets=new Set();let mode='ok',receivedToken;
 const server=http.createServer((req,res)=>{receivedToken=req.headers.authorization;
  if(mode==='silent')return;if(mode==='redirect'){res.writeHead(302,{Location:'https://example.invalid/?code=PRIVATE_CODE'});res.end();return;}
  if(mode==='large'){res.end('x'.repeat(1_000_001));return;}
  if(mode==='unicode'){const raw=Buffer.from(JSON.stringify({name:'გრინგოტი'}));const split=raw.indexOf(0xe1)+1;res.write(raw.subarray(0,split));setTimeout(()=>res.end(raw.subarray(split)),5);return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({access_token:'PRIVATE_TOKEN',code:'PRIVATE_CODE'}));
 });server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const origin='http://127.0.0.1:'+server.address().port;
  const t=new MockTransport(origin,{timeoutMs:100,onObservation:o=>observations.push(o)});
  await t.request('/oauth/token',{token:'PRIVATE_TOKEN',sensitive:true});assert.equal(receivedToken,'Bearer PRIVATE_TOKEN');assert(!JSON.stringify(observations).includes('PRIVATE_'));
  await assert.rejects(t.request('https://example.invalid/'),/origin/);await assert.rejects(t.request('//example.invalid/'),/origin/);
  mode='redirect';const redirect=await t.request('/oauth/authorize',{sensitive:true});assert.equal(redirect.status,302);assert(!JSON.stringify(observations).includes('PRIVATE_'));
  mode='large';assert.equal((await t.request('/api/v1/accounts')).transportError,'RESPONSE_TOO_LARGE');
  mode='unicode';assert.equal((await t.request('/api/v1/accounts')).body.name,'გრინგოტი');
  mode='silent';assert.equal((await t.request('/api/v1/accounts')).transportError,'TIMEOUT');
  const signal=AbortSignal.timeout(30);await assert.rejects(new MockTransport(origin,{signal}).request('/api/v1/accounts'));
 }finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
});
