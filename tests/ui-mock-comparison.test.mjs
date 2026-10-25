import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
async function load(role){const nodes=new Map(),element=k=>{if(!nodes.has(k))nodes.set(k,{innerHTML:'',style:{},open:false,addEventListener(){},close(){},showModal(){}});return nodes.get(k)};const document={querySelector:element,querySelectorAll:()=>[],addEventListener(){}};const user={id:role,role,name:role,tenant:role==='bank'?'bank-bog':role};const w={connections:[{id:'mock-bog',name:'BOG <script>',synthetic:true,status:'mock_configured',profile:'p',capabilities:{}}],runs:[],rules:[],sources:[],profiles:[],packs:[],schedules:[],gates:[],savedReports:[],ai:{configured:false}};const fetch=async url=>({ok:true,json:async()=>url==='/api/me'?{user,csrf:'csrf'}:url==='/api/events'?[]:url==='/api/mock-demo'?{targets:[],controls:[]}:w});const Fn=Object.getPrototypeOf(async function(){}).constructor;return new Fn('document','fetch','setInterval','setTimeout','clearTimeout',code+'\nreturn {state,mockComparison,roleNav,qualityValue,sharedCheckTable,batchExplorer,contractChanges,contractBankCard,overviewCategoryRows,contractPushPanel};')(document,fetch,()=>{},()=>{},()=>{});}
test('comparison is visible only to Operator/NBG and renders escaped results and pending measurements',async()=>{
 for(const role of ['operator','reviewer','bank','tpp']){const ui=await load(role);assert.equal(ui.roleNav().some(x=>x[0]==='comparison'),['operator','reviewer'].includes(role));if(!['operator','reviewer'].includes(role))continue;
 ui.state.comparisons=[{suiteVersion:'test',createdAt:new Date().toISOString(),comparable:false,comparabilityReason:'Different workload',rows:[{runId:'audit',connectionId:'mock-bog',status:'queued',error:'<script>',quality:null}]}];
 const html=ui.mockComparison();for(const label of ['Compatibility','Security','Reliability','Latency','Awaiting measurements','Comparison limited','not real-bank ratings'])assert(html.includes(label));assert(html.includes('BOG &lt;script&gt;'));assert(!html.includes('<script>'));assert.equal(ui.qualityValue(null),'Not measured');
 }
});

test('shared check table displays escaped evidence for each bank without presenting drafts as passes',async()=>{
 const ui=await load('operator');const html=ui.sharedCheckTable({rows:[{connectionId:'mock-bog'},{connectionId:'mock-tbc'}],checks:[{title:'Revoked consent',layer:'security',key:'mock:REVOKED',different:true,explanation:'Verdicts differ',cells:[{verdict:'FAIL',count:1,expected:['401 or 403'],observed:['HTTP 200 <script>']},{verdict:'PASS',count:1,expected:['401 or 403'],observed:['HTTP 403']}]},{title:'Draft',layer:'compatibility',key:'rule:1',different:false,explanation:'Same verdict',cells:[{verdict:'NEEDS_REVIEW',count:1,expected:['Review'],observed:['Draft']},{verdict:'NEEDS_REVIEW',count:1,expected:['Review'],observed:['Draft']}]}]});
 for(const text of ['Different verdicts','Expected','Observed','HTTP 403','HTTP 200 &lt;script&gt;','Needs review'])assert(html.includes(text),text);assert(!html.includes('<script>'));
});

test('TPP batch selectors use the public mock catalog without private synthetic flags',async()=>{
 const ui=await load('tpp');ui.state.workspace.catalog=[{id:'mock-bog',name:'BOG <script>',status:'mock_configured'},{id:'mock-gringott',name:'Gringott',status:'mock_configured'},{id:'pending',name:'Private setup',status:'not_connected'}];const html=ui.batchExplorer();assert(html.includes('name="batch-bank" type="checkbox" value="mock-bog"'));assert(html.includes('name="batch-bank" type="checkbox" value="mock-gringott"'));assert(!html.includes('Private setup'));assert(!html.includes('<script>'));
});

