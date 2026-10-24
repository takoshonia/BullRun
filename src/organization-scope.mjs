// Preserve explicitly separated tenants; split the legacy shared demo target by bank.
export function targetTenant(target){
 if(target.tenant&&target.tenant!=='bank-demo')return target.tenant;
 const adapter=target.adapter|| (target.id==='gringott'?'gringott-mock-v1':'');
 return ({'bog-mock-v1':'bank-bog','tbc-mock-v1':'bank-tbc','gringott-mock-v1':'bank-gringott'})[adapter]||'bank-demo';
}
