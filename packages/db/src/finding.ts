import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import { findingCandidateSchema, editFindingSchema, reviewFindingSchema, generateFindingSchema, type Finding, type FindingCandidate, type FindingRun } from '@unvar/shared';
import type { GenerateFindingInput, EditFindingInput, ReviewFindingInput } from '@unvar/shared';
import { LabRepository } from './lab';

type StoredFinding = Omit<Finding, 'evidence' | 'aiProposal'> & { aiProposalJson: string };
export class FindingRepository {
  constructor(private db: Database.Database) {}
  list(): Finding[] {
    const rows = this.db.prepare(`SELECT id,text,confidence,status,counter_evidence AS counterEvidence,revision,ai_proposal_json AS aiProposalJson,
      run_id AS runId,confirmed_at AS confirmedAt,created_at AS createdAt,updated_at AS updatedAt FROM findings ORDER BY updated_at DESC,id DESC`).all() as StoredFinding[];
    return rows.map(({ aiProposalJson, ...row }) => ({ ...row, aiProposal: findingCandidateSchema.parse(JSON.parse(aiProposalJson)),
      evidence: this.db.prepare('SELECT experiment_id AS experimentId,relation,note FROM finding_evidence WHERE finding_id=? ORDER BY created_at,id').all(row.id) as FindingCandidate['evidence'] }));
  }
  get(id: string) { const item = this.list().find(row => row.id === id); if (!item) throw new Error('Finding not found.'); return item; }
  experiments(ids: string[]) {
    const lab = new LabRepository(this.db);
    return ids.map(id => {
      const item = lab.get(id);
      if (!['done', 'archived'].includes(item.status) || !item.result.trim()) throw new Error('Only completed experiments with a result can be used as evidence.');
      return item;
    });
  }
  runs(): FindingRun[] {
    const rows = this.db.prepare(`SELECT id,experiment_ids_json AS experimentIdsJson,provider_id AS providerId,status,error,finding_id AS findingId,
      started_at AS startedAt,finished_at AS finishedAt,calls_json AS callsJson FROM finding_runs ORDER BY started_at DESC,id DESC`).all() as (Omit<FindingRun, 'experimentIds' | 'calls'> & { experimentIdsJson: string; callsJson: string })[];
    return rows.map(({ experimentIdsJson, callsJson, ...row }) => ({ ...row, experimentIds: JSON.parse(experimentIdsJson) as string[], calls: JSON.parse(callsJson) as FindingRun['calls'] }));
  }
  run(id: string) { const item = this.runs().find(row => row.id === id); if (!item) throw new Error('Finding run not found.'); return item; }
  start(raw: GenerateFindingInput) {
    const input = generateFindingSchema.parse(raw);
    const ids = JSON.stringify([...input.experimentIds].sort());
    const existing = this.db.prepare('SELECT id,experiment_ids_json AS ids,provider_id AS providerId FROM finding_runs WHERE operation_id=?').get(input.operationId) as { id: string; ids: string; providerId: string } | undefined;
    if (existing) { if (existing.ids !== ids || existing.providerId !== input.providerId) throw new Error('Generation operation conflicts with an existing run.'); return this.run(existing.id); }
    const active = this.db.prepare("SELECT id FROM finding_runs WHERE experiment_ids_json=? AND status='running'").get(ids) as { id: string } | undefined;
    if (active) return this.run(active.id);
    const experiments = this.experiments(input.experimentIds);
    const id = ulid();
    this.db.prepare("INSERT INTO finding_runs(id,operation_id,experiment_ids_json,provider_id,status,started_at,input_json) VALUES (?,?,?,?,'running',?,?)")
      .run(id, input.operationId, ids, input.providerId, new Date().toISOString(), JSON.stringify(experiments));
    return this.run(id);
  }
  snapshot(id: string) {
    this.run(id);
    return JSON.parse((this.db.prepare('SELECT input_json AS input FROM finding_runs WHERE id=?').get(id) as { input: string }).input) as ReturnType<FindingRepository['experiments']>;
  }
  finish(id: string, status: 'failed' | 'canceled', error: string, calls: FindingRun['calls']) {
    this.db.prepare("UPDATE finding_runs SET status=?,error=?,calls_json=?,finished_at=? WHERE id=? AND status='running'").run(status, error, JSON.stringify(calls), new Date().toISOString(), id);
  }
  recover() { this.db.prepare("UPDATE finding_runs SET status='failed',error='Application closed during this run. Retry explicitly.',finished_at=? WHERE status='running'").run(new Date().toISOString()); }
  private evidence(id: string, values: FindingCandidate['evidence']) {
    this.experiments(values.map(item => item.experimentId));
    this.db.prepare('DELETE FROM finding_evidence WHERE finding_id=?').run(id);
    for (const item of values) this.db.prepare('INSERT INTO finding_evidence VALUES (?,?,?,?,?,?)').run(ulid(), id, item.experimentId, item.relation, item.note, new Date().toISOString());
  }
  private decision(item: Finding, type: string, human: unknown, reason: string) {
    const current = { text: item.text, confidence: item.confidence, counterEvidence: item.counterEvidence, evidence: item.evidence };
    const overridden = type === 'finding_edit' || (human as { action?: string }).action === 'reject' || JSON.stringify(current) !== JSON.stringify(item.aiProposal);
    this.db.prepare('INSERT INTO decisions(id,type,entity_type,entity_id,ai_recommendation,ai_payload_json,human_decision,human_override,override_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(ulid(), type, 'finding', item.id, item.aiProposal.text, JSON.stringify(item.aiProposal), type === 'finding_proposal' ? null : JSON.stringify(human), overridden ? 1 : 0, reason, new Date().toISOString());
  }
  complete(runId: string, raw: FindingCandidate, calls: FindingRun['calls']): Finding {
    const candidate = findingCandidateSchema.parse(raw);
    const id = ulid();
    this.db.transaction(() => {
      const run = this.run(runId);
      if (run.status !== 'running') throw new Error('Finding run is not active.');
      if (candidate.evidence.some(item => !run.experimentIds.includes(item.experimentId))) throw new Error('Model cited an experiment outside the selected evidence.');
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO findings(id,text,confidence,status,counter_evidence,ai_proposal_json,run_id,created_at,updated_at) VALUES (?,?,?,'candidate',?,?,?,?,?)")
        .run(id, candidate.text, candidate.confidence, candidate.counterEvidence, JSON.stringify(candidate), runId, now, now);
      this.evidence(id, candidate.evidence);
      this.db.prepare("UPDATE finding_runs SET status='completed',finding_id=?,calls_json=?,finished_at=? WHERE id=?").run(id, JSON.stringify(calls), now, runId);
      this.decision(this.get(id), 'finding_proposal', { status: 'candidate', confirmed: false }, '');
    })();
    return this.get(id);
  }
  edit(raw: EditFindingInput): Finding {
    const input = editFindingSchema.parse(raw);
    this.db.transaction(() => {
      const item = this.get(input.id);
      if (input.revision !== item.revision) throw new Error('Finding changed. Reload before editing.');
      this.evidence(item.id, input.evidence);
      this.db.prepare("UPDATE findings SET text=?,confidence=?,counter_evidence=?,status='candidate',confirmed_at=NULL,revision=revision+1,updated_at=? WHERE id=?")
        .run(input.text, input.confidence, input.counterEvidence, new Date().toISOString(), item.id);
      this.decision(item, 'finding_edit', input, input.reason);
    })();
    return this.get(input.id);
  }
  review(raw: ReviewFindingInput): Finding {
    const input = reviewFindingSchema.parse(raw);
    this.db.transaction(() => {
      const item = this.get(input.id);
      const status = input.action === 'accept' ? 'accepted' : 'archived';
      if (item.status === status && item.revision === input.revision + 1) return;
      if (item.revision !== input.revision) throw new Error('Finding changed. Reload before reviewing.');
      if (item.status === 'archived') throw new Error('Edit this candidate before reviewing again.');
      if (input.action === 'accept') {
        if (!item.evidence.length) throw new Error('Acceptance requires experiment evidence.');
        this.experiments(item.evidence.map(value => value.experimentId));
      }
      const now = new Date().toISOString();
      this.db.prepare('UPDATE findings SET status=?,confirmed_at=?,revision=revision+1,updated_at=? WHERE id=?').run(status, input.action === 'accept' ? now : null, now, item.id);
      this.decision(item, 'finding_confirmation', { action: input.action, finding: item }, input.reason);
    })();
    return this.get(input.id);
  }
}
