// Georgian XS2A payment-account AIS checks. Draft seeding is handled by rules.mjs.
export const bankStandardCandidates=[
 {id:'XS2A-ACCOUNT-IBAN',title:'Payment-account list: IBAN is required',field:'iban',kind:'iban',sourceType:'IBAN',requirement:'სავალდებულო',fix:'Return an IBAN in each payment-account list item. Confirm the assigned bank interface is the legacy XS2A profile.'},
 {id:'XS2A-ACCOUNT-CURRENCY',title:'Payment-account list: currency is required',field:'currency',kind:'currency',sourceType:'Currency Code',requirement:'სავალდებულო',fix:'Return a three-letter currency code. XXX is allowed for an aggregate multicurrency account; this check does not verify that account classification.'},
 {id:'XS2A-ACCOUNT-TYPE',title:'Payment-account list: cashAccountType is required',field:'cashAccountType',kind:'type',sourceType:'Cash Account Type',requirement:'სავალდებულო',fix:'Return the applicable cashAccountType. CACC/CARD are recommendations in this table, not an unconditional two-value whitelist.'},
 {id:'XS2A-ACCOUNT-BIC',title:'Payment-account list: BIC is required',field:'bic',kind:'bic',sourceType:'BICFI',requirement:'სავალდებულო',fix:'Return an 8- or 11-character BIC. Syntax alone does not establish bank-directory membership.'},
 {id:'XS2A-ACCOUNT-NO-BBAN',title:'Payment-account list: bban must be omitted',field:'bban',kind:'forbidden',sourceType:'BBAN',requirement:'არავითარ შემთხვევაში',fix:'Omit bban entirely, including null values, from payment-account list items.'},
 {id:'XS2A-ACCOUNT-NO-LINKED',title:'Payment-account list: linkedAccounts must be omitted',field:'linkedAccounts',kind:'forbidden',sourceType:'Max70Text',requirement:'არავითარ შემთხვევაში',fix:'Omit linkedAccounts entirely from payment-account list items.'}
];
export function evaluateBankStandard(rule,observation){
 const candidate=bankStandardCandidates.find(r=>r.id===rule.id);if(!candidate)return null;
 const expected=candidate.kind==='forbidden'?candidate.field+' is absent':candidate.field+' is present with valid basic syntax';
 if(observation.operation!=='accounts'||observation.status<200||observation.status>=300)return {verdict:'NOT_APPLICABLE',expected,observed:'Requires a successful GET /v1/accounts response.'};
 const accounts=observation.body?.accounts;
 if(!Array.isArray(accounts))return {verdict:'FAIL',expected:'An accounts array',observed:'The accounts array is missing or malformed.'};
 if(!accounts.length)return {verdict:'NOT_APPLICABLE',expected,observed:'Empty account list; no field values to assess.'};
 const valid=item=>{if(!item||typeof item!=='object'||Array.isArray(item))return false;if(candidate.kind==='forbidden')return !Object.hasOwn(item,candidate.field);const value=item[candidate.field];if(typeof value!=='string')return false;switch(candidate.kind){case 'iban':return /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(value);case 'currency':return /^[A-Z]{3}$/.test(value);case 'type':return /^[A-Z0-9]{4}$/.test(value);case 'bic':return /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value);default:return false}};
 const invalid=accounts.filter(item=>!valid(item)).length;
 return {verdict:invalid?'FAIL':'PASS',expected,observed:invalid?invalid+' of '+accounts.length+' account items violate the selected field check.':accounts.length+' account items satisfy the selected field check.',assessmentLimit:'Field presence/basic syntax only; no IBAN checksum, currency/BIC directory, consent completeness, account classification, or bank certification is established.'};
}
