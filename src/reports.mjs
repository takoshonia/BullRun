import {renderReportDocument} from './report-document.mjs';
import {aiConfig} from './ai-config.mjs';
import {templateNarrative,narrativeFacts,validateNarrative} from './report-narrative.mjs';
import {id,sha,redact,authorized} from './security.mjs';

export const REPORT_SCHEMA_VERSION=1;
export const REPORT_RENDERER_VERSION='2.3.0';
const impact=v=>({FAIL:'The selected check failed. Review its scope and evidence before applying a change.',BLOCKED:'The required setup or evidence is missing; this is not a passing result.',NEEDS_REVIEW:'The rule has not been approved and was not executed.',NOT_ASSESSED:'This aspect has not been assessed with the available evidence.',NOT_APPLICABLE:'This check does not apply to this observation.',PASS:'Only the selected assertion passed; this does not establish overall compliance.'}[v]||'Review this result against its recorded evidence.');

export function snapshotAudit(run,{connection=null,pack=null}={}){
 if(run.status!=='completed')throw Error('Only completed audits can produce a saved report');
 const findings=(run.results||[]).map(f=>({id:f.id,ruleId:f.ruleId||f.id,title:f.title,layer:f.layer||'other',verdict:f.verdict,severity:f.severity||'unspecified',expected:f.expected||'Not recorded',observed:f.observed||'Not recorded',impact:impact(f.verdict),remediation:f.fix||'Review the source and recorded evidence, correct the affected implementation if needed, and retest.',sourceType:f.sourceType||null,sourceLabel:f.sourceLabel||null,sourceAvailability:f.sourceAvailability||null,sourceReferences:f.sourceReferences||[],route:f.route||null,source:f.source||null,sourceHash:f.sourceHash||null,section:f.section||null,basis:f.basis||null,observationIndex:f.observationIndex??null,assessmentLimit:f.assessmentLimit||null,blockedBy:f.blockedBy||null}));
 const counts={};for(const f of findings)counts[f.verdict]=(counts[f.verdict]||0)+1;
 return redact({schemaVersion:REPORT_SCHEMA_VERSION,quality:run.quality||null,run:{id:run.id,name:run.name||'Audit '+run.id,tenant:run.tenant,kind:run.kind,profile:run.profile,createdAt:run.createdAt,startedAt:run.startedAt||null,finishedAt:run.finishedAt||null,evidenceMode:run.evidenceMode||run.kind,build:run.build||null,rulesetHash:run.rulesetHash||null,evidenceHash:run.evidenceHash||null,adapterVersion:run.adapterVersion||null,specHash:run.specHash||null},connection:connection?{id:connection.id,name:connection.name,bankName:connection.bankName||null,environment:connection.environment||null}:null,evidence:pack?{id:pack.id,name:pack.name,mode:pack.mode,environment:pack.environment||null,captureMethod:pack.captureMethod||null,observationCount:pack.observations?.length||0,sampleCount:pack.samples?.length||0}:null,counts,findings,metrics:(run.metrics||[]).map(m=>({operation:m.operation,attempts:m.attempts,successes:m.successes,errors:m.errors,timeouts:m.timeouts,rateLimited:m.rateLimited??null,successRate:m.successRate,p50:m.p50,p95:m.p95})),measurementWindow:run.measurementWindow||null,limitations:run.limitations||[],continuousAvailability:{included:false,reason:'Continuous health monitoring is a separate observation stream and is not part of this audit snapshot.'},narrativeMode:'deterministic_template'});
}

export function renderFullReport(snapshot,meta){return renderReportDocument(snapshot,meta)}

const metadataColumns='id,run_id AS runId,tenant,kind,version,created_at AS createdAt,created_by AS createdBy,reason,renderer_version AS rendererVersion,schema_version AS schemaVersion,snapshot_hash AS snapshotHash,content_hash AS contentHash,run_name AS runName';
export function canReadReport(user,report){return ['operator','bank','reviewer'].includes(user.role)&&authorized(user,report.tenant)&&(report.kind!=='platform'||user.role==='operator')}

