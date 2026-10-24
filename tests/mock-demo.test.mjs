import test from 'node:test';import assert from 'node:assert/strict';
import {createMockDemo} from '../src/mock-demo.mjs';
function fixture(){
 const records=new Map();let now=1000,unavailable=false;const faults={slowResponse:false,revokedConsentBypass:false};
 const options={targets:[{id:'bog',name:'Mock',origin:'http://mock',adminHeader:'X-BOG-Mock-Admin-Key',adminKey:'PRIVATE'}],records:()=>[...records.values()],get:(_kind,id)=>records.get(id),put:(_kind,p)=>records.set(p.id,p),event:()=>{},clock:()=>now,request:async(url,options)=>{
  if(unavailable)return {httpStatus:503};
  if(url.endsWith('/state'))return {httpStatus:200,data:{faults,private:'SECRET'}};
  Object.assign(faults,options.body);return {httpStatus:200,data:{faults:{...faults}}};
 }};
 return {options,faults,records,advance:()=>now+=61000,fail:value=>unavailable=value};
}
test('controlled faults persist restoration intent and automatically restore after restart',async()=>{
 const f=fixture(),demo=createMockDemo(f.options);await demo.change('bog',{defect:'slowResponse',enabled:true,durationSeconds:60},'operator');assert.equal(f.faults.slowResponse,true);assert(!JSON.stringify(demo.list()).includes('PRIVATE'));assert(!JSON.stringify(demo.list()).includes('SECRET'));
 f.advance();await createMockDemo(f.options).tick();assert.equal(f.faults.slowResponse,false);assert.equal(f.records.get('bog-slowResponse').status,'restored');
});
test('unconfirmed restoration remains pending and is retried rather than reported successful',async()=>{
 const f=fixture(),demo=createMockDemo(f.options);await demo.change('bog',{defect:'revokedConsentBypass',enabled:true,durationSeconds:60},'operator');f.fail(true);f.advance();await demo.tick();assert.equal(f.records.get('bog-revokedConsentBypass').status,'restore_pending');f.fail(false);await demo.tick();assert.equal(f.faults.revokedConsentBypass,false);
});
test('controls cannot change arbitrary flags, unknown targets or externally enabled faults',async()=>{
 const f=fixture(),demo=createMockDemo(f.options);await assert.rejects(demo.change('bog',{defect:'anything',enabled:true},'operator'),/allowed/);await assert.rejects(demo.change('real-bank',{defect:'slowResponse',enabled:true},'operator'),/supported/);
 f.faults.slowResponse=true;await assert.rejects(demo.change('bog',{defect:'slowResponse',enabled:true},'operator'),/already enabled/);await demo.change('bog',{defect:'slowResponse',enabled:false},'operator');assert.equal(f.faults.slowResponse,true,'Do not clear a flag that GeoBridge did not own');
});
