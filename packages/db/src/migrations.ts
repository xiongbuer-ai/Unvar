import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface Migration { version: number; sql: string }
export const migrations: Migration[] = [{ version: 1, sql: `
  CREATE TABLE signals (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('url','note','question','judgment','experiment_idea','code')),
    source TEXT NOT NULL, title TEXT NOT NULL, url TEXT, normalized_url TEXT, published_at TEXT,
    content_hash TEXT, raw_text TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('inbox','archived')),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX signals_status_updated ON signals(status, updated_at);
  CREATE TABLE signal_tags (signal_id TEXT NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY(signal_id, tag));
  CREATE TABLE provider_settings (id TEXT PRIMARY KEY, provider_type TEXT NOT NULL,
    display_name TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL, credential_key_ref TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE app_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
` }, { version: 2, sql: `
  ALTER TABLE signals ADD COLUMN duplicate_of TEXT REFERENCES signals(id);
  ALTER TABLE signals ADD COLUMN fetched_text TEXT;
  ALTER TABLE signals ADD COLUMN fetched_title TEXT;
  CREATE UNIQUE INDEX signals_normalized_url ON signals(normalized_url) WHERE normalized_url IS NOT NULL;
  CREATE UNIQUE INDEX signals_content_hash ON signals(content_hash) WHERE content_hash IS NOT NULL;
  CREATE TABLE claims(id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES signals(id), text TEXT NOT NULL,
    type TEXT NOT NULL, evidence_text TEXT, model_confidence REAL, created_at TEXT NOT NULL);
  CREATE TABLE questions(id TEXT PRIMARY KEY, claim_id TEXT REFERENCES claims(id), signal_id TEXT REFERENCES signals(id),
    text TEXT NOT NULL, why_relevant TEXT, proposed_experiment TEXT, estimated_minutes INTEGER,
    work_relevance INTEGER, experimentability INTEGER, evidence_potential INTEGER, uniqueness INTEGER, series_potential INTEGER,
    ai_score_json TEXT, human_score_json TEXT, human_override INTEGER NOT NULL DEFAULT 0, override_reason TEXT,
    status TEXT NOT NULL, engine TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE experiments(id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id), title TEXT,
    prediction TEXT, baseline TEXT, method TEXT, metrics_json TEXT, status TEXT NOT NULL,
    started_at TEXT, finished_at TEXT, human_time_minutes INTEGER, total_time_minutes INTEGER,
    intervention_count INTEGER, bug_count INTEGER, rework_count INTEGER, trust INTEGER,
    result TEXT, limitations TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE decisions(id TEXT PRIMARY KEY, type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    ai_recommendation TEXT, ai_payload_json TEXT, human_decision TEXT, human_override INTEGER NOT NULL DEFAULT 0,
    override_reason TEXT, outcome_json TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
  CREATE TABLE workflow_runs(id TEXT PRIMARY KEY, workflow_type TEXT NOT NULL, entity_id TEXT REFERENCES signals(id),
    status TEXT NOT NULL, stage TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, error_message TEXT, metadata_json TEXT);
  CREATE UNIQUE INDEX one_active_signal_run ON workflow_runs(entity_id) WHERE status = 'running';
` }, { version: 3, sql: `
  ALTER TABLE experiments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE experiments ADD COLUMN timer_started_at TEXT;
  ALTER TABLE experiments ADD COLUMN elapsed_seconds INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE experiment_logs(id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id),
    operation_id TEXT UNIQUE, event_type TEXT NOT NULL, text TEXT NOT NULL, elapsed_seconds INTEGER NOT NULL, created_at TEXT NOT NULL);
  CREATE INDEX experiment_logs_history ON experiment_logs(experiment_id,created_at);
` }, { version: 4, sql: `
  CREATE TABLE finding_runs(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,experiment_ids_json TEXT NOT NULL,
    provider_id TEXT NOT NULL REFERENCES provider_settings(id),status TEXT NOT NULL CHECK(status IN ('running','completed','failed','canceled')),
    error TEXT,finding_id TEXT,started_at TEXT NOT NULL,finished_at TEXT,calls_json TEXT NOT NULL DEFAULT '[]',input_json TEXT NOT NULL);
  CREATE UNIQUE INDEX one_active_finding_run ON finding_runs(experiment_ids_json) WHERE status='running';
  CREATE TABLE findings(id TEXT PRIMARY KEY,text TEXT NOT NULL,confidence TEXT NOT NULL CHECK(confidence IN ('low','medium','high')),
    status TEXT NOT NULL CHECK(status IN ('candidate','testing','accepted','challenged','archived')),counter_evidence TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,ai_proposal_json TEXT NOT NULL,run_id TEXT NOT NULL UNIQUE REFERENCES finding_runs(id),
    confirmed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE finding_evidence(id TEXT PRIMARY KEY,finding_id TEXT NOT NULL REFERENCES findings(id),
    experiment_id TEXT NOT NULL REFERENCES experiments(id),relation TEXT NOT NULL CHECK(relation IN ('supports','contradicts','contextual')),
    note TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(finding_id,experiment_id));
  CREATE INDEX finding_evidence_experiment ON finding_evidence(experiment_id);
` }, { version: 5, sql: `
  CREATE TABLE articles(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,title TEXT NOT NULL,status TEXT NOT NULL,
    primary_experiment_id TEXT REFERENCES experiments(id),primary_finding_id TEXT REFERENCES findings(id),revision INTEGER NOT NULL DEFAULT 0,
    pack_version INTEGER NOT NULL DEFAULT 0,confirmed_version INTEGER,outline_md TEXT NOT NULL DEFAULT '',draft_md TEXT NOT NULL DEFAULT '',
    final_md TEXT NOT NULL DEFAULT '',outline_version INTEGER,draft_version INTEGER,review_json TEXT,review_digest TEXT,ready_at TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,CHECK((primary_experiment_id IS NULL) != (primary_finding_id IS NULL)));
  CREATE TABLE article_interviews(article_id TEXT PRIMARY KEY REFERENCES articles(id),answers_json TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE article_fact_packs(article_id TEXT NOT NULL REFERENCES articles(id),version INTEGER NOT NULL,pack_json TEXT NOT NULL,
    context_hash TEXT NOT NULL,confirmed_at TEXT,created_at TEXT NOT NULL,PRIMARY KEY(article_id,version));
  CREATE TABLE article_sources(article_id TEXT NOT NULL REFERENCES articles(id),signal_id TEXT REFERENCES signals(id),
    experiment_id TEXT REFERENCES experiments(id),finding_id TEXT REFERENCES findings(id));
  CREATE TABLE article_revisions(article_id TEXT NOT NULL REFERENCES articles(id),revision INTEGER NOT NULL,snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,PRIMARY KEY(article_id,revision));
  CREATE TABLE writing_runs(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,article_id TEXT NOT NULL REFERENCES articles(id),
    provider_id TEXT NOT NULL REFERENCES provider_settings(id),stage TEXT NOT NULL CHECK(stage IN ('outline','draft','review')),input_revision INTEGER NOT NULL,
    input_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','completed','failed','canceled')),error TEXT,
    calls_json TEXT NOT NULL DEFAULT '[]',result_json TEXT,started_at TEXT NOT NULL,finished_at TEXT);
  CREATE UNIQUE INDEX one_active_writing_run ON writing_runs(article_id) WHERE status='running';
` }, { version: 6, sql: `
  ALTER TABLE decisions ADD COLUMN outcome_revision INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX decisions_entity_history ON decisions(entity_type,entity_id,created_at);
  CREATE TABLE decision_outcomes(decision_id TEXT NOT NULL REFERENCES decisions(id),revision INTEGER NOT NULL,
    operation_id TEXT NOT NULL UNIQUE,text TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(decision_id,revision));
` }, { version: 7, sql: `
  CREATE TABLE pi_runs(id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,article_id TEXT NOT NULL REFERENCES articles(id),
    provider_id TEXT NOT NULL REFERENCES provider_settings(id),input_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('running','completed','failed','canceled')),
    error TEXT,candidate_json TEXT,traces_json TEXT NOT NULL DEFAULT '[]',calls_json TEXT NOT NULL DEFAULT '[]',started_at TEXT NOT NULL,finished_at TEXT);
  CREATE UNIQUE INDEX one_active_pi_article ON pi_runs(article_id) WHERE status='running';
  CREATE TABLE pi_interview_answers(run_id TEXT PRIMARY KEY REFERENCES pi_runs(id),answers_json TEXT NOT NULL,article_revision INTEGER NOT NULL,created_at TEXT NOT NULL);
` }, { version: 8, sql: `
  CREATE TABLE jev_evaluations(id TEXT PRIMARY KEY,question_id TEXT NOT NULL REFERENCES questions(id),
    origin TEXT NOT NULL CHECK(origin IN ('radar','pi')),evaluation_json TEXT NOT NULL,created_at TEXT NOT NULL);
  CREATE INDEX jev_question_history ON jev_evaluations(question_id,created_at);
` }];

export async function migrate(db: Database.Database, backupDirectory: string, steps = migrations): Promise<void> {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get();
  const applied = exists ? db.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all() as { version: number; checksum: string }[] : [];
  for (const row of applied) {
    const step = steps.find((candidate) => candidate.version === row.version);
    if (!step || createHash('sha256').update(step.sql).digest('hex') !== row.checksum) {
      throw new Error('Database migration history is incompatible. Original data was preserved.');
    }
  }
  const pending = steps.filter((step) => !applied.some((row) => row.version === step.version));
  if (!pending.length) return;
  mkdirSync(backupDirectory, { recursive: true });
  await db.backup(join(backupDirectory, `before-v${pending[0].version}-${Date.now()}.db`));
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    for (const step of pending) {
      db.exec(step.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(step.version, createHash('sha256').update(step.sql).digest('hex'), new Date().toISOString());
    }
  })();
}