test('adapter review cards hide irrelevant actions and gate proposals on current bank evidence',async()=>{
 const ui=await load('operator');const target={id:'mock-gringott',name:'Gringott mock'},snapshot={id:'s',connectionId:target.id,hash:'abc',sequence:1,fetchedAt:'2026-10-25T00:00:00Z'};
 const v={snapshots:[snapshot],scans:[{id:target.id,snapshotId:'s',status:'ok'}],baselines:[],demo:[],active:[],changes:[],mismatches:[]};
 let html=ui.contractBankCard(v,target,true);for(const text of ['Initial schema captured — awaiting NBG review.','Using the default Gringott adapter.','Schema captured — no changes detected.'])assert(html.includes(text));for(const text of ['Rollback','Ask AI','Propose'])assert(!html.includes(text));
 v.changes=[{connectionId:target.id,to:'old',changes:[{kind:'removed',path:'/properties/amount',commonOperation:'balances'},{kind:'added',path:'/properties/sum',commonOperation:'balances'}]}];assert(!ui.contractBankCard(v,target,true).includes('Ask AI'));
 v.changes[0].to='s';html=ui.contractBankCard(v,target,true);assert(html.includes('Ask AI'));assert(html.includes('data-source="sum"'));assert(!html.includes('Rollback'));
 v.active=[{id:target.id,candidateId:'candidate'}];html=ui.contractBankCard(v,target,true);assert(html.includes('Rollback'));assert(!html.includes('Ask AI'));assert(!ui.contractBankCard(v,target,false).includes('Rollback'));
 v.active=[];v.changes=[];v.baselines=[{id:target.id,snapshotId:'s'}];v.mismatches=[{connectionId:target.id,snapshotId:'s',operation:'balances',createdAt:'2026-10-25T01:00:00Z',errors:['$.balances[0].balanceAmount.amount: required field missing'],sourceFields:['sum']}];assert(ui.contractBankCard(v,target,true).includes('Ask AI'));
 assert(ui.roleNav().some(([id,label])=>id==='contracts'&&label==='API changes & adapter review'));
});

test('Overview shows server category counts and distinguishes missing summaries from unassessed layers',async()=>{
 const ui=await load('operator');const html=ui.overviewCategoryRows({categorySummary:{compatibility:{total:3,counts:{PASS:1,FAIL:1,BLOCKED:1}},security:{total:1,counts:{NEEDS_REVIEW:1}},latency:{total:0,counts:{}}}});
 for(const text of ['1 passed','1 failed','1 blocked','1 needs review','Not assessed in this audit','Category summary unavailable'])assert(html.includes(text),text);assert(!html.includes('No checks recorded'));
});

test('push notifications are clearly synthetic and publisher controls remain Operator-only',async()=>{
 const ui=await load('operator'),target={id:'mock-bog',name:'BOG mock'},v={snapshots:[{id:'s',connectionId:'mock-bog',hash:'safe'}],scans:[{id:'mock-bog',snapshotId:'s'}],baselines:[],active:[],changes:[],mismatches:[],demo:[],push:{configuredBanks:['mock-bog'],demoControls:['mock-bog'],deliveries:[{connectionId:'mock-bog',revision:'<script>',status:'processed',receivedAt:'2026-10-25T00:00:00Z',processedAt:'2026-10-25T00:00:01Z'}]}};
 const op=ui.contractBankCard(v,target,true),nbg=ui.contractBankCard(v,target,false);assert(op.includes('Publish mock field change'));assert(op.includes('Restore mock field'));assert(!op.includes('Enable synthetic field change'));assert(!nbg.includes('Publish mock field change'));const html=ui.contractPushPanel(v);assert(html.includes('Signature verified'));assert(html.includes('Automatic scan'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));
});
