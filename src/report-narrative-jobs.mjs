import {id} from './security.mjs';
import {aiConfig} from './ai-config.mjs';
import {generateNarrative,PROMPT_VERSION} from './report-narrative.mjs';

export function createNarrativeJobs(db,reports,{generate=generateNarrative}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS report_narrative_jobs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,tenant TEXT NOT NULL,model TEXT NOT NULL,prompt_version TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,started_at TEXT,lease TEXT,attempts INTEGER NOT NULL DEFAULT 0,report_id TEXT,error TEXT,actor TEXT NOT NULL,UNIQUE(source_id,model,prompt_version));
 CREATE INDEX IF NOT EXISTS narrative_jobs_pending ON report_narrative_jobs(status,created_at);`);
 const columns='id,source_id AS sourceReportId,status,created_at AS createdAt,attempts,report_id AS reportId,error';
 const get=jobId=>db.prepare('SELECT '+columns+' FROM report_narrative_jobs WHERE id=?').get(jobId)||null;
 function enqueue(sourceId,actor='system'){
  const source=reports.metadata(sourceId);if(!source)throw Error('Report not found');const model=aiConfig().model||'unconfigured';
  const existing=db.prepare('SELECT id FROM report_narrative_jobs WHERE source_id=? AND model=? AND prompt_version=?').get(sourceId,model,PROMPT_VERSION);
  if(existing){const job=get(existing.id);if(job.status==='failed'&&job.attempts<3)db.prepare("UPDATE report_narrative_jobs SET status='queued',error=NULL WHERE id=? AND status='failed'").run(job.id);return get(job.id)}
  if(db.prepare("SELECT COUNT(*) AS n FROM report_narrative_jobs WHERE tenant=? AND status IN ('queued','running')").get(source.tenant).n>=10)throw Object.assign(Error('Finish the queued report explanations before requesting more'),{status:429});
  const jobId=id();db.prepare("INSERT INTO report_narrative_jobs(id,source_id,tenant,model,prompt_version,status,created_at,actor) VALUES(?,?,?,?,?,'queued',?,?)").run(jobId,sourceId,source.tenant,model,PROMPT_VERSION,new Date().toISOString(),actor);return get(jobId);
 }
 let busy=false;
 async function tick(){
  if(busy)return;busy=true;
  let job,lease;
  try{
   // Only reports explicitly marked at completion are automatically enrolled. No paid historical mass backfill.
   const pending=db.prepare("SELECT id FROM audit_reports a WHERE json_extract(snapshot_json,'$.narrative.reason')='pending_ai' AND NOT EXISTS(SELECT 1 FROM report_narrative_jobs j WHERE j.source_id=a.id) ORDER BY created_at LIMIT 1").get();
   if(pending)try{enqueue(pending.id)}catch(error){if(error.status!==429)throw error}
   db.prepare("UPDATE report_narrative_jobs SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,error='interrupted' WHERE status='running' AND started_at<?").run(new Date(Date.now()-120000).toISOString());
   db.exec('BEGIN IMMEDIATE');
   try{job=db.prepare("SELECT * FROM report_narrative_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").get();if(job){lease=id();db.prepare("UPDATE report_narrative_jobs SET status='running',started_at=?,lease=?,attempts=attempts+1 WHERE id=?").run(new Date().toISOString(),lease,job.id)}db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
   if(!job)return;
   const source=reports.get(job.source_id);if(!source)throw Error('Report not found');
   const currentConfig=aiConfig();
   const narrative=await generate(source.snapshot,{config:{...currentConfig,configured:currentConfig.configured&&job.model!=='unconfigured'}});
   if(!db.prepare("SELECT id FROM report_narrative_jobs WHERE id=? AND lease=? AND status='running'").get(job.id,lease))return;
   const report=reports.saveNarrative(source.id,narrative,{requestId:'narrative-job-'+job.id,createdBy:job.actor});
   db.prepare("UPDATE report_narrative_jobs SET status='completed',report_id=?,error=NULL WHERE id=? AND lease=?").run(report.id,job.id,lease);
  }catch{
   // Never persist provider error bodies, prompts or credentials in public job errors or logs.
   if(job)db.prepare("UPDATE report_narrative_jobs SET status='failed',error='explanation_storage_failed' WHERE id=? AND lease=?").run(job.id,lease);
  }finally{busy=false}
 }
 return {enqueue,get,tick};
}
