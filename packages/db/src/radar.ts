import { JevRepository } from './jev';
import type { ScoreEvaluation } from '@unvar/shared';
import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { analysisSchema, scoresSchema, type ClaimRecord, type SignalAnalysis, type QuestionScores, type RadarQuestion, type WorkflowRun, type QuestionStatus } from '@unvar/shared';

export class RadarRepository {
  constructor(private db: Database.Database) {}
  recoverInterruptedRuns() {
    this.db.prepare("UPDATE workflow_runs SET status='failed', stage='interrupted', error_message='Application closed during this run. Retry explicitly.', finished_at=? WHERE status='running'").run(new Date().toISOString());
  }
  listRuns(): WorkflowRun[] {
    return this.db.prepare('SELECT id, entity_id AS entityId, status, stage, error_message AS errorMessage, started_at AS startedAt, finished_at AS finishedAt FROM workflow_runs ORDER BY started_at DESC LIMIT 100').all() as WorkflowRun[];
  }
  startRun(signalId: string): WorkflowRun {
    const id = ulid();
    this.db.prepare("INSERT INTO workflow_runs (id, workflow_type, entity_id, status, stage, started_at) VALUES (?, 'signal_analysis', ?, 'running', 'queued', ?)").run(id, signalId, new Date().toISOString());
    return this.listRuns().find((run) => run.id === id)!;
  }
  updateRun(id: string, stage: string, status: WorkflowRun['status'] = 'running', error: string | null = null, metadata?: unknown) {
    this.db.prepare('UPDATE workflow_runs SET stage=?, status=?, error_message=?, finished_at=?, metadata_json=COALESCE(?, metadata_json) WHERE id=?')
      .run(stage, status, error, status === 'running' ? null : new Date().toISOString(), metadata === undefined ? null : JSON.stringify(metadata), id);
  }
  canonicalSignal(signalId: string): string {
    const row = this.db.prepare('SELECT duplicate_of AS duplicateOf FROM signals WHERE id=?').get(signalId) as { duplicateOf: string | null } | undefined;
    if (!row) throw new Error('Signal not found.');
    return row.duplicateOf ?? signalId;
  }
  existingSource(normalizedUrl: string): string | undefined {
    return (this.db.prepare('SELECT id FROM signals WHERE normalized_url=?').get(normalizedUrl) as { id: string } | undefined)?.id;
  }
  linkDuplicate(signalId: string, canonicalId: string) {
    if (signalId !== canonicalId) this.db.prepare('UPDATE signals SET duplicate_of=? WHERE id=?').run(canonicalId, signalId);
  }
  cacheSource(signalId: string, source: { normalizedUrl: string; title: string; text: string; contentHash: string }): string {
    return this.db.transaction(() => {
      const duplicate = this.db.prepare('SELECT id FROM signals WHERE (normalized_url=? OR content_hash=?) AND id<>? LIMIT 1')
        .get(source.normalizedUrl, source.contentHash, signalId) as { id: string } | undefined;
      if (duplicate) { this.linkDuplicate(signalId, duplicate.id); return duplicate.id; }
      this.db.prepare('UPDATE signals SET normalized_url=?, fetched_title=?, fetched_text=?, content_hash=?, updated_at=? WHERE id=?')
        .run(source.normalizedUrl, source.title, source.text, source.contentHash, new Date().toISOString(), signalId);
      return signalId;
    })();
  }
  cachedSource(signalId: string): { text: string; title: string } | undefined {
    const row = this.db.prepare('SELECT fetched_text AS text, fetched_title AS title FROM signals WHERE id=?').get(signalId) as { text: string | null; title: string | null } | undefined;
    return row?.text ? { text: row.text, title: row.title ?? '' } : undefined;
  }
  hasAnalysis(signalId: string): boolean { return Boolean(this.db.prepare('SELECT id FROM questions WHERE signal_id=? LIMIT 1').get(signalId)); }
  saveAnalysis(signalId: string, raw: SignalAnalysis, scoreList: QuestionScores[], engine: string, evaluations?: ScoreEvaluation[]): void {
    const analysis = analysisSchema.parse(raw);
    const scores = scoreList.map((score) => scoresSchema.parse(score));
    if (evaluations && evaluations.length !== scores.length) throw new Error('Evaluation count mismatch.');
    if (scores.length !== analysis.questions.length) throw new Error('Score count mismatch.');
    this.db.transaction(() => {
      if (this.hasAnalysis(signalId)) return;
      const now = new Date().toISOString();
      const claimIds = analysis.claims.map((claim) => {
        const id = ulid();
        this.db.prepare('INSERT INTO claims(id, signal_id, text, type, evidence_text, created_at) VALUES (?,?,?,?,?,?)').run(id, signalId, claim.text, claim.type, claim.evidenceText, now);
        return id;
      });
      analysis.questions.forEach((question, index) => {
        const score = scores[index]; const id = ulid();
        const status = score.workRelevance >= 2 && score.experimentability >= 2 && score.evidencePotential >= 2 ? 'candidate' : 'backlog';
        this.db.prepare(`INSERT INTO questions(id,claim_id,signal_id,text,why_relevant,proposed_experiment,estimated_minutes,
          work_relevance,experimentability,evidence_potential,uniqueness,series_potential,ai_score_json,status,engine,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, claimIds[question.claimIndex], signalId, question.text, question.whyRelevant, question.proposedExperiment, question.estimatedMinutes,
          score.workRelevance, score.experimentability, score.evidencePotential, score.uniqueness, score.seriesPotential, JSON.stringify(score), status, evaluations?.[index]?.engine ?? engine, now, now);
        if(evaluations?.[index])new JevRepository(this.db).append(id,'radar',evaluations[index]);
        this.decision('question_score', id, JSON.stringify(score), null, false, null);
      });
    })();
  }
  applyEvaluation(id:string,evaluation:ScoreEvaluation,origin:'radar'|'pi') {
    const previous=this.getQuestion(id);const score=scoresSchema.parse(evaluation.scores);
    return this.db.transaction(()=>{
      // Pi produces a persisted proposal; only an explicit Radar action applies it.
      if(origin==='radar') {
        this.db.prepare('UPDATE questions SET ai_score_json=?,engine=?,updated_at=? WHERE id=?').run(JSON.stringify(score),evaluation.engine,new Date().toISOString(),id);
        if(!previous.humanOverride) {
          const status=previous.status==='archived'?'archived':score.workRelevance>=2&&score.experimentability>=2&&score.evidencePotential>=2?'candidate':'backlog';
          this.db.prepare('UPDATE questions SET work_relevance=?,experimentability=?,evidence_potential=?,uniqueness=?,series_potential=?,status=? WHERE id=?').run(score.workRelevance,score.experimentability,score.evidencePotential,score.uniqueness,score.seriesPotential,status,id);
        }
      }
      const saved=new JevRepository(this.db).append(id,origin,evaluation);
      this.decision('question_score',id,JSON.stringify({scores:score,engine:evaluation.engine,model:evaluation.model,evaluationId:saved.id,origin}),previous.humanOverride?JSON.stringify(previous.scores):null,false,null);
      return saved;
    })();
  }
  listClaims(): ClaimRecord[] { return this.db.prepare('SELECT c.id,c.signal_id AS signalId,c.text,c.type,c.evidence_text AS evidenceText,s.title AS sourceTitle,s.url AS sourceUrl FROM claims c JOIN signals s ON s.id=c.signal_id ORDER BY c.created_at DESC,c.id DESC').all() as ClaimRecord[]; }
  listQuestions(): RadarQuestion[] {
    const rows = this.db.prepare(`SELECT q.id,q.signal_id AS signalId,q.claim_id AS claimId,q.text,c.text AS claim,
      COALESCE(NULLIF(s.title,''),s.fetched_title,'Untitled source') AS sourceTitle,COALESCE(s.url,'') AS sourceUrl,
      q.why_relevant AS whyRelevant,q.proposed_experiment AS proposedExperiment,q.estimated_minutes AS estimatedMinutes,
      q.ai_score_json AS aiScoreJson,q.human_score_json AS humanScoreJson,q.human_override AS humanOverride,
      q.override_reason AS overrideReason,q.status,q.engine FROM questions q JOIN claims c ON c.id=q.claim_id JOIN signals s ON s.id=q.signal_id ORDER BY q.created_at DESC,q.id DESC`).all() as (Omit<RadarQuestion, 'scores' | 'aiScores' | 'humanOverride'> & { aiScoreJson: string; humanScoreJson: string | null; humanOverride: number })[];
    return rows.map(({ aiScoreJson, humanScoreJson, humanOverride, ...row }) => ({ ...row, humanOverride: Boolean(humanOverride), aiScores: scoresSchema.parse(JSON.parse(aiScoreJson)), scores: scoresSchema.parse(JSON.parse(humanScoreJson ?? aiScoreJson)) }));
  }
  getQuestion(id: string): RadarQuestion {
    const question = this.listQuestions().find((row) => row.id === id);
    if (!question) throw new Error('Question not found.');
    return question;
  }
  private decision(type: string, id: string, ai: string, human: string | null, override: boolean, reason: string | null) {
    this.db.prepare('INSERT INTO decisions(id,type,entity_type,entity_id,ai_recommendation,human_decision,human_override,override_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(ulid(), type, 'question', id, ai, human, override ? 1 : 0, reason, new Date().toISOString());
  }
  editQuestion(id: string, text: string, experiment: string, reason: string) {
    const previous = this.getQuestion(id);
    this.db.transaction(() => {
      this.db.prepare('UPDATE questions SET text=?,proposed_experiment=?,updated_at=? WHERE id=?').run(text, experiment, new Date().toISOString(), id);
      this.decision('question_selection', id, previous.text, text, true, reason);
    })();
  }
  overrideScore(id: string, scores: QuestionScores, reason: string) {
    const previous = this.getQuestion(id);
    scoresSchema.parse(scores);
    if (!reason.trim()) throw new Error('Override reason is required.');
    this.db.transaction(() => {
      const status = scores.workRelevance >= 2 && scores.experimentability >= 2 && scores.evidencePotential >= 2 ? 'candidate' : 'backlog';
      this.db.prepare('UPDATE questions SET human_score_json=?,human_override=1,override_reason=?,work_relevance=?,experimentability=?,evidence_potential=?,uniqueness=?,series_potential=?,status=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(scores), reason, scores.workRelevance, scores.experimentability, scores.evidencePotential, scores.uniqueness, scores.seriesPotential, status, new Date().toISOString(), id);
      this.decision('question_score', id, JSON.stringify(previous.aiScores), JSON.stringify(scores), true, reason);
    })();
  }
  setStatus(id: string, status: QuestionStatus) {
    const question = this.getQuestion(id);
    this.db.transaction(() => {
      this.db.prepare('UPDATE questions SET status=?,updated_at=? WHERE id=?').run(status, new Date().toISOString(), id);
      this.decision('question_selection', id, question.status, status, false, null);
    })();
  }
  createExperiment(questionId: string): { id: string } {
    const question = this.getQuestion(questionId);
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM experiments WHERE question_id=? LIMIT 1').get(questionId) as { id: string } | undefined;
      if (existing) return existing;
      const id = ulid(); const now = new Date().toISOString();
      this.db.prepare("INSERT INTO experiments(id,question_id,title,method,status,created_at,updated_at) VALUES (?,?,?,?,'idea',?,?)").run(id, questionId, question.text, question.proposedExperiment, now, now);
      this.decision('question_selection', questionId, question.status, `Created experiment ${id}`, false, null);
      return { id };
    })();
  }
}
