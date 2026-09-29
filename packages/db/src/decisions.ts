import type Database from 'better-sqlite3';
import { decisionQuerySchema, decisionOutcomeSchema, type DecisionQuery, type DecisionOutcomeInput, type DecisionRecord } from '@unvar/shared';
interface Row { id: string; type: string; entity_type: DecisionRecord['entityType']; entity_id: string; ai_recommendation: string | null; ai_payload_json: string | null; human_decision: string | null; human_override: number; override_reason: string | null; outcome_json: string | null; outcome_revision: number; created_at: string; resolved_at: string | null; entityTitle: string; entityStatus: string; currentResult: string }
const select = `SELECT d.*,COALESCE(q.text,e.title,f.text,a.title,d.entity_id) AS entityTitle,
  COALESCE(q.status,e.status,f.status,a.status,'') AS entityStatus,COALESCE(e.result,f.text,a.final_md,'') AS currentResult
  FROM decisions d LEFT JOIN questions q ON d.entity_type='question' AND q.id=d.entity_id
  LEFT JOIN experiments e ON d.entity_type='experiment' AND e.id=d.entity_id
  LEFT JOIN findings f ON d.entity_type='finding' AND f.id=d.entity_id
  LEFT JOIN articles a ON d.entity_type='article' AND a.id=d.entity_id`;
function parse(value: string | null): unknown { if (value === null) return null; try { return JSON.parse(value); } catch { return value; } }
export class DecisionRepository {
  constructor(private db: Database.Database) {}
  private project(row: Row): DecisionRecord {
    const outcome = parse(row.outcome_json);
    return { id: row.id,type: row.type,entityType: row.entity_type,entityId: row.entity_id,entityTitle: row.entityTitle,entityStatus: row.entityStatus,currentResult: row.currentResult,
      aiRecommendation: parse(row.ai_payload_json ?? row.ai_recommendation),
      // Legacy bookkeeping was not a human approval; keep storage intact but show its actual meaning.
      humanDecision: row.type === 'question_score' && row.human_decision === 'Initial AI score recorded' ? null : parse(row.human_decision),
      override: Boolean(row.human_override),reason: row.override_reason ?? '',outcome: typeof outcome === 'object' && outcome && 'text' in outcome ? String(outcome.text) : typeof outcome === 'string' ? outcome : '',outcomeRevision: row.outcome_revision,createdAt: row.created_at,resolvedAt: row.resolved_at,
      outcomeHistory: this.db.prepare('SELECT revision,text,created_at AS createdAt FROM decision_outcomes WHERE decision_id=? ORDER BY revision DESC').all(row.id) as DecisionRecord['outcomeHistory'] };
  }
  get(id: string) { const row = this.db.prepare(select + ' WHERE d.id=?').get(id) as Row | undefined; if (!row) throw new Error('Decision not found.'); return this.project(row); }
  list(raw: DecisionQuery) {
    const input = decisionQuerySchema.parse(raw);
    const conditions: string[] = []; const values: (string|number)[] = [];
    if (input.entityType) { conditions.push('d.entity_type=?'); values.push(input.entityType); }
    if (input.entityId) { conditions.push('d.entity_id=?'); values.push(input.entityId); }
    if (input.overridesOnly) conditions.push('d.human_override=1');
    if (input.search) { conditions.push("instr(lower(COALESCE(q.text,e.title,f.text,a.title,'') || ' ' || COALESCE(d.ai_recommendation,'') || ' ' || COALESCE(d.ai_payload_json,'') || ' ' || COALESCE(d.human_decision,'') || ' ' || COALESCE(d.override_reason,'') || ' ' || COALESCE(d.outcome_json,'')),lower(?))>0"); values.push(input.search); }
    const filtered = select + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '');
    const total = (this.db.prepare('SELECT COUNT(*) AS n FROM (' + filtered + ')').get(...values) as { n: number }).n;
    const rows = this.db.prepare(filtered + ' ORDER BY d.created_at DESC,d.id DESC LIMIT ? OFFSET ?').all(...values,input.limit,input.offset) as Row[];
    return { items: rows.map(row => this.project(row)),total };
  }
  saveOutcome(raw: DecisionOutcomeInput) {
    const input = decisionOutcomeSchema.parse(raw);
    this.db.transaction(() => {
      const existing = this.db.prepare('SELECT decision_id,text FROM decision_outcomes WHERE operation_id=?').get(input.operationId) as { decision_id: string; text: string } | undefined;
      if (existing) { if (existing.decision_id !== input.id || existing.text !== input.text) throw new Error('Outcome operation conflicts.'); return; }
      const item = this.get(input.id); if (item.outcomeRevision !== input.revision) throw new Error('Outcome changed. Reload before saving.');
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO decision_outcomes VALUES (?,?,?,?,?)').run(input.id,input.revision+1,input.operationId,input.text,now);
      this.db.prepare('UPDATE decisions SET outcome_json=?,outcome_revision=outcome_revision+1,resolved_at=? WHERE id=?').run(JSON.stringify({text:input.text}),now,input.id);
    })(); return this.get(input.id);
  }
}
