import {createHash} from 'node:crypto';
const titles={contract_schema_changed:'Bank API schema changed',contract_response_mismatch:'Bank response violates the approved contract',contract_mapping_proposed:'Adapter mapping proposed',contract_mapping_tested:'Adapter mapping test completed',contract_mapping_approved:'Adapter mapping meaning approved',contract_mapping_activated:'Adapter mapping activated',contract_mapping_rolled_back:'Adapter mapping rolled back',contract_policy_approved:'Automatic mapping policy approved',contract_policy_enabled:'Automatic mapping policy enabled',contract_policy_disabled:'Automatic mapping policy disabled',contract_policy_succeeded:'Pre-approved mapping activated automatically',contract_policy_failed:'Automatic mapping stopped — review required'};
export function createNotifications({all,get,put,clock=Date.now}){
 const listeners=new Map();
 const allowed=u=>u&&!u.disabled&&['operator','reviewer','bank'].includes(u.role);
 function list(user){if(!allowed(user))throw Object.assign(Error('Notifications unavailable for this role'),{status:403});const rows=all('inbox').filter(x=>x.userId===user.id&&x.tenant===user.tenant).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));return {items:rows.slice(0,50),unread:rows.filter(x=>!x.readAt).length,channel:'in_app',email:'not_configured'};}
 function publish(user){for(const fn of listeners.get(user.id)||[])try{fn(list(user))}catch{/* Reconnect reads the durable inbox. */}}
 return {
  list,
  deliver(eventId,action,target,detail={}){
   if(!titles[action])return;
   const cid=detail.connectionId||get('contract_candidates',target)?.connectionId||get('contract_policies',target)?.connectionId||target;
   const outboxId=String(eventId);if(!get('notification_outbox',outboxId))put('notification_outbox',{id:outboxId,action,target,detail:{connectionId:cid},status:'pending',createdAt:new Date(clock()).toISOString()});
   const bank=get('connections',cid);if(!bank)return;
   for(const user of all('users').filter(u=>allowed(u)&&(u.role!=='bank'||u.tenant===bank.tenant))){
    const id=createHash('sha256').update(JSON.stringify([String(eventId),user.id])).digest('hex');if(get('inbox',id))continue;
    put('inbox',{id,userId:user.id,tenant:user.tenant,connectionId:cid,bankName:bank.name,title:titles[action],action,createdAt:new Date(clock()).toISOString(),deliveredAt:new Date(clock()).toISOString(),readAt:null,channel:'in_app',targetPage:user.role==='bank'?'audit':'contracts',synthetic:bank.synthetic===true});publish(user);
   }
   put('notification_outbox',{...get('notification_outbox',outboxId),status:'delivered',deliveredAt:new Date(clock()).toISOString()});
  },
  tick(){for(const row of all('notification_outbox').filter(x=>x.status==='pending'))this.deliver(row.id,row.action,row.target,row.detail);},
  read(user,id){const row=get('inbox',id);if(!allowed(user)||!row||row.userId!==user.id||row.tenant!==user.tenant)throw Object.assign(Error('Notification not found'),{status:404});if(!row.readAt)put('inbox',{...row,readAt:new Date(clock()).toISOString()});publish(user);return {ok:true};},
  subscribe(user,fn){if(!allowed(user))throw Object.assign(Error('Notifications unavailable'),{status:403});const set=listeners.get(user.id)||new Set();if(set.size>=3)throw Object.assign(Error('Too many notification streams'),{status:429});set.add(fn);listeners.set(user.id,set);return ()=>{set.delete(fn);if(!set.size)listeners.delete(user.id)};}
 };
}
