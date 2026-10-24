import {bankStandardCandidates} from './bank-standard-candidates.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {root,all,put} from './store.mjs';
import {sha} from './security.mjs';
export const profiles=[
 {id:'xs2a-0.8',name:'Payment accounts · XS2A 0.8.RC3',status:'needs_review',scope:'Payment-account AIS',note:'Index.xlsx points to legacy XS2A 0.8.RC3. Legacy XS2A, IAA and JWS snapshots are pinned. Confirm assigned sandbox applicability and review rules before activation.'},
 {id:'ofa-ais',name:'Loans & deposits · openFinance AIS',status:'reviewed_scope',scope:'Loans and term deposits',note:'AIS 0.1.0-20240808 + CONS 0.1.0-20240619 + Common 2.0.0 + Domestic 1.0.1. Confirm assigned sandbox applicability.'},
 {id:'platform',name:'GeoBridge platform controls',status:'active',scope:'Internal assurance',note:'Engineering assertions, not a bank compliance certificate.'}
];
const sourceNames={xs2a:'XS2A-0.8.RC3',iaa:'IAA-0.8.RC1',jws:'JWS-0.5.RC1',payments:'GBA oFA Payments Implementation Guide 1.2.0',push:'GBA oFA Push AIS 0.1.0-20251208',identity:'GBA oFA Identity Assurance 0.4.1-20250419',ais:'GBA oFA Account Information Service Implementation Guide 0.1.0-20240808',cons:'GBA oFA Consents Implementation Guide 0.1.0-20240619',common:'GBA oFA Common Protocol Features 2.0.0',dom:'GBA oFA Domestic Definitions 1.0.1'};
const candidates=[
 ['XS2A-JSON','Legacy response supports JSON','xs2a','7.2','ამ დოკუმენტთან თავსებადობის მიზნებისათვის აუცილებელია, მხარდაჭერილი იყოს მოთხოვნისა და პასუხის JSON ფორმატი.','all','Support JSON on the assigned legacy interface.'],
 ['XS2A-REQUEST-ID','Legacy client request ID is a UUID','xs2a','7.7','ყველა API მოთხოვნას, რომელიც აღწერილია (2)-ით და მხარდაჭერილია წინამდებარე დოკუმენტით, აუცილებელია მიჰყვებოდეს HTTP სათაური X-Request-ID, რომელიც არის UUID ტიპის.','all','Send a UUID request header. Replay semantics need independent lifecycle tests.'],
 ['AIS-RESOURCE','Resource identifier present','ais','5.3','აუცილებელია რესურსის იდენტიფიკატორი იყოს ტოკენიზებული, ანუ შეუძლებელი იყოს მისგან ანგარიშის იდენტიფიკატორის (მაგ. Iban-ის) აღდგენა.','accounts','Use an opaque bank-scoped identifier. Presence alone does not prove one-way tokenization.'],
 ['AIS-CURRENCY','Account currency present','ais','5.5.1','currency','accounts','Return the applicable Currency Code; XXX is reserved for the aggregate multicurrency account.'],
 ['AIS-OWNER','No unsolicited owner name','ais','5.5.1','ownerName','accounts','Do not expose ownerName. ownerNames requires explicit permission and separate checks.'],
 ['AIS-DETAILS','Blocked reason only on blocked accounts','ais','5.5.1','details','accounts','Return details only when status is blocked, and include the blocking reason.'],
 ['AIS-TYPE','Account category supplied','ais','5.5.1','cashAccountType','accounts','Return the correct LOAN or SVGS category in this supported profile.'],
 ['AIS-BIC','BIC supplied','ais','5.5.1','bic','accounts','Return the required BIC. Syntax checking is not directory verification.'],
 ['AIS-NO-INLINE','Loan/deposit balances use dedicated operation','ais','5.5.1','ელემენტი არავითარ შემთხვევაში არ უნდა დაბრუნდეს. აუცილებელია ნაშთები გაიცეს შესაბამისი API გამოძახებების ფარგლებში.','accounts','Omit inline balances from the loan/deposit accounts list.'],
 ['COMMON-JSON','Response uses JSON','common','4.2','ამ დოკუმენტთან თავსებადობის მიზნებისათვის აუცილებელია, მხარდაჭერილი იყოს მოთხოვნისა და პასუხის JSON ფორმატი.','all','Support JSON requests and responses.'],
 ['COMMON-TYPE','Error type avoids forbidden prefix','common','4.2','პასუხის დაბრუნებისას ამსმპ-მა არავითარ შემთხვევაში არ უნდა გამოიყენოს პრეფიქსი "https://berlingroup.com/error-codes/" ველში type.','all','Use the bank documentation URI; do not automatically fetch error links.'],
 ['COMMON-REQUEST-ID','Request identifier is a UUID','common','4.5','ყველა API მოთხოვნას, რომელიც აღწერილია ამ დოკუმენტით, აუცილებელია მიჰყვებოდეს HTTP თავსართი X-Request-ID, რომელიც არის UUID ტიპის.','all','Send a UUID X-Request-ID. This is a client assertion, not proof of server idempotency.'],
 ['DOM-LOAN','Loan principal is negative','dom','7.2.1','ათვისებული თანხა (ე.წ. „ძირი“), აუცილებელია თანხა იყოს უარყოფითი.','balances','Return loan principal using the applicable negative amount and balance subtype.'],
 ['DOM-DEPOSIT','Deposit amount is nonnegative','dom','7.3.1','თანხა დეპოზიტზე, აუცილებელია თანხა იყოს არაუარყოფითი.','balances','Preserve the nonnegative deposit balance.'],
 ['CONS-REVOKED','Revoked consent denies access','cons','7.1.1','CONSENT_INVALID','consent','Requires a controlled lifecycle and source-specific error mapping; capture review cannot execute revocation.'],
 ['CONS-COEXIST','Conditional old/new consent coexistence','cons','10.1','NextGenPSD2 XS2A 1.3.x','consent','Only applicable when both interfaces and eligible account categories are supported.']
];
export function seedBankStandardDrafts(){
 const file='XS2A-0.8.RC3.txt',text=fs.readFileSync(path.join(root,'sources',file),'utf8');
 const start=text.indexOf('GET /v1/accounts {query-parameters}'),end=text.indexOf('ანგარიშის დეტალები',start);const table=text.slice(start,end>start?end:undefined);
 for(const candidate of bankStandardCandidates){if(all('rules').some(r=>r.id===candidate.id))continue;
 const rows=table.split('\n'),rowIndex=rows.findIndex((row,i)=>row.trim()===candidate.field&&rows[i+1]?.trim()===candidate.sourceType&&rows[i+2]?.trim()===candidate.requirement);const quote=rowIndex>=0?rows.slice(rowIndex,rowIndex+3).join('\n'):candidate.field;
 put('rules',{id:candidate.id,title:candidate.title,profile:'xs2a-0.8',layer:'compatibility',basis:'standard_candidate',source:file,sourceHash:sha(text),section:'9.3.3 — GET /v1/accounts, '+candidate.field+' table row',quote,quoteVerified:rowIndex>=0,status:'draft',operation:'accounts',fix:candidate.fix,severity:'medium',reviewNote:'Full table-row review required. Applies to legacy payment-account AIS only; do not apply to Open Finance /v2, loan/deposit AIS, or card-account lists. Independent mock results are not real-bank findings. Field syntax/presence is the only implemented assertion.',bankApplicability:['TBC Bank','Bank of Georgia'],normativeSourceUrl:'https://cdn.association.ge/static/openbanking/standards/pdf/NextGenPSD2_XS2A_Implementation_Guide_0.8.RC3_hL6sJdA.pdf',references:[{bank:'TBC Bank',url:'https://developers.tbcbank.ge/reference/aisreadaccountlist',label:'TBC — payment-account AIS /0.8/v1/accounts'},{bank:'Bank of Georgia',url:'https://api.bog.ge/docs/en/openapi/openbanking.yaml',label:'BOG — NextGenPSD2 XS2A Framework v0.8 OpenAPI'}],verifiedAt:'2026-10-24',createdAt:new Date().toISOString()});
 }
}
export function initRules(){seedBankStandardDrafts();for(const [id,title,key,section,quote,operation,fix]of candidates){if(all('rules').some(r=>r.id===id))continue;
 const file=sourceNames[key]+'.txt',p=path.join(root,'sources',file);const text=fs.readFileSync(p,'utf8');let verified=text.includes(quote);const short=['currency','ownerName','details','cashAccountType','bic','CONSENT_INVALID','NextGenPSD2 XS2A 1.3.x'].includes(quote);
 put('rules',{id,title,profile:key==='xs2a'?'xs2a-0.8':'ofa-ais',layer:'compatibility',basis:'standard_candidate',source:file,sourceHash:sha(text),section,quote,quoteVerified:verified,reviewNote:short?'Field/table locator: human reviewer must inspect the complete row and conditions.':'Exact extracted source clause; human applicability review required.',status:'draft',operation,fix,severity:id==='AIS-OWNER'?'high':'medium',createdAt:new Date().toISOString()});}
}
export function sourceRegistry(){return Object.entries(sourceNames).map(([key,name])=>{const file=name+'.txt',t=fs.readFileSync(path.join(root,'sources',file),'utf8');return {id:key,name,file,sha256:sha(t),characters:t.length}})}
