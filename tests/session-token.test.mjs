import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
async function setup(){
 const nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',style:{},open:false,addEventListener(){},close(){},showModal(){}});return nodes.get(key)};
 const document={querySelector:node,querySelectorAll:()=>[],addEventListener(){}};
 const user={id:'nbg',name:'NBG',role:'reviewer',tenant:'nbg'};
 const control={user,csrf:'current-token',calls:[],status:200};
 const workspace={connections:[],runs:[],rules:[],profiles:[],sources:[],packs:[],schedules:[],gates:[],savedReports:[],ai:{configured:false}};
 const fetch=async(url,options={})=>{control.calls.push({url,options});return {ok:true,status:200,json:async()=>url==='/api/me'?{user:control.user,csrf:control.csrf}:url==='/api/compare'?{changes:[]}:url==='/api/events'?[]:workspace}};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const ui=await new AsyncFunction('document','fetch','setInterval','setTimeout','clearTimeout',code+'\nreturn {api,state};')(document,fetch,()=>{},()=>{},()=>{});
 control.calls=[];return {ui,control};
}
test('NBG comparison refreshes stale CSRF for the same account before exactly one submission',async()=>{
 const {ui,control}=await setup();ui.state.csrf='old-token';await ui.api('/api/compare',{method:'POST',body:{before:'a',after:'b'}});
 assert.deepEqual(control.calls.map(c=>c.url),['/api/me','/api/compare']);
 const request=control.calls[1].options;assert.equal(request.headers['X-CSRF-Token'],'current-token');assert.equal(request.headers['X-GeoBridge-Account'],JSON.stringify(['nbg','reviewer','nbg']));
});
test('switching the cookie to Operator never retries an NBG action as Operator',async()=>{
 const {ui,control}=await setup();control.user={id:'operator',role:'operator',tenant:'platform'};
 await assert.rejects(ui.api('/api/compare',{method:'POST',body:{before:'a',after:'b'}}),/changed in another tab/);
 assert.equal(ui.state.user,null);assert(!control.calls.some(c=>c.url==='/api/compare'));
});
