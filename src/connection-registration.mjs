import net from 'node:net';
export function validateRegistration(input,profiles){
 const errors={},data={},auth={};
 const text=(key,label,min=1,max=160)=>{const value=typeof input[key]==='string'?input[key].trim():'';if(value.length<min||value.length>max)errors[key]=`${label} must contain ${min}–${max} characters.`;data[key]=value;return value};
 const url=(key,label)=>{const value=text(key,label,1,500);try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||(u.port&&u.port!=='443')||u.hostname==='localhost'||!u.hostname.includes('.')||net.isIP(u.hostname))throw Error();}catch{errors[key]=`Enter a public HTTPS ${label.toLowerCase()} without credentials, query parameters, or fragments.`}return value};
 text('name','Connection name',3,100);text('bankName','Bank / institution name',2,120);
 const country=text('country','Country',2,2).toUpperCase();data.country=country;if(!/^[A-Z]{2}$/.test(country))errors.country='Use a two-letter country code, such as GE.';
 const email=text('contactEmail','Technical contact email',3,160);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))errors.contactEmail='Enter a valid technical contact email.';
 text('profile','API profile',1,80);if(!profiles.some(p=>p.id===data.profile&&p.id!=='platform'))errors.profile='Select a bank API profile.';
 url('baseUrl','API base URL');url('documentationUrl','Documentation URL');
 const method=text('authMethod','Authentication method',1,30);if(!['oauth2','oauth2_mtls','mtls','api_key'].includes(method))errors.authMethod='Select an authentication method.';
 auth.method=method;
 text('credentialReference','Credential reference',2,120);if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,119}$/.test(data.credentialReference))errors.credentialReference='Enter a secret-store reference, not a password or token.';auth.credentialReference=data.credentialReference;
 if(method.startsWith('oauth2')){auth.clientId=text('clientId','Client ID',1,160);auth.authorizationUrl=url('authorizationUrl','Authorization URL');auth.tokenUrl=url('tokenUrl','Token URL');auth.redirectUri=url('redirectUri','Redirect URI');const scopes=text('scopes','Requested scopes',1,300);if(!/^[a-zA-Z0-9._:/-]+(?: +[a-zA-Z0-9._:/-]+)*$/.test(scopes))errors.scopes='Enter space-separated scope names.';auth.scopes=scopes.split(/ +/)}
 if(['mtls','oauth2_mtls'].includes(method)){const ref=text('certificateReference','Certificate reference',2,120);if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,119}$/.test(ref))errors.certificateReference='Enter the server-managed certificate reference.';auth.certificateReference=ref}
 if(method==='api_key'){const header=text('apiKeyHeader','API key header',1,80);if(!/^[A-Za-z][A-Za-z0-9-]*$/.test(header))errors.apiKeyHeader='Enter a header name such as X-API-Key.';auth.apiKeyHeader=header}
 const operations=Array.isArray(input.operations)?[...new Set(input.operations)]:[];
 if(!operations.length||operations.some(op=>!['accounts','balances','transactions'].includes(op)))errors.operations='Select at least one supported operation.';
 const timeoutMs=Number(input.timeoutMs);if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)errors.timeoutMs='Enter a timeout between 1000 and 30000 ms.';
 return {errors,connection:{name:data.name,bankName:data.bankName,country:data.country,contactEmail:data.contactEmail,profile:data.profile,baseUrl:data.baseUrl,documentationUrl:data.documentationUrl,authentication:auth,requestedOperations:operations,timeoutMs,environment:'sandbox'}};
}
