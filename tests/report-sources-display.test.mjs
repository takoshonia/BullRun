import test from 'node:test';
import assert from 'node:assert/strict';
import {readableSource,renderReportDocument} from '../src/report-document.mjs';
import {snapshotAudit} from '../src/reports.mjs';
import {mockSource} from '../src/check-sources.mjs';

test('standard citation retains exact clause and field without hashes or build filenames',()=>{
 const text=readableSource({source:'XS2A-0.8.RC3.txt',section:'9.3.3 — GET /v1/accounts, currency table row',sourceHash:'fingerprint'});
 assert.equal(text,'XS2A 0.8 RC3 · §9.3.3 — GET /v1/accounts, currency table row');assert(!text.includes('fingerprint'));
});
test('mock and internal requirements cannot appear as normative bank standards',()=>{
 const f={...mockSource('bog-mock-v1','PAGINATION',{info:{version:'1'},paths:{'/v1/accounts/{id}/transactions':{get:{}}}}),basis:'mock_contract',title:'Pagination'};
 assert.match(readableSource(f),/GeoBridge mock contract · 1 · GET/);assert.match(readableSource(f),/not a bank standard/);assert(!readableSource(f).includes('.mjs'));
 assert.match(readableSource({basis:'platform_contract',title:'Common accounts mapping'}),/GeoBridge internal requirement/);
 assert.match(readableSource({...f,sourceReferences:[]}),/not captured/);
});
test('report keeps technical references only in dedicated provenance disclosure and escapes citations',()=>{
 const finding={...mockSource('bog-mock-v1','PAGINATION',null),id:'p',title:'Pagination <script>',basis:'mock_contract',verdict:'BLOCKED',observed:'Account mapping unavailable'};
 const snapshot=snapshotAudit({id:'audit',kind:'bank',status:'completed',results:[finding]});
 const html=renderReportDocument(snapshot,{id:'report',version:1});
 const before=html.split('<details class="technical">')[0];assert(!before.includes('mock-audit.mjs'));assert(!before.includes(finding.sourceHash));assert(html.includes(finding.sourceHash));assert(html.includes('mock-audit.mjs'));assert(!html.includes('<script>'));assert(html.includes('Pagination &lt;script&gt;'));
});
