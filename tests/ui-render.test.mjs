import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assurance} from '../src/assurance.mjs';
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('all workspace views render without template exceptions; unsafe names are escaped',async()=>{
 const elements=new Map();const element=selector=>{if(!elements.has(selector))elements.set(selector,{innerHTML:'',style:{},addEventListener(){},showModal(){},close(){}});return elements.get(selector)};
 const doc={querySelector:element,addEventListener(){}};
 const user={id:'operator',name:'Platform operator',tenant:'platform',role:'operator'};
 const run={id:'run-1',name:'<img src=x onerror=alert(1)>',profile:'platform',status:'completed',kind:'platform',results:assurance(),counts:{PASS:25},metrics:[],evidenceMode:'local_platform_controls',createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),rulesetHash:'abc',build:'0.1.0'};
 const w={user,connections:[{id:'c1',name:'Pending connection',tenant:'bank-demo',profile:'xs2a-0.8',status:'not_connected',environment:'pending',capabilities:{accounts:'unknown'}}],runs:[run],packs:[],profiles:[{id:'platform',name:'Platform',status:'active',note:'Engineering controls'}],rules:[],sources:[],schedules:[],gates:[],updates:[],ai:{configured:false}};
 const fetch=async url=>({ok:true,json:async()=>url==='/api/me'?{user,csrf:'test'}:url==='/api/events'?[]:w});
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const execute=new AsyncFunction('document','fetch','setInterval','setTimeout','clearTimeout',code+'\nreturn {state,render};');
 const ui=await execute(doc,fetch,()=>{},()=>{},()=>{});
 for(const page of ['overview','audit','connections','explorer','monitor','reports','standards','gate','activity','detail']){
  ui.state.page=page;ui.state.run=run;ui.render();const html=element('#app').innerHTML;assert(html.length>1500,page);assert(!html.includes('<img src=x'),page+' must escape imported names');assert(!html.includes('NaN'),page+' should not invent missing metrics');
 }
 ui.state.availability=[{id:'gringott',name:'<script>bad</script>',canSwitch:true,report:{enabled:true,currentStatus:'down',checks:4,successes:2,successfulChecksPercent:50,estimatedUptimePercent:40,coveragePercent:75,estimatedDownMs:9000,unknownMs:3000,lastCheck:{at:Date.now()},intervalSeconds:5,timeoutSeconds:1}}];
 for(const page of ['monitor','reports']){ui.state.page=page;ui.render();const html=element('#app').innerHTML;assert(html.includes('availability-report'));assert(html.includes('API OFF (timeout)'));assert(html.includes('50.00%'));assert(!html.includes('<script>bad'))}
 ui.state.workspace.catalog=[{id:'mock-gringott',name:'Gringott <script>bad</script>',status:'mock_configured',capabilities:{accounts:'mock_supported'}}];
 ui.state.page='explorer';ui.render();assert(element('#app').innerHTML.includes('Grant simulated consent'));
 ui.state.gringott={connection:'mock-gringott',consentId:'private-reference',expiresAt:new Date().toISOString(),accounts:[{accountId:'<script>bad</script>',currency:'GEL'}]};
 ui.render();assert(element('#app').innerHTML.includes('All transaction pages'));assert(!element('#app').innerHTML.includes('<script>bad'));
});
