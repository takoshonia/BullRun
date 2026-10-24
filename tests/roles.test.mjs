import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workspacePayload} from '../src/workspace-access.mjs';
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const records={connections:[{id:'c',tenant:'bank-demo',name:'Synthetic sandbox',status:'not_connected',profile:'p',baseUrl:'PRIVATE',specHash:'PRIVATE',capabilities:{accounts:'unknown'}}],runs:[{id:'r',tenant:'bank-demo',kind:'evidence',status:'completed',results:[{private:'payload'}]},{id:'internal',tenant:'bank-demo',kind:'platform'}],packs:[{id:'pack',tenant:'bank-demo',profile:'p',observations:[{}],samples:[]}],schedules:[{id:'schedule',tenant:'bank-demo'}],gates:[{id:'gate',tenant:'bank-demo'}],rules:[{id:'rule',profile:'p',source:'doc'}],updates:[{id:'draft',status:'draft'}]};
const services={records:k=>records[k]||[],profiles:[{id:'p'},{id:'platform'}],sources:[{file:'doc'}],aiConfigured:false,canSee:(u,tenant)=>u.role==='operator'||u.tenant===tenant||u.role==='reviewer'&&tenant==='bank-demo'};
test('TPP workspace contains only public catalog; no private bank or governance records',()=>{const w=workspacePayload({id:'tpp',role:'tpp',tenant:'tpp-demo'},services);assert.equal(w.catalog.length,1);assert(!JSON.stringify(w).includes('PRIVATE'));for(const k of ['connections','runs','packs','rules','sources','schedules','gates','updates'])assert.equal(w[k].length,0,k)});
test('standards workspace contains governance, not bank data',()=>{const w=workspacePayload({id:'standards',role:'standards',tenant:'standards'},services);assert.equal(w.rules.length,1);assert.equal(w.sources.length,1);assert.equal(w.updates.length,1);for(const k of ['connections','runs','packs','schedules','gates','catalog'])assert.equal(w[k].length,0,k)});
test('oversight excludes internal self-tests, raw packs, private schedules and release actions',()=>{const w=workspacePayload({id:'reviewer',role:'reviewer',tenant:'oversight'},services);assert.equal(w.runs.length,1);assert.equal(w.runs[0].results,undefined);for(const k of ['packs','schedules','gates','updates'])assert.equal(w[k].length,0,k)});
test('bank workspace has its own records and all selectable bank profiles',()=>{const w=workspacePayload({id:'bank',role:'bank',tenant:'bank-demo'},services);assert.equal(w.connections.length,1);assert.equal(w.packs[0].observations,undefined);assert.equal(w.profiles.some(p=>p.id==='platform'),false);assert.equal(w.updates.length,0);assert(w.runs.every(r=>r.kind!=='platform'));assert.equal(w.diagnosticsRuns.length,0)});
const expectations={operator:{home:'overview',pages:['overview','audit','connections','explorer','oversight','monitor','reports','standards','gate','diagnostics','activity']},bank:{home:'audit',pages:['audit','connections','monitor','reports','standards','gate','activity']},tpp:{home:'explorer',pages:['explorer','activity']},reviewer:{home:'oversight',pages:['oversight','audit','monitor','reports','activity']},standards:{home:'standards',pages:['standards','activity']}};
for(const [role,expected]of Object.entries(expectations))test(role+' lands correctly, sees its own menu and resets old-session state',async()=>{
 const elements=new Map();const element=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',style:{},open:false,addEventListener(){},showModal(){},close(){}});return elements.get(s)};
 const doc={querySelector:element,addEventListener(){}};const user={id:role,role,name:role,tenant:role==='bank'?'bank-demo':role};
 const w=workspacePayload(user,services);const fetch=async url=>({ok:true,json:async()=>url==='/api/me'?{user,csrf:'new-csrf'}:url==='/api/events'?[]:w});
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('document','fetch','setInterval','setTimeout','clearTimeout',code+'\nreturn {state,render,activateSession,clearSession,policy,roleNav,navigate};');
 const ui=await run(doc,fetch,()=>{},()=>{},()=>{});
 assert.equal(ui.state.page,expected.home);assert.deepEqual(ui.roleNav().map(x=>x[0]),expected.pages);
 const html=element('#app').innerHTML;assert.equal(html.includes('data-nav="diagnostics"'),role==='operator');
 if(role==='standards'){assert(html.includes('Standards & rules'));assert(!html.includes('data-nav="audit"'));assert(!html.includes('data-action="new-run"'));}
 if(role==='tpp'){assert(html.includes('Supported connections'));assert(!html.includes('data-nav="standards"'));assert(!html.includes('data-nav="audit"'));}
 if(role==='reviewer'){assert(html.includes('Oversight dashboard'));assert(!html.includes('data-action="new-run"'));assert(!html.includes('data-nav="gate"'));}
 for(const page of expected.pages){ui.navigate(page);assert(element('#app').innerHTML.length>1000,page)}
 if(role!=='operator'){ui.state.page='overview';ui.render();assert.equal(ui.state.page,expected.home)}
 ui.state.run={id:'previous-user-private-run'};ui.activateSession({user,csrf:'replacement'});assert.equal(ui.state.run,null);assert.equal(ui.state.page,expected.home);assert.equal(ui.state.csrf,'replacement');
 ui.clearSession();assert.equal(ui.state.workspace,null);assert.equal(ui.state.run,null);assert.equal(ui.state.csrf,'');
});
