import {checkSource} from './check-sources.mjs';
import {sha} from './security.mjs';
// Static declarations only. These checks never stand in for observed bank behavior.
export function localResolve(spec,value,depth=0,seen=new Set()){
 if(depth>20)throw Error('Reference depth exceeded');
 if(!value||typeof value!=='object')return value;
 if(value.$ref){const ref=value.$ref;if(typeof ref!=='string'||!ref.startsWith('#/'))throw Error('Only local JSON references are supported');if(seen.has(ref))throw Error('Cyclic schema reference needs review');const next=new Set(seen);next.add(ref);let target=spec;for(const part of ref.slice(2).split('/'))target=target?.[part.replaceAll('~1','/').replaceAll('~0','~')];if(!target)throw Error('Unresolved local reference: '+ref);return localResolve(spec,target,depth+1,next)}
 if(value.oneOf||value.anyOf)throw Error('Alternative schemas need applicability review');
 if(value.allOf){const parts=value.allOf.map(p=>localResolve(spec,p,depth+1,seen));return {...value,properties:Object.assign({},...parts.map(p=>p.properties||{})),required:[...new Set(parts.flatMap(p=>p.required||[]))]}}
 return value;
}
function operations(spec){const out=[];for(const [route,path]of Object.entries(spec.paths||{}))for(const method of ['get','post','put','patch','delete'])if(path[method])out.push({route,method,definition:path[method],parameters:[...(path.parameters||[]),...(path[method].parameters||[])]});return out}
function accountSchema(spec,op){const response=localResolve(spec,op.definition.responses?.['200']);const json=response?.content?.['application/json'];if(!json?.schema)throw Error('No declared application/json 200 response schema');const root=localResolve(spec,json.schema);const list=root.properties?.accounts;if(!list)throw Error('No account-list schema in declared response');const items=localResolve(spec,list).items;if(!items)throw Error('No account item schema');return localResolve(spec,items)}
export function reviewSpecification(spec,rules){
 const document={type:'uploaded_specification',document:'Uploaded OpenAPI specification',hash:sha(spec),version:spec.info?.version||null,locator:'#'};
 const results=[];const ops=operations(spec);const ais=ops.filter(o=>o.method==='get'&&/\/accounts(?:\/|$)/i.test(o.route));
 const result=(id,title,verdict,expected,observed,extra={})=>results.push({...checkSource('spec-audit.mjs',id,'GeoBridge static specification check'),sourceReferences:[document],id,title,layer:'compatibility',basis:'specification_assertion',severity:'medium',verdict,expected,observed,...extra,...(extra.source?{sourceType:'standard',sourceLabel:'Selected standard'}:{})});
 result('SPEC-OPENAPI','Declared OpenAPI document',/^3\./.test(spec.openapi)?'PASS':'FAIL','OpenAPI 3.x with paths','Parsed OpenAPI '+spec.openapi);
 result('SPEC-AIS-SURFACE','Recognized account-information paths',ais.length?'PASS':'NOT_ASSESSED','Declared GET /accounts-related operations',ais.length+' matching operations. Endpoint detection is a heuristic, not a mandatory service-coverage assertion.');
 for(const rule of rules){if(rule.status!=='approved'){results.push({...rule,verdict:'NEEDS_REVIEW',expected:'Reviewed source and profile applicability',observed:'Draft rule; static assertion not executed'});continue}
 const matching=rule.operation==='accounts'?ais.filter(o=>/\/accounts\/?$/i.test(o.route)):ais;
 const supported=['XS2A-JSON','COMMON-JSON','XS2A-REQUEST-ID','COMMON-REQUEST-ID','AIS-CURRENCY','AIS-RESOURCE','AIS-BIC','AIS-TYPE'];
 if(!supported.includes(rule.id)){results.push({...rule,verdict:'NOT_ASSESSED',expected:'Original response or lifecycle evidence',observed:'A specification cannot establish this behavior'});continue}
 if(!matching.length){results.push({...rule,verdict:'NOT_ASSESSED',expected:'Recognized matching operation',observed:'No matching account-information path; review the bank-specific route mapping'});continue}
 for(const [index,op]of matching.entries()){
 const extra={...rule,id:rule.id+'-spec-'+index,ruleId:rule.id,basis:'standard_specification_assertion',route:op.method.toUpperCase()+' '+op.route,sourceReferences:[{...document,locator:'#/paths/'+op.route.replaceAll('~','~0').replaceAll('/','~1')+'/'+op.method}]};
 try{
 if(rule.id.endsWith('JSON')){const response=localResolve(spec,op.definition.responses?.['200']);const hasJSON=!!response?.content?.['application/json'];result(extra.id,rule.title,hasJSON?'PASS':'FAIL','Specification declares application/json success response',hasJSON?'JSON success media type declared; actual payload NOT_ASSESSED':'JSON success media type not declared',extra)}
 else if(rule.id.endsWith('REQUEST-ID')){const parameter=op.parameters.map(p=>localResolve(spec,p)).find(p=>p.in==='header'&&p.name?.toLowerCase()==='x-request-id');const schema=parameter?localResolve(spec,parameter.schema):null;const valid=parameter?.required===true&&schema?.type==='string'&&schema?.format==='uuid';result(extra.id,rule.title,valid?'PASS':'FAIL','Required UUID X-Request-ID is declared','Header declaration '+(valid?'matches selected syntax requirement':'is missing or not a required UUID')+'. Server replay behavior NOT_ASSESSED.',extra)}
 else {const schema=accountSchema(spec,op);const field={'AIS-CURRENCY':'currency','AIS-RESOURCE':'resourceId','AIS-BIC':'bic','AIS-TYPE':'cashAccountType'}[rule.id];const valid=!!schema.properties?.[field]&&schema.required?.includes(field);result(extra.id,rule.title,valid?'PASS':'FAIL','Account schema declares required '+field,valid?'Required field declared; returned values and semantics NOT_ASSESSED':'Field is absent or optional in the declared account item schema',extra)}
 }catch(e){result(extra.id,rule.title,'BLOCKED','Resolved declared schema',e.message,extra)}
 }
 }
 return results;
}
