import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { LabRepository } from './lab';
import { FindingRepository } from './finding';
import { ulid } from 'ulid';
import { piStartSchema,piAnswersSchema,piCandidateSchema,piSettingsSchema,type Article,type PiStartInput,type PiAnswersInput,type PiRun,type PiCandidate } from '@unvar/shared';
import { WritingRepository } from './writing';
export class PiRepository {
  constructor(private db:Database.Database) {}
  private fingerprint(article:Article) { const lab=new LabRepository(this.db);const finding=article.source.kind==='finding'?new FindingRepository(this.db).get(article.source.id):null;return createHash('sha256').update(JSON.stringify({finding,experiments:finding?finding.evidence.map(ref=>lab.get(ref.experimentId)):[lab.get(article.source.id)]})).digest('hex'); }
  settings() { const row=this.db.prepare("SELECT value_json FROM app_settings WHERE key='pi'").get() as {value_json:string}|undefined;return row ? piSettingsSchema.parse(JSON.parse(row.value_json)) : {enabled:false}; }
  configure(raw:{enabled:boolean}) { const input=piSettingsSchema.parse(raw);this.db.prepare("INSERT INTO app_settings VALUES ('pi',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify(input),new Date().toISOString()); }
  list(articleId:string):PiRun[] {
    const rows=this.db.prepare('SELECT p.id,p.article_id AS articleId,p.provider_id AS providerId,p.status,p.error,p.candidate_json AS candidateJson,p.traces_json AS tracesJson,p.calls_json AS callsJson,p.started_at AS startedAt,p.finished_at AS finishedAt,EXISTS(SELECT 1 FROM pi_interview_answers a WHERE a.run_id=p.id) AS applied FROM pi_runs p WHERE p.article_id=? ORDER BY p.started_at DESC,p.id DESC').all(articleId) as (Omit<PiRun,'candidate'|'traces'|'calls'|'applied'> & {candidateJson:string|null;tracesJson:string;callsJson:string;applied:number})[];
    return rows.map(({candidateJson,tracesJson,callsJson,applied,...row})=>({...row,candidate:candidateJson ? piCandidateSchema.parse(JSON.parse(candidateJson)) : null,traces:JSON.parse(tracesJson),calls:JSON.parse(callsJson),applied:Boolean(applied)}));
  }
  get(id:string) { const row=this.db.prepare('SELECT article_id FROM pi_runs WHERE id=?').get(id) as {article_id:string}|undefined;if(!row)throw new Error('Pi run not found.');return this.list(row.article_id).find(run=>run.id===id)!; }
  snapshot(id:string):Article & {sourceFingerprint:string} { this.get(id);return JSON.parse((this.db.prepare('SELECT input_json FROM pi_runs WHERE id=?').get(id) as {input_json:string}).input_json); }
  start(raw:PiStartInput) {
    const input=piStartSchema.parse(raw);if(!this.settings().enabled)throw new Error('Pi is disabled.');
    const previous=this.db.prepare('SELECT id,article_id,provider_id FROM pi_runs WHERE operation_id=?').get(input.operationId) as {id:string;article_id:string;provider_id:string}|undefined;
    if(previous){if(previous.article_id!==input.articleId || previous.provider_id!==input.providerId)throw new Error('Pi operation conflicts.');return this.get(previous.id);}
    const active=this.list(input.articleId).find(run=>run.status==='running');if(active)return active;
    const article=new WritingRepository(this.db).get(input.articleId);
    if(article.source.kind==='finding' && (this.db.prepare('SELECT status FROM findings WHERE id=?').get(article.source.id) as {status:string}).status!=='accepted')throw new Error('Confirm the source Finding first.');
    const id=ulid();this.db.prepare("INSERT INTO pi_runs(id,operation_id,article_id,provider_id,input_json,status,started_at) VALUES (?,?,?,?,?,'running',?)").run(id,input.operationId,input.articleId,input.providerId,JSON.stringify({...article,sourceFingerprint:this.fingerprint(article)}),new Date().toISOString());return this.get(id);
  }
  progress(id:string,traces:PiRun['traces'],calls:PiRun['calls']) { this.db.prepare("UPDATE pi_runs SET traces_json=?,calls_json=? WHERE id=? AND status='running'").run(JSON.stringify(traces),JSON.stringify(calls),id); }
  complete(id:string,raw:PiCandidate,traces:PiRun['traces'],calls:PiRun['calls']) {
    const candidate=piCandidateSchema.parse(raw);const run=this.get(id);if(run.status!=='running')throw new Error('Pi run is not active.');
    const current=new WritingRepository(this.db).get(run.articleId);const snapshot=this.snapshot(id);
    if(current.revision!==snapshot.revision || this.fingerprint(current)!==snapshot.sourceFingerprint)throw new Error('Article or source changed during Pi interview.');
    const ids=new Set(traces.filter(item=>item.status==='completed').flatMap(item=>item.evidenceIds));
    if(!ids.size || candidate.evidenceIds.some(ref=>!ids.has(ref)))throw new Error('Pi must retrieve the cited evidence.');
    this.db.prepare("UPDATE pi_runs SET status='completed',candidate_json=?,traces_json=?,calls_json=?,finished_at=? WHERE id=?").run(JSON.stringify(candidate),JSON.stringify(traces),JSON.stringify(calls),new Date().toISOString(),id);
  }
  finish(id:string,status:'failed'|'canceled',error:string,traces:PiRun['traces'],calls:PiRun['calls']) { this.db.prepare("UPDATE pi_runs SET status=?,error=?,traces_json=?,calls_json=?,finished_at=? WHERE id=? AND status='running'").run(status,error,JSON.stringify(traces),JSON.stringify(calls),new Date().toISOString(),id); }
  recover() { this.db.prepare("UPDATE pi_runs SET status='failed',error='Application closed during this run. Retry explicitly.',finished_at=? WHERE status='running'").run(new Date().toISOString()); }
  applyAnswers(raw:PiAnswersInput) {
    const input=piAnswersSchema.parse(raw);
    this.db.transaction(()=>{
      const run=this.get(input.runId);if(run.status!=='completed' || !run.candidate)throw new Error('Complete the Pi interview first.');
      const previous=this.db.prepare('SELECT answers_json FROM pi_interview_answers WHERE run_id=?').get(run.id) as {answers_json:string}|undefined;
      if(previous){if(previous.answers_json!==JSON.stringify(input.answers))throw new Error('Interview answers already applied. Edit the author interview instead.');return;}
      const writing=new WritingRepository(this.db);const article=writing.get(run.articleId);
      if(article.revision!==input.articleRevision || article.revision!==this.snapshot(run.id).revision || this.fingerprint(article)!==this.snapshot(run.id).sourceFingerprint)throw new Error('Article changed. Start a new interview.');
      const answers={...article.interview};
      for(const answer of input.answers){const question=run.candidate.questions[answer.index];if(!question)throw new Error('Unknown interview question.');answers[question.field]=[answers[question.field],`${question.text}\n${answer.text}`].filter(Boolean).join('\n\n');}
      const saved=writing.saveInterview({id:article.id,revision:article.revision,title:article.title,answers});
      writing.buildPack({id:article.id,revision:saved.revision});
      this.db.prepare('INSERT INTO pi_interview_answers VALUES (?,?,?,?)').run(run.id,JSON.stringify(input.answers),article.revision,new Date().toISOString());
    })();
  }
}
