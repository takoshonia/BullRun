import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {summarize,parseTargets,createAvailability,requestJSON} from '../src/availability.mjs';

test('availability estimates separate failed probes, measured time, gaps and unresolved incidents',()=>{
 const row=(at,outcome,epoch='a')=>({at,outcome,epoch,intervalMs:1000});
 const r=summarize([row(1000,'up'),row(2000,'timeout'),row(3000,'down'),row(4000,'up'),row(9000,'up','b')],{from:0,to:10000,now:10000,intervalMs:1000});
 assert.equal(r.successfulChecksPercent,60);assert.equal(r.estimatedUpMs,1000);assert.equal(r.estimatedDownMs,2000);assert.equal(r.unknownMs,7000);assert.equal(r.estimatedUptimePercent,100/3);
 assert.equal(r.incidents.length,1);assert.equal(r.incidents[0].detectedAt,2000);assert.equal(r.incidents[0].endedAt,4000);assert.equal(r.incidents[0].estimatedDurationMs,2000);
 const gap=summarize([row(1000,'down'),row(9000,'up')],{now:20000,intervalMs:1000});assert.equal(gap.incidents[0].interrupted,true);assert.equal(gap.incidents[0].endedAt,null);assert.equal(gap.currentStatus,'unknown');
 assert.equal(summarize([]).estimatedUptimePercent,null);
});

test('configured targets reject arbitrary URL syntax and duplicate IDs',()=>{
 assert.throws(()=>parseTargets('[{"id":"x","origin":"http://user:pass@localhost"}]'));
 assert.throws(()=>parseTargets('[{"id":"x","origin":"http://localhost/a"}]'));
 assert.throws(()=>parseTargets('[{"id":"x","origin":"http://localhost"},{"id":"x","origin":"http://localhost"}]'));
 assert.equal(parseTargets('[{"id":"gringott","origin":"http://gringott:4173"}]')[0].tenant,'bank-demo');
});

test('monitor survives restart with history; paused and interrupted time is not invented',{timeout:10000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'availability-db-')),file=path.join(dir,'test.sqlite');
 let db=new DatabaseSync(file);let time=100000,requests=0,outcome='up';
 const targets=[{id:'gringott',name:'Gringott',tenant:'bank-demo',origin:'http://gringott:4173'}];
 const m=createAvailability({db,targets,clock:()=>time,request:async()=>{requests++;return {outcome,httpStatus:outcome==='up'?200:null,durationMs:10}}});
 assert.equal(m.report('gringott').currentStatus,'paused');
 assert.throws(()=>m.configure('gringott',{enabled:true,intervalSeconds:5,timeoutSeconds:5}));
 m.configure('gringott',{enabled:true,intervalSeconds:5,timeoutSeconds:1});
 await m.probe('gringott');await m.probe('gringott');assert.equal(requests,1,'manual probing respects interval');
 time+=5000;outcome='timeout';await m.probe('gringott');time+=5000;outcome='up';await m.probe('gringott');
 const report=m.report('gringott',99000,time);assert.equal(report.incidents.length,1);assert.equal(report.estimatedDownMs,5000);assert.equal(report.currentStatus,'up');
 m.stop();db.close();db=new DatabaseSync(file);time+=1000;
 const restarted=createAvailability({db,targets,clock:()=>time,request:async()=>({outcome:'up',httpStatus:200,durationMs:1})});
 assert.equal(restarted.report('gringott').checks,3);assert.equal(restarted.report('gringott').currentStatus,'unknown');
 time+=5000;await restarted.probe('gringott');assert.equal(restarted.report('gringott').estimatedDownMs,5000);
 restarted.configure('gringott',{enabled:false,intervalSeconds:5,timeoutSeconds:1});assert.equal(await restarted.probe('gringott'),false);assert.equal(restarted.report('gringott').currentStatus,'paused');
 restarted.stop();db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('absolute HTTP deadline handles silence; 503, invalid health and redirects fail',{timeout:10000},async()=>{
 const sockets=new Set();let mode='ok';const server=http.createServer((req,res)=>{if(mode==='silent')return;if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:1'});res.end();return;}if(mode==='huge'){res.end('x'.repeat(9000));return;}res.writeHead(mode==='503'?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:mode==='invalid'?'error':'ok'}));});
 server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await requestJSON(url)).outcome,'up');mode='503';assert.equal((await requestJSON(url)).outcome,'down');mode='invalid';assert.equal((await requestJSON(url)).outcome,'down');mode='redirect';assert.equal((await requestJSON(url)).httpStatus,302);mode='huge';assert.equal((await requestJSON(url)).outcome,'invalid_response');mode='silent';const r=await requestJSON(url,{timeoutMs:100});assert.equal(r.outcome,'timeout');assert(r.durationMs<1000);}finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
});
