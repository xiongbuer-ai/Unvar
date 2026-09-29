import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { experimentInputSchema, experimentLogInputSchema, transitionExperimentSchema, timerInputSchema, type Experiment, type ExperimentInput, type ExperimentLog, type ExperimentStatus } from '@unvar/shared';

const transitions: Record<ExperimentStatus, ExperimentStatus[]> = { idea: ['ready'], ready: ['idea', 'running'], running: ['analyzing'], analyzing: ['running', 'done'], done: ['archived'], archived: [] };
export class LabRepository {
  constructor(private db: Database.Database, private clock: () => number = Date.now) {}
  list(): Experiment[] {
    const rows = this.db.prepare(`SELECT e.id,e.question_id AS questionId,e.title,COALESCE(e.prediction,'') AS prediction,
      COALESCE(e.baseline,'') AS baseline,COALESCE(e.method,'') AS method,COALESCE(e.metrics_json,'""') AS metricsJson,
      COALESCE(e.result,'') AS result,COALESCE(e.limitations,'') AS limitations,e.trust,e.status,e.revision,
      COALESCE(e.human_time_minutes,0) AS humanTimeMinutes,COALESCE(e.intervention_count,0) AS interventionCount,
      COALESCE(e.bug_count,0) AS bugCount,COALESCE(e.rework_count,0) AS reworkCount,
      e.timer_started_at AS timerStartedAt,e.elapsed_seconds AS elapsedSeconds,e.started_at AS startedAt,e.finished_at AS finishedAt,
      q.text AS question,c.text AS claim,s.id AS signalId,COALESCE(NULLIF(s.title,''),s.fetched_title,'Untitled source') AS sourceTitle,
      COALESCE(s.url,'') AS sourceUrl FROM experiments e JOIN questions q ON q.id=e.question_id
      JOIN claims c ON c.id=q.claim_id JOIN signals s ON s.id=q.signal_id ORDER BY e.updated_at DESC,e.id DESC`).all() as (Omit<Experiment, 'metrics'> & { metricsJson: string })[];
    return rows.map(({ metricsJson, ...row }) => ({ ...row, metrics: JSON.parse(metricsJson) as string,
      elapsedSeconds: row.elapsedSeconds + (row.timerStartedAt ? Math.max(0, Math.floor((this.clock() - Date.parse(row.timerStartedAt)) / 1000)) : 0) }));
  }
  get(id: string): Experiment {
    const item = this.list().find(row => row.id === id);
    if (!item) throw new Error('Experiment not found.');
    return item;
  }
  private now() { return new Date(this.clock()).toISOString(); }
  private log(id: string, event: string, text: string, elapsed: number, operation: string | null = null) {
    this.db.prepare('INSERT INTO experiment_logs(id,experiment_id,operation_id,event_type,text,elapsed_seconds,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(ulid(), id, operation, event, text, elapsed, this.now());
  }
  save(raw: ExperimentInput): Experiment {
    const input = experimentInputSchema.parse(raw);
    this.db.transaction(() => {
      const previous = this.get(input.id);
      if (previous.revision !== input.revision) throw new Error('Experiment changed. Reload before saving.');
      if (['done', 'archived'].includes(previous.status)) throw new Error('Completed experiments are read-only.');
      if (previous.startedAt && previous.prediction !== input.prediction) throw new Error('Prediction is locked after the first run starts.');
      this.db.prepare(`UPDATE experiments SET title=?,prediction=?,baseline=?,method=?,metrics_json=?,result=?,limitations=?,trust=?,
        human_time_minutes=?,intervention_count=?,bug_count=?,rework_count=?,revision=revision+1,updated_at=? WHERE id=?`)
        .run(input.title, input.prediction, input.baseline, input.method, JSON.stringify(input.metrics), input.result, input.limitations, input.trust,
          input.humanTimeMinutes, input.interventionCount, input.bugCount, input.reworkCount, this.now(), input.id);
      this.log(input.id, 'human_edit', 'User saved experiment fields.', previous.elapsedSeconds);
      this.db.prepare('INSERT INTO decisions(id,type,entity_type,entity_id,ai_recommendation,human_decision,human_override,created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(ulid(), 'experiment_design', 'experiment', input.id, previous.method, JSON.stringify(input), previous.method === input.method ? 0 : 1, this.now());
    })();
    return this.get(input.id);
  }
  transition(raw: { id: string; status: ExperimentStatus; revision: number }): Experiment {
    const input = transitionExperimentSchema.parse(raw);
    this.db.transaction(() => {
      const previous = this.get(input.id);
      if (previous.status === input.status) return;
      if (previous.revision !== input.revision) throw new Error('Experiment changed. Reload before changing status.');
      if (!transitions[previous.status].includes(input.status)) throw new Error('Invalid experiment transition.');
      if (['ready', 'running'].includes(input.status) && (!previous.prediction.trim() || !previous.baseline.trim() || !previous.method.trim() || !previous.metrics.trim())) throw new Error('Fill Prediction, Baseline, Method and Metrics first.');
      if (input.status === 'analyzing' && !previous.result.trim()) throw new Error('Record your Result before analysis.');
      if (input.status === 'done' && (!previous.result.trim() || !previous.limitations.trim() || previous.trust === null)) throw new Error('Result, Limitations and Trust are required.');
      const now = this.now();
      const start = input.status === 'running';
      this.db.prepare(`UPDATE experiments SET status=?,revision=revision+1,updated_at=?,elapsed_seconds=?,timer_started_at=?,
        started_at=COALESCE(started_at,?),finished_at=? WHERE id=?`)
        .run(input.status, now, previous.elapsedSeconds, start ? now : null, start ? now : null,
          input.status === 'done' ? now : previous.finishedAt, input.id);
      this.log(input.id, 'status', `${previous.status} → ${input.status}`, previous.elapsedSeconds);
    })();
    return this.get(input.id);
  }
  timer(raw: { id: string; action: 'start' | 'pause' }): Experiment {
    const input = timerInputSchema.parse(raw);
    this.db.transaction(() => {
      const item = this.get(input.id);
      if (item.status !== 'running') throw new Error('Timer requires a running experiment.');
      if (Boolean(item.timerStartedAt) === (input.action === 'start')) return;
      this.db.prepare('UPDATE experiments SET timer_started_at=?,elapsed_seconds=?,updated_at=? WHERE id=?')
        .run(input.action === 'start' ? this.now() : null, item.elapsedSeconds, this.now(), input.id);
      this.log(input.id, 'timer', input.action, item.elapsedSeconds);
    })();
    return this.get(input.id);
  }
  appendLog(raw: { experimentId: string; operationId: string; text: string }) {
    const input = experimentLogInputSchema.parse(raw);
    this.db.transaction(() => {
      const existing = this.db.prepare('SELECT experiment_id AS id,text FROM experiment_logs WHERE operation_id=?').get(input.operationId) as { id: string; text: string } | undefined;
      if (existing) {
        if (existing.id !== input.experimentId || existing.text !== input.text) throw new Error('Log operation conflicts with an existing entry.');
        return;
      }
      const item = this.get(input.experimentId);
      if (['done', 'archived'].includes(item.status)) throw new Error('Completed experiments are read-only.');
      this.log(item.id, 'human_note', input.text, item.elapsedSeconds, input.operationId);
    })();
  }
  logs(id: string): ExperimentLog[] {
    this.get(id);
    return this.db.prepare('SELECT id,experiment_id AS experimentId,event_type AS eventType,text,elapsed_seconds AS elapsedSeconds,created_at AS createdAt FROM experiment_logs WHERE experiment_id=? ORDER BY created_at,id').all(id) as ExperimentLog[];
  }
}