export function createReportStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS audit_reports(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,tenant TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,created_by TEXT NOT NULL,reason TEXT NOT NULL,renderer_version TEXT NOT NULL,schema_version INTEGER NOT NULL,snapshot_hash TEXT NOT NULL,content_hash TEXT NOT NULL,run_name TEXT NOT NULL,request_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,html TEXT NOT NULL,UNIQUE(run_id,version),UNIQUE(run_id,request_id));
 CREATE INDEX IF NOT EXISTS audit_reports_tenant_created ON audit_reports(tenant,created_at);
 CREATE INDEX IF NOT EXISTS audit_reports_run_version ON audit_reports(run_id,version DESC);
 CREATE TRIGGER IF NOT EXISTS audit_reports_no_update BEFORE UPDATE ON audit_reports BEGIN SELECT RAISE(ABORT,'Saved reports are immutable; create a new version'); END;
 CREATE TRIGGER IF NOT EXISTS audit_reports_no_delete BEFORE DELETE ON audit_reports BEGIN SELECT RAISE(ABORT,'Saved report history cannot be deleted'); END;`);
 const latest=runId=>db.prepare('SELECT '+metadataColumns+' FROM audit_reports WHERE run_id=? ORDER BY version DESC LIMIT 1').get(runId)||null;
 const history=runId=>db.prepare('SELECT '+metadataColumns+' FROM audit_reports WHERE run_id=? ORDER BY version DESC').all(runId);
 const metadata=id=>db.prepare('SELECT '+metadataColumns+' FROM audit_reports WHERE id=?').get(id)||null;
 const get=id=>{const row=db.prepare('SELECT '+metadataColumns+',snapshot_json,html FROM audit_reports WHERE id=?').get(id);if(!row)return null;if(sha(row.html)!==row.contentHash||sha(row.snapshot_json)!==row.snapshotHash)throw Error('Saved report integrity check failed');const {snapshot_json,...report}=row;return {...report,snapshot:JSON.parse(snapshot_json)}};
 const context=run=>{const record=(kind,id)=>id?db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind,id):null;const connection=record('connections',run.connectionId),pack=record('packs',run.packId);return {connection:connection?JSON.parse(connection.json):null,pack:pack?JSON.parse(pack.json):null}};
 function persist(run,{revision=false,requestId='automatic-v1',reason='Audit completed',createdBy='worker',complete=false,snapshotOverride=null}={}){
  if(run.status!=='completed')throw Error('Only completed audits can produce a saved report');
  db.exec('BEGIN IMMEDIATE');
  try{
   const duplicate=db.prepare('SELECT '+metadataColumns+' FROM audit_reports WHERE run_id=? AND request_id=?').get(run.id,requestId);
   const existing=latest(run.id);
   if(duplicate&&revision&&(duplicate.reason!==reason||duplicate.createdBy!==createdBy))throw Object.assign(Error('Request ID was already used for another report revision request'),{status:409});
   if(duplicate||(!revision&&existing)){db.exec('COMMIT');return !revision?existing:duplicate}
   const snapshot=snapshotOverride||snapshotAudit(run,context(run));if(!snapshot.narrative)snapshot.narrative=templateNarrative(snapshot,!narrativeFacts(snapshot).length?'no_actionable_findings':complete?(aiConfig().configured?'pending_ai':'not_configured'):'not_requested');snapshot.narrativeMode=snapshot.narrative.mode;const snapshotJson=JSON.stringify(snapshot);
   const meta={id:id(),runId:run.id,tenant:run.tenant,kind:run.kind,runName:snapshot.run.name,version:(existing?.version||0)+1,createdAt:new Date().toISOString(),createdBy,reason,rendererVersion:REPORT_RENDERER_VERSION,schemaVersion:REPORT_SCHEMA_VERSION,snapshotHash:sha(snapshotJson)};
   const html=renderFullReport(snapshot,meta);meta.contentHash=sha(html);
   db.prepare('INSERT INTO audit_reports VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(meta.id,meta.runId,meta.tenant,meta.kind,meta.version,meta.createdAt,meta.createdBy,meta.reason,meta.rendererVersion,meta.schemaVersion,meta.snapshotHash,meta.contentHash,meta.runName,requestId,snapshotJson,html);
   const linked={...run,reportId:meta.id,reportVersion:meta.version,reportHash:meta.contentHash};
   db.prepare('INSERT INTO records(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run('runs',run.id,JSON.stringify(linked));
   db.prepare('INSERT INTO events(at,actor,action,target,detail) VALUES(?,?,?,?,?)').run(meta.createdAt,createdBy,'report_saved',run.id,JSON.stringify({reportId:meta.id,version:meta.version,contentHash:meta.contentHash}));
   if(complete)db.prepare('INSERT INTO events(at,actor,action,target,detail) VALUES(?,?,?,?,?)').run(meta.createdAt,'worker','run_completed',run.id,JSON.stringify({counts:run.counts,reportId:meta.id}));
   db.exec('COMMIT');return meta;
  }catch(error){db.exec('ROLLBACK');throw error}
 }
 const failedBackfills=new Map();
 return {latest,history,get,metadata,
  complete(run){const meta=persist(run,{complete:true});return {...run,reportId:meta.id,reportVersion:meta.version,reportHash:meta.contentHash}},
  createRevision(run,{requestId,reason,createdBy}){return persist(run,{revision:true,requestId,reason,createdBy})},
  saveNarrative(sourceId,narrative,{requestId,createdBy='system'}){const source=get(sourceId);if(!source)throw Error('Source report not found');if(narrative.inputHash!==sha(narrativeFacts(source.snapshot)))throw Error('Narrative evidence hash mismatch');const row=db.prepare("SELECT json FROM records WHERE kind='runs' AND id=?").get(source.runId);if(!row)throw Error('Audit not found');if(narrative.mode==='live_ai_advisory')validateNarrative({findings:narrative.findings},narrativeFacts(source.snapshot));const snapshot=structuredClone(source.snapshot);snapshot.narrative={...narrative,sourceReportId:source.id,sourceSnapshotHash:source.snapshotHash};snapshot.narrativeMode=narrative.mode;return persist(JSON.parse(row.json),{revision:true,requestId,createdBy,reason:narrative.reason==='no_actionable_findings'?'Evidence-based report summary; no actionable AI analysis required':narrative.mode==='live_ai_advisory'?'English AI analysis of grouped failures':'English template fallback: '+narrative.reason,snapshotOverride:snapshot})},
  listVisible(user,{includePlatform=false,limit=100,offset=0}={}){if(!['operator','bank','reviewer'].includes(user.role))return [];const conditions=[],args=[];if(user.role==='bank'){conditions.push('tenant=?');args.push(user.tenant)}else if(user.role==='reviewer'){conditions.push("(tenant=? OR substr(tenant,1,5)='bank-')");args.push(user.tenant)}if(user.role!=='operator'||!includePlatform)conditions.push("kind!='platform'");return db.prepare('SELECT '+metadataColumns+' FROM audit_reports'+(conditions.length?' WHERE '+conditions.join(' AND '):'')+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(...args,limit,offset)},
  backfill(limit=1){const candidates=db.prepare("SELECT json FROM records r WHERE r.kind='runs' AND json_extract(r.json,'$.status')='completed' AND NOT EXISTS(SELECT 1 FROM audit_reports a WHERE a.run_id=r.id) ORDER BY r.rowid LIMIT 20").all();let saved=0;const errors=[];for(const row of candidates){const run=JSON.parse(row.json);if((failedBackfills.get(run.id)||0)>Date.now())continue;try{persist(run,{reason:'Historical audit backfill; report created from retained evidence',createdBy:'system'});failedBackfills.delete(run.id);saved++}catch(error){failedBackfills.set(run.id,Date.now()+60000);errors.push({runId:run.id,error:error.message})}if(saved+errors.length>=limit)break}return {saved,errors}}
 };
}
