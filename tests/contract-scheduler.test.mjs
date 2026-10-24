import test from 'node:test';import assert from 'node:assert/strict';
import {contractIntervalMinutes,createContractScheduler} from '../src/contract-scheduler.mjs';
test('contract scans default to daily and configuration is bounded',()=>{assert.equal(contractIntervalMinutes('1440'),1440);for(const value of ['',0,4,10081,'abc',1.5])assert.throws(()=>contractIntervalMinutes(value));});
test('persisted last attempts survive restart, manual scans defer scheduled scans, notifications trigger immediately and coalesce',async()=>{
 let time=Date.parse('2026-10-25T00:00:00Z');const status=new Map(),calls=[];const options={targets:()=>[{id:'mock-bog'}],get:(_,id)=>status.get(id),clock:()=>time,minutes:1440,scan:async(id,actor)=>{calls.push({id,actor});status.set(id,{checkedAt:new Date(time).toISOString()})}};
 let s=createContractScheduler(options);await s.tick();assert.equal(calls.length,1);time+=3600000;s=createContractScheduler(options);await s.tick();assert.equal(calls.length,1);
 status.set('mock-bog',{checkedAt:new Date(time).toISOString()});time+=23*3600000;await s.tick();assert.equal(calls.length,1);time+=3600000;await s.tick();assert.equal(calls.length,2);
 assert.equal(await s.notify('mock-bog'),true);assert.equal(calls.length,3);assert.equal(await s.notify('mock-bog'),false);await assert.rejects(s.notify('unknown'));assert.equal(calls.length,3);
});
test('overlapping notification and scheduled scans do not duplicate network work',async()=>{
 let release;let count=0;const s=createContractScheduler({targets:()=>[{id:'mock-bog'}],get:()=>null,scan:async()=>{count++;await new Promise(r=>release=r)}});const pending=s.tick();await s.tick();assert.equal(count,1);release();await pending;
});
