import {randomBytes,createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function createDemoAccess({get,put,event,now=Date.now}){
 const valid=grant=>grant&&!grant.revokedAt&&Number.isFinite(grant.expires)&&grant.expires>now()&&get('users',grant.userId)?.role==='operator'&&!get('users',grant.userId)?.disabled;
 return {
  issue(userId='operator'){
   const user=get('users',userId);if(!user||user.role!=='operator'||user.disabled)throw Error('An enabled Operator account is required');
   const token=randomBytes(32).toString('base64url'),grant={id:hash(token),userId,createdAt:new Date(now()).toISOString(),expires:now()+48*3600000};
   put('demo_access',grant);event(userId,'demo_access_created',grant.id,{expiresAt:new Date(grant.expires).toISOString()});return {token,id:grant.id,expiresAt:new Date(grant.expires).toISOString()};
  },
  redeem(token){
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
   const grant=get('demo_access',hash(token));if(!valid(grant))return null;
   return {grant,user:get('users',grant.userId),expires:Math.min(grant.expires,now()+8*3600000)};
  },
  bind(sessionHash,grant){put('demo_access_sessions',{id:sessionHash,grantId:grant.id});},
  sessionValid(sessionHash){const binding=get('demo_access_sessions',sessionHash);return !binding||Boolean(valid(get('demo_access',binding.grantId)));},
  revoke(id){const grant=get('demo_access',id);if(!grant)throw Error('Demo access link not found');put('demo_access',{...grant,revokedAt:new Date(now()).toISOString()});event('operator','demo_access_revoked',id);}
 };
}
