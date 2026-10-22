export const contract={openapi:'3.1.0',info:{title:'GeoBridge Common AIS API',version:'0.1.0',description:'Common AIS contract. Two unofficial synthetic mock adapters are available with short-lived demo consent. Real bank operations remain blocked until configured.'},servers:[{url:'/'}],paths:{'/bridge/v1/connections':{get:{summary:'List published connection capabilities',responses:{200:{description:'Connection capability catalog'}}}},'/bridge/v1/connections/{connectionId}/accounts':{get:{summary:'List consented accounts',parameters:[{name:'connectionId',in:'path',required:true,schema:{type:'string'}},{name:'Consent-ID',in:'header',required:true,schema:{type:'string'}}],responses:{200:{description:'Bank-scoped account identifiers'},401:{description:'Unauthenticated'},403:{description:'Consent or tenant denied'},503:{description:'BANK_NOT_CONNECTED'}}}},'/bridge/v1/connections/{connectionId}/accounts/{accountId}/balances':{get:{summary:'Retrieve exact balances',parameters:[{name:'connectionId',in:'path',required:true,schema:{type:'string'}},{name:'accountId',in:'path',required:true,schema:{type:'string'}},{name:'Consent-ID',in:'header',required:true,schema:{type:'string'}}],responses:{200:{description:'Decimal-string amounts, original currencies and balance types'},422:{description:'UPSTREAM_CONTRACT_VIOLATION'},503:{description:'BANK_NOT_CONNECTED'}}}},'/bridge/v1/connections/{connectionId}/accounts/{accountId}/transactions':{get:{summary:'Retrieve transactions with preserved booking status',parameters:[{name:'connectionId',in:'path',required:true,schema:{type:'string'}},{name:'accountId',in:'path',required:true,schema:{type:'string'}},{name:'Consent-ID',in:'header',required:true,schema:{type:'string'}}],responses:{200:{description:'Booked and pending remain distinct'},422:{description:'UPSTREAM_CONTRACT_VIOLATION'},503:{description:'BANK_NOT_CONNECTED'}}}}},components:{schemas:{Balance:{type:'object',required:['amount','currency','balanceType'],properties:{amount:{type:'string',pattern:'^-?\\d+(\\.\\d+)?$'},currency:{type:'string',pattern:'^[A-Z]{3}$'},balanceType:{type:'string'},referenceDate:{type:['string','null'],format:'date'}}}}}};
// Bank integration boundary: implement per assigned contract, never infer endpoint names or auth.
export class BankAdapter {
 async capabilities(){throw Error('BANK_NOT_CONNECTED')}
 async createConsent(){throw Error('BANK_NOT_CONNECTED')}
 async consentStatus(){throw Error('BANK_NOT_CONNECTED')}
 async revokeConsent(){throw Error('BANK_NOT_CONNECTED')}
 async listAccounts(){throw Error('BANK_NOT_CONNECTED')}
 async getBalances(){throw Error('BANK_NOT_CONNECTED')}
 async listTransactions(){throw Error('BANK_NOT_CONNECTED')}
 async healthObservation(){throw Error('BANK_NOT_CONNECTED')}
}

contract.paths['/bridge/v1/connections/{connectionId}/consents']={post:{summary:'Create synthetic mock consent only',responses:{201:{description:'Short-lived synthetic consent; not real bank OAuth'},403:{description:'TPP identity required'}}}};
contract.paths['/bridge/v1/connections/{connectionId}/consents/{consentId}']={delete:{summary:'Revoke an owned synthetic consent',responses:{200:{description:'Revoked'},404:{description:'Consent not found'}}}};
for(const [route,item]of Object.entries(contract.paths)){
 for(const operation of Object.values(item)){
  if(!operation||typeof operation!=='object')continue;
  operation.parameters||=[];
  for(const name of [...route.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]))if(!operation.parameters.some(p=>p.in==='path'&&p.name===name))operation.parameters.push({name,in:'path',required:true,schema:{type:'string'}});
 }
}
