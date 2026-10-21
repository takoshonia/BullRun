import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
export const id=()=>crypto.randomUUID();
export const sha=s=>crypto.createHash('sha256').update(typeof s==='string'?s:JSON.stringify(s)).digest('hex');
export function passwordHash(p,salt=crypto.randomBytes(16).toString('hex')){return salt+':'+crypto.scryptSync(p,salt,32).toString('hex')}
export function passwordMatch(p,h){try{const [s,v]=h.split(':');return crypto.timingSafeEqual(Buffer.from(v,'hex'),Buffer.from(passwordHash(p,s).split(':')[1],'hex'))}catch{return false}}
export function redact(value){
 const walk=(v,k='')=> /authorization|cookie|password|token|secret|private.?key|signature|iban|pan$|personal.?number|ownername/i.test(k)?'[REDACTED]':Array.isArray(v)?v.map(x=>walk(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([a,b])=>[a,walk(b,a)])):typeof v==='string'?v.replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]').replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g,'[REDACTED KEY]').replace(/\bGE\d{2}[A-Z0-9]{18}\b/g,'[REDACTED IBAN]'):v;
 return walk(value);
}
export function isPublicIP(ip){
 if(net.isIPv4(ip)){const p=ip.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&[0,168].includes(p[1])||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&[18,19,51].includes(p[1])||p[0]===203&&p[1]===0)}
 if(net.isIPv6(ip)){const s=ip.toLowerCase();return s.startsWith('2')||s.startsWith('3')}
 return false;
}
export function allowedURL(input,allowed=[]){let u;try{u=new URL(input)}catch{throw Error('Invalid URL')}
 if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port&&u.port!=='443')throw Error('Only HTTPS on port 443 without credentials or fragments');
 if(!allowed.includes(u.hostname.toLowerCase()))throw Error('Host is not operator-allowlisted');
 if(net.isIP(u.hostname)&&!isPublicIP(u.hostname))throw Error('Private network targets denied');return u;
}
export async function validateTarget(input,allowed){const u=allowedURL(input,allowed);const ips=await dns.lookup(u.hostname,{all:true});if(!ips.length||ips.some(x=>!isPublicIP(x.address)))throw Error('DNS resolves to a prohibited address');return {url:u,addresses:ips}}
export function authorized(user,tenant){return user.tenant===tenant||user.role==='operator'||user.role==='reviewer'&&tenant.startsWith('bank-')}
export function canUseConsent(c,user,connection,operation,account){return !!c&&c.tenant===user.tenant&&c.connection===connection&&c.status==='valid'&&Date.parse(c.expires)>Date.now()&&c.operations.includes(operation)&&(!account||c.accounts.includes(account))}
export function decimalString(v){if(typeof v!=='string'||! /^-?\d+(\.\d+)?$/.test(v))throw Error('Exact decimal string required');return v}
export function normalize(operation,body){
 if(operation==='accounts'){if(!Array.isArray(body.accounts))throw Error('accounts array missing');if(new Set(body.accounts.map(x=>x.resourceId)).size!==body.accounts.length)throw Error('Duplicate account identifiers');return {accounts:body.accounts.map(x=>{if(typeof x.resourceId!=='string'||!x.resourceId||! /^[A-Z]{3}$/.test(x.currency||''))throw Error('Required account fields missing');return {accountId:x.resourceId,currency:x.currency,name:x.displayName||x.name||null,cashAccountType:x.cashAccountType||null}})}}
 if(operation==='balances'){if(!Array.isArray(body.balances))throw Error('balances array missing');return {balances:body.balances.map(x=>{const b=x.balanceAmount;if(!b||! /^[A-Z]{3}$/.test(b.currency||'')||!x.balanceType)throw Error('Required balance fields missing');return {amount:decimalString(b.amount),currency:b.currency,balanceType:x.balanceType,referenceDate:x.referenceDate??null}})}}
 if(operation!=='transactions')throw Error('Unsupported common operation');
 const t=body.transactions;if(!t||!Array.isArray(t.booked)||!Array.isArray(t.pending))throw Error('booked and pending arrays required');
 if(Object.keys(t).some(k=>!['booked','pending'].includes(k)&&Array.isArray(t[k])))throw Error('Unmapped transaction category; explicit adapter review required');
 return {transactions:[...t.booked.map(x=>[x,'booked']),...t.pending.map(x=>[x,'pending'])].map(([x,status])=>{if(!x.transactionId||! /^[A-Z]{3}$/.test(x.transactionAmount?.currency||''))throw Error('Required transaction fields missing');return {transactionId:x.transactionId,amount:decimalString(x.transactionAmount.amount),currency:x.transactionAmount.currency,status,bookingDate:x.bookingDate??null,valueDate:x.valueDate??null}})};
}
export function percentile(values,q){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b);return s[Math.max(0,Math.ceil(q*s.length)-1)]}
export function metrics(samples){const positive=samples.filter(s=>s.kind==='positive');const success=positive.filter(s=>s.outcome==='success');return {attempts:positive.length,successes:success.length,errors:positive.filter(s=>s.outcome==='error').length,timeouts:positive.filter(s=>s.outcome==='timeout').length,rateLimited:positive.filter(s=>s.outcome==='rate_limited').length,successRate:positive.length?success.length/positive.length:null,p50:percentile(success.map(s=>s.durationMs),.5),p95:success.length>=20?percentile(success.map(s=>s.durationMs),.95):null,limitedSample:success.length<30}}
