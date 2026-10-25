import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {workspacePayload} from '../src/workspace-access.mjs';
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const records={connections:[{id:'c',tenant:'bank-demo',name:'Synthetic sandbox',status:'not_connected',profile:'p',baseUrl:'PRIVATE',specHash:'PRIVATE',capabilities:{accounts:'unknown'}}],runs:[{id:'r',tenant:'bank-demo',kind:'evidence',status:'completed',results:[{private:'payload'}]},{id:'internal',tenant:'bank-demo',kind:'platform'}],packs:[{id:'pack',tenant:'bank-demo',profile:'p',observations:[{}],samples:[]}],schedules:[{id:'schedule',tenant:'bank-demo'}],gates:[{id:'gate',tenant:'bank-demo'}],rules:[{id:'rule',profile:'p',source:'doc',status:'approved'}],updates:[{id:'draft',status:'draft'}]};
const services={records:k=>records[k]||[],profiles:[{id:'p'},{id:'platform'}],sources:[{file:'doc'}],aiConfigured:false,canSee:(u,tenant)=>u.role==='operator'||u.tenant===tenant||u.role==='reviewer'&&tenant==='bank-demo'};
test('TPP workspace contains only public catalog; no private bank or governance records',()=>{const w=workspacePayload({id:'tpp',role:'tpp',tenant:'tpp-demo'},services);assert.equal(w.catalog.length,0);assert(!JSON.stringify(w).includes('PRIVATE'));for(const k of ['connections','runs','packs','rules','sources','schedules','gates','updates'])assert.equal(w[k].length,0,k)});
test('TPP catalog excludes pending private connections and includes configured synthetic capabilities only',()=>{
 const synthetic={id:'public',tenant:'bank-tbc',name:'TBC synthetic',synthetic:true,status:'mock_configured',baseUrl:'PRIVATE',authentication:{credentialReference:'PRIVATE'}};
 const w=workspacePayload({id:'tpp',role:'tpp',tenant:'tpp-demo'},{...services,records:k=>k==='connections'?[...records.connections,synthetic]:services.records(k)});
 assert.deepEqual(w.catalog.map(c=>c.id),['public']);assert(!JSON.stringify(w.catalog).includes('PRIVATE'));
});
test('NBG combines standards and oversight without receiving credential configuration or raw evidence',()=>{
 const w=workspacePayload({id:'nbg',role:'reviewer',tenant:'nbg'},services);
 assert.equal(w.rules.length,1);assert.equal(w.sources.length,1);assert.equal(w.updates.length,1);assert.equal(w.schedules.length,1);assert.equal(w.gates.length,1);
 assert.equal(w.connections[0].baseUrl,undefined);assert.equal(w.packs[0].observations,undefined);assert.equal(w.runs.length,1);assert.equal(w.runs[0].results,undefined);assert.equal(w.diagnosticsRuns.length,0);
});
test('bank workspace has its own records and all selectable bank profiles',()=>{const w=workspacePayload({id:'bank',role:'bank',tenant:'bank-demo'},services);assert.equal(w.connections.length,1);assert.equal(w.packs[0].observations,undefined);assert.equal(w.profiles.some(p=>p.id==='platform'),false);assert.equal(w.updates.length,0);assert(w.runs.every(r=>r.kind!=='platform'));assert.equal(w.diagnosticsRuns.length,0)});
const expectations={operator:{home:'overview',pages:['overview','audit','connections','explorer','oversight','monitor','comparison','contracts','reports','standards','gate','diagnostics','notifications','activity']},bank:{home:'overview',pages:['overview','audit','monitor','reports','standards','gate','notifications','activity']},tpp:{home:'overview',pages:['overview','explorer','activity']},reviewer:{home:'oversight',pages:['overview','oversight','audit','connections','monitor','comparison','contracts','reports','standards','gate','notifications','activity']}};
for(const [role,expected]of Object.entries(expectations))test(role+' lands correctly, sees its own menu and resets old-session state',async()=>{
 const elements=new Map();const element=s=>{if(!elements.has(s))elements.set(s,{innerHTML:'',style:{},open:false,addEventListener(){},showModal(){},close(){}});return elements.get(s)};
 const doc={querySelector:element,addEventListener(){}};const user={id:role,role,name:role,tenant:role==='bank'?'bank-demo':role};
 const w=workspacePayload(user,services);if(role==='bank')w.connections.push({id:'mock-bog',name:'BOG bank <demo>',tenant:'bank-demo',synthetic:true,status:'mock_configured',profile:'p',capabilities:{accounts:'mock_supported'}});const fetch=async url=>({ok:true,json:async()=>url==='/api/me'?{user,csrf:'new-csrf'}:url==='/api/events'?[]:w});
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('document','fetch','setInterval','setTimeout','clearTimeout',code+'\nreturn {state,render,activateSession,clearSession,policy,roleNav,navigate};');
 const ui=await run(doc,fetch,()=>{},()=>{},()=>{});
 assert.equal(ui.state.page,expected.home);assert.deepEqual(ui.roleNav().map(x=>x[0]),expected.pages);
 const html=element('#app').innerHTML;assert.equal(html.includes('data-nav="diagnostics"'),role==='operator');
 if(role==='standards'){assert(html.includes('Standards & rules'));assert(!html.includes('data-nav="audit"'));assert(!html.includes('data-action="new-run"'));}
 if(role==='tpp'){assert(html.includes('Common API access'));assert(!html.includes('data-nav="standards"'));assert(!html.includes('data-nav="audit"'));}
 if(role==='reviewer'){assert(html.includes('Oversight dashboard'));assert(html.includes('data-nav="gate"'));}
 for(const page of expected.pages){ui.navigate(page);const view=element('#app').innerHTML;assert(view.length>1000,page);if(role==='bank'&&page==='connections'){assert(!view.includes('Register sandbox'));assert(!view.includes('Upload OpenAPI'));assert(!view.includes('Sandbox URL'))}if(role==='bank'&&page==='audit'){assert(view.includes('BOG bank &lt;demo&gt;'));assert(view.includes('Profile: p'));assert(view.includes('Synthetic mock'));assert(!view.includes('data-nav="connections"'))}if(role==='bank'&&page==='overview')assert(!view.includes('Connections within your authorized scope'))}
 if(role!=='operator'){ui.state.page='diagnostics';ui.render();assert.equal(ui.state.page,expected.home)}
 ui.state.run={id:'previous-user-private-run'};ui.activateSession({user,csrf:'replacement'});assert.equal(ui.state.run,null);assert.equal(ui.state.page,expected.home);assert.equal(ui.state.csrf,'replacement');
 ui.clearSession();assert.equal(ui.state.workspace,null);assert.equal(ui.state.run,null);assert.equal(ui.state.csrf,'');
});
