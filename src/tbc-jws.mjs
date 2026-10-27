// Georgian Open Banking detached JWS profile, interoperable with TBC's official
// TBC.OpenBanking.Jws implementation (RS256/PS256, unencoded HTTP-header payload).
import crypto from 'node:crypto';
const mechanisms='http://uri.etsi.org/19182/HttpHeaders';
const digest=body=>'SHA-256='+crypto.createHash('sha256').update(body).digest('base64');
const input=(names,headers,special)=>names.map(name=>{
 const value=name in special?special[name]:headers[name];
 if(typeof value!=='string'||/[\r\n]/.test(value))throw Error('Signed header missing or invalid: '+name);
 return name+': '+value;
}).join('\n');
export function signTbcRequest({method,url,headers,body,key,certificate,now=new Date()}){
 headers={...headers,host:url.host,digest:digest(body)};
 const names=['(request-target)','host','x-request-id',...['content-type','content-length'].filter(k=>k in headers),'digest',...Object.keys(headers).filter(k=>k.startsWith('psu-')).sort()];
 const cert=new crypto.X509Certificate(certificate);
 const header={b64:false,x5c:[cert.raw.toString('base64')],crit:['sigT','sigD','b64'],sigT:now.toISOString().replace(/\.\d{3}Z$/,'Z'),sigD:{pars:names,mId:mechanisms},alg:'RS256'};
 const encoded=Buffer.from(JSON.stringify(header)).toString('base64url');
 const payload=input(names,headers,{'(request-target)':method.toLowerCase()+' '+url.pathname+url.search});
 headers['x-jws-signature']=encoded+'..'+crypto.sign('sha256',Buffer.from(encoded+'.'+payload,'ascii'),key).toString('base64url');
 return headers;
}
export function verifyTbcResponse({status,headers,body,requestId,rootCertificates=[],issuerAnchor,expectedSignerOrganization,now=Date.now(),requireTrust=true}){
 const signature=headers['x-jws-signature'];
 if(typeof signature!=='string'||signature.length>50000)throw Error('TBC response signature missing');
 const parts=signature.split('..');if(parts.length!==2||parts.some(p=>!/^[A-Za-z0-9_-]+$/.test(p)))throw Error('Invalid detached JWS');
 const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
 if(!['RS256','PS256'].includes(header.alg)||header.b64!==false||!Array.isArray(header.crit)||header.crit.length!==3||!['sigT','sigD','b64'].every(k=>header.crit.includes(k))||header.sigD?.mId!==mechanisms)throw Error('Unsupported TBC JWS profile');
 const time=Date.parse(header.sigT);if(!Number.isFinite(time)||time>now+2000||time<now-60000)throw Error('TBC signature timestamp outside allowed window');
 const names=header.sigD?.pars;
 if(!Array.isArray(names)||names.length>30||new Set(names).size!==names.length||names.some(n=>typeof n!=='string'||n!==n.toLowerCase())||!['(response-status)','x-request-id','digest'].every(n=>names.includes(n)))throw Error('Required signed response headers missing');
 if(['content-type','content-length'].some(n=>n in headers&&!names.includes(n)))throw Error('Unsigned response content header');
 if(headers.digest!==digest(body)||headers['x-request-id']!==requestId)throw Error('TBC response digest or correlation mismatch');
 if(!Array.isArray(header.x5c)||!header.x5c.length||header.x5c.length>6)throw Error('TBC signer certificate missing');
 const certs=header.x5c.map(c=>new crypto.X509Certificate(Buffer.from(c,'base64')));
 if(expectedSignerOrganization&&!certs[0].subject.split('\n').some(line=>line==='organizationIdentifier='+expectedSignerOrganization||line==='2.5.4.97='+expectedSignerOrganization))throw Error('Unexpected TBC response signer identity');
 for(const cert of certs)if(Date.parse(cert.validFrom)>now||Date.parse(cert.validTo)<now)throw Error('TBC signer certificate expired or not valid yet');
 for(let i=0;i<certs.length-1;i++)if(!certs[i+1].ca||!certs[i].checkIssued(certs[i+1])||!certs[i].verify(certs[i+1].publicKey))throw Error('Invalid TBC signer chain');
 const last=certs.at(-1),roots=rootCertificates.map(c=>new crypto.X509Certificate(c));
 // A received root may also be anchored by verifying the bank-issued local
 // client certificate. A self-signed certificate by itself is never trusted.
 const anchor=issuerAnchor?new crypto.X509Certificate(issuerAnchor):null;
 const trusted=roots.some(root=>root.ca&&Date.parse(root.validFrom)<=now&&Date.parse(root.validTo)>=now&&(last.fingerprint256===root.fingerprint256||last.checkIssued(root)&&last.verify(root.publicKey)))||!!(anchor&&last.ca&&last.subject===last.issuer&&last.verify(last.publicKey)&&anchor.checkIssued(last)&&anchor.verify(last.publicKey));
 const options=header.alg==='PS256'?{key:certs[0].publicKey,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}:certs[0].publicKey;
 if(!crypto.verify('sha256',Buffer.from(parts[0]+'.'+input(names,headers,{'(response-status)':String(status)}),'ascii'),options,Buffer.from(parts[1],'base64url')))throw Error('Invalid TBC response signature');
 if(requireTrust&&!trusted)throw Error('TBC response signer trust anchor is missing; request the sandbox signing CA certificate from TBC');
 return {signatureVerified:true,signerTrusted:trusted,signerFingerprint:certs[0].fingerprint256};
}
