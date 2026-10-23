// Configuration preflight. Mock audits establish their own simulated consent.
export function bankReadiness(connection,targets=[]){
 const target=targets.find(t=>t.id===connection.id&&t.adapter===connection.adapter);
 if(target)return {ready:true,mode:'synthetic_mock',reasons:[],authorization:'Simulated consent is created and validated during the audit; no real-bank credentials are used.'};
 return {ready:false,mode:'not_connected',reasons:[{code:'ADAPTER_NOT_CONFIGURED',message:'No supported bank adapter is configured for this connection.'},{code:'CREDENTIALS_NOT_CONFIGURED',message:'Bank credentials and certificates have not been configured.'},{code:'CONSENT_NOT_AVAILABLE',message:'No authorized bank consent is available.'}]};
}
