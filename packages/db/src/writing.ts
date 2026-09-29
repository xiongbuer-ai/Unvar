import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { createArticleSchema, saveInterviewSchema, articleVersionSchema, confirmFactPackSchema, generateWritingSchema, editArticleSchema, readyArticleSchema, writingMarkdownSchema, writingReviewSchema,
  type Article, type Interview, type FactPack, type FactEvidence, type WritingRun, type WritingOutput,
  type CreateArticleInput, type SaveInterviewInput, type ArticleVersionInput, type ConfirmFactPackInput, type GenerateWritingInput, type EditArticleInput, type ReadyArticleInput } from '@unvar/shared';
import { LabRepository } from './lab';
import { FindingRepository } from './finding';
const now = () => new Date().toISOString();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emptyInterview: Interview = { observations: '', experience: '', opinions: '', unknowns: '' };
interface Row { id: string; title: string; status: Article['status']; primary_experiment_id: string | null; primary_finding_id: string | null; revision: number; pack_version: number; confirmed_version: number | null; outline_md: string; draft_md: string; final_md: string; outline_version: number | null; draft_version: number | null; review_json: string | null; review_digest: string | null; ready_at: string | null; updated_at: string }
interface PackRow { pack_json: string; context_hash: string; confirmed_at: string | null }
export class WritingRepository {
  constructor(private db: Database.Database) {}
  private row(id: string) { const row = this.db.prepare('SELECT * FROM articles WHERE id=?').get(id) as Row | undefined; if (!row) throw new Error('Article not found.'); return row; }
  private source(row: Row): Article['source'] { return row.primary_experiment_id ? { kind: 'experiment', id: row.primary_experiment_id } : { kind: 'finding', id: row.primary_finding_id! }; }
  private context(source: Article['source'], interview: Interview) {
    const lab = new LabRepository(this.db);
    const finding = source.kind === 'finding' ? new FindingRepository(this.db).get(source.id) : null;
    const experiments = source.kind === 'experiment' ? [lab.get(source.id)] : finding!.evidence.map(ref => lab.get(ref.experimentId));
    const eligible = experiments.length > 0 && experiments.every(item => ['done','archived'].includes(item.status) && item.result.trim()) && (!finding || finding.status === 'accepted');
    const evidence: FactEvidence[] = experiments.map(item => ({ id: item.id, kind: 'experiment', title: item.title, text: item.result, limitations: item.limitations, sourceUrl: item.sourceUrl, ...(finding ? { relation: finding.evidence.find(ref => ref.experimentId === item.id)?.relation, note: finding.evidence.find(ref => ref.experimentId === item.id)?.note } : {}) }));
    if (finding) evidence.unshift({ id: finding.id, kind: 'finding', title: finding.text, text: finding.text, limitations: finding.counterEvidence, sourceUrl: '' });
    return { eligible, evidence, experiments, contextHash: hash({ source, finding, experiments, interview }) };
  }
  private digest(article: Article) { return hash({ outline: article.outlineMd, body: article.finalMd, packVersion: article.factPack?.version }); }
  get(id: string): Article {
    const row = this.row(id);
    const interview = JSON.parse((this.db.prepare('SELECT answers_json FROM article_interviews WHERE article_id=?').get(id) as { answers_json: string }).answers_json) as Interview;
    const pack = this.db.prepare('SELECT * FROM article_fact_packs WHERE article_id=? AND version=?').get(id, row.pack_version) as PackRow | undefined;
    const context = this.context(this.source(row), interview);
    const article: Article = { id, revision: row.revision, title: row.title, source: this.source(row), status: row.status, interview,
      factPack: pack ? JSON.parse(pack.pack_json) as FactPack : null, confirmedVersion: row.confirmed_version,
      confirmationValid: Boolean(pack?.confirmed_at && row.confirmed_version === row.pack_version && pack.context_hash === context.contextHash && context.eligible),
      outlineMd: row.outline_md, draftMd: row.draft_md, finalMd: row.final_md, outlineVersion: row.outline_version, draftVersion: row.draft_version,
      review: row.review_json ? writingReviewSchema.parse(JSON.parse(row.review_json)) : null, reviewCurrent: false, readyAt: row.ready_at, updatedAt: row.updated_at };
    article.reviewCurrent = Boolean(article.review && row.review_digest === this.digest(article));
    return article;
  }
  list() { return (this.db.prepare('SELECT id FROM articles ORDER BY updated_at DESC,id DESC').all() as { id: string }[]).map(row => this.get(row.id)); }
  private version(input: ArticleVersionInput) { const article = this.get(input.id); if (article.revision !== input.revision) throw new Error('Article changed. Reload before saving.'); return article; }
  private history(article: Article) { this.db.prepare('INSERT OR IGNORE INTO article_revisions VALUES (?,?,?,?)').run(article.id, article.revision, JSON.stringify(article), now()); }
  private decision(article: Article, type: string, ai: unknown, human: unknown, reason = '', override = false) {
    this.db.prepare('INSERT INTO decisions(id,type,entity_type,entity_id,ai_payload_json,human_decision,human_override,override_reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(ulid(), type, 'article', article.id, ai === null ? null : JSON.stringify(ai), human === null ? null : JSON.stringify(human), override ? 1 : 0, reason, now());
  }
  create(raw: CreateArticleInput) {
    const input = createArticleSchema.parse(raw);
    const existing = this.db.prepare('SELECT id FROM articles WHERE operation_id=?').get(input.operationId) as { id: string } | undefined;
    if (existing) { const item = this.get(existing.id); if (item.title !== input.title || JSON.stringify(item.source) !== JSON.stringify(input.source)) throw new Error('Creation operation conflicts.'); return item; }
    const context = this.context(input.source, emptyInterview);
    if (!context.eligible) throw new Error('Select a completed experiment or accepted finding.');
    const id = ulid();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO articles(id,operation_id,title,status,primary_experiment_id,primary_finding_id,created_at,updated_at) VALUES (?,?,?,'interview',?,?,?,?)")
        .run(id, input.operationId, input.title, input.source.kind === 'experiment' ? input.source.id : null, input.source.kind === 'finding' ? input.source.id : null, now(), now());
      this.db.prepare('INSERT INTO article_interviews VALUES (?,?,?)').run(id, JSON.stringify(emptyInterview), now());
      for (const experiment of context.experiments) this.db.prepare('INSERT INTO article_sources VALUES (?,?,?,?)').run(id, experiment.signalId, experiment.id, input.source.kind === 'finding' ? input.source.id : null);
    })();
    return this.get(id);
  }
  saveInterview(raw: SaveInterviewInput) {
    const input = saveInterviewSchema.parse(raw);
    this.db.transaction(() => {
      const article = this.version(input); this.history(article);
      this.db.prepare('UPDATE article_interviews SET answers_json=?,updated_at=? WHERE article_id=?').run(JSON.stringify(input.answers), now(), input.id);
      this.db.prepare("UPDATE articles SET title=?,status='interview',confirmed_version=NULL,ready_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(input.title, now(), input.id);
      this.decision(article, 'writing_interview', null, input.answers);
    })(); return this.get(input.id);
  }
  buildPack(raw: ArticleVersionInput) {
    const input = articleVersionSchema.parse(raw);
    this.db.transaction(() => {
      const article = this.version(input);
      if (!Object.values(article.interview).some(value => value.trim())) throw new Error('Record at least one interview answer first.');
      const context = this.context(article.source, article.interview);
      if (!context.eligible) throw new Error('Source evidence requires confirmation.');
      this.history(article);
      const version = (article.factPack?.version ?? 0) + 1;
      const pack: FactPack = { version,
        confirmedFacts: [...context.evidence.map(item => ({ text: item.text, evidenceIds: [item.id] })), ...(article.interview.observations ? [{ text: article.interview.observations, evidenceIds: [] }] : [])],
        userOpinions: article.interview.opinions ? [article.interview.opinions] : [], userExperiences: article.interview.experience ? [article.interview.experience] : [], evidence: context.evidence,
        limitations: context.evidence.map(item => item.limitations).filter(Boolean), unknowns: article.interview.unknowns ? [article.interview.unknowns] : [] };
      this.db.prepare('INSERT INTO article_fact_packs(article_id,version,pack_json,context_hash,created_at) VALUES (?,?,?,?,?)').run(input.id, version, JSON.stringify(pack), context.contextHash, now());
      this.db.prepare("UPDATE articles SET pack_version=?,confirmed_version=NULL,status='evidence',ready_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(version, now(), input.id);
    })(); return this.get(input.id);
  }
  confirm(raw: ConfirmFactPackInput) {
    const input = confirmFactPackSchema.parse(raw);
    this.db.transaction(() => {
      const article = this.get(input.id);
      if (article.confirmationValid && article.confirmedVersion === input.version) return;
      this.version(input);
      const pack = this.db.prepare('SELECT * FROM article_fact_packs WHERE article_id=? AND version=?').get(input.id, input.version) as PackRow | undefined;
      const context = this.context(article.source, article.interview);
      if (!pack || article.factPack?.version !== input.version || !context.eligible || pack.context_hash !== context.contextHash) throw new Error('Fact Pack changed. Rebuild it before confirmation.');
      this.history(article);
      this.db.prepare('UPDATE article_fact_packs SET confirmed_at=? WHERE article_id=? AND version=?').run(now(), input.id, input.version);
      this.db.prepare("UPDATE articles SET confirmed_version=?,status='outline',revision=revision+1,updated_at=? WHERE id=?").run(input.version, now(), input.id);
      this.decision(article, 'fact_pack_confirmation', null, { version: input.version, contextHash: context.contextHash, confirmed: true });
    })(); return this.get(input.id);
  }
  private confirmed(article: Article) { if (!article.confirmationValid || !article.factPack) throw new Error('Confirm the current Fact Pack first.'); return article.factPack; }
  edit(raw: EditArticleInput) {
    const input = editArticleSchema.parse(raw);
    this.db.transaction(() => {
      const article = this.version(input); const pack = this.confirmed(article);
      if (input.part === 'draft' && article.draftVersion !== pack.version) throw new Error('Generate a draft from the current Fact Pack first.');
      this.history(article);
      if (input.part === 'outline') this.db.prepare("UPDATE articles SET outline_md=?,outline_version=?,draft_version=NULL,status='outline',review_digest=NULL,ready_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(input.markdown, pack.version, now(), input.id);
      else this.db.prepare("UPDATE articles SET final_md=?,status='edit',review_digest=NULL,ready_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(input.markdown, now(), input.id);
      this.decision(article, 'writing_edit', { markdown: input.part === 'outline' ? article.outlineMd : article.draftMd }, input, input.reason, true);
    })(); return this.get(input.id);
  }
  ready(raw: ReadyArticleInput) {
    const input = readyArticleSchema.parse(raw);
    this.db.transaction(() => {
      const article = this.get(input.id);
      if (article.status === 'ready' && article.revision === input.revision + 1 && article.confirmationValid && article.reviewCurrent) return;
      this.version(input); const pack = this.confirmed(article);
      if (!article.reviewCurrent || !article.finalMd.trim() || article.draftVersion !== pack.version) throw new Error('Review the current draft before marking it Ready.');
      this.history(article);
      this.db.prepare("UPDATE articles SET status='ready',ready_at=?,revision=revision+1,updated_at=? WHERE id=?").run(now(), now(), input.id);
      this.decision(article, 'article_review', article.review, { ready: true, digest: this.digest(article), packVersion: pack.version }, input.reason, Boolean(article.review?.issues.length));
    })(); return this.get(input.id);
  }
  runs(): WritingRun[] {
    const rows = this.db.prepare('SELECT id,article_id AS articleId,stage,status,error,started_at AS startedAt,finished_at AS finishedAt,calls_json AS callsJson FROM writing_runs ORDER BY started_at DESC,id DESC').all() as (Omit<WritingRun, 'calls'> & { callsJson: string })[];
    return rows.map(({ callsJson, ...row }) => ({ ...row, calls: JSON.parse(callsJson) as WritingRun['calls'] }));
  }
  run(id: string) { const run = this.runs().find(row => row.id === id); if (!run) throw new Error('Writing run not found.'); return run; }
  start(raw: GenerateWritingInput) {
    const input = generateWritingSchema.parse(raw);
    const existing = this.db.prepare('SELECT id,article_id AS articleId,stage,provider_id AS providerId FROM writing_runs WHERE operation_id=?').get(input.operationId) as { id: string; articleId: string; stage: string; providerId: string } | undefined;
    if (existing) { if (existing.articleId !== input.articleId || existing.stage !== input.stage || existing.providerId !== input.providerId) throw new Error('Generation operation conflicts.'); return this.run(existing.id); }
    const active = this.runs().find(run => run.articleId === input.articleId && run.status === 'running'); if (active) return active;
    const article = this.get(input.articleId); const pack = this.confirmed(article);
    if (input.stage === 'draft' && (!article.outlineMd.trim() || article.outlineVersion !== pack.version)) throw new Error('Generate an outline for the current Fact Pack first.');
    if (input.stage === 'review' && (!article.finalMd.trim() || article.draftVersion !== pack.version)) throw new Error('Generate and edit the current draft first.');
    const id = ulid();
    this.db.prepare("INSERT INTO writing_runs(id,operation_id,article_id,provider_id,stage,input_revision,input_json,status,started_at) VALUES (?,?,?,?,?,?,?,'running',?)")
      .run(id, input.operationId, input.articleId, input.providerId, input.stage, article.revision, JSON.stringify(article), now());
    return this.run(id);
  }
  snapshot(id: string): Article { this.run(id); return JSON.parse((this.db.prepare('SELECT input_json FROM writing_runs WHERE id=?').get(id) as { input_json: string }).input_json) as Article; }
  complete(id: string, raw: WritingOutput, calls: WritingRun['calls']) {
    this.db.transaction(() => {
      const run = this.run(id); if (run.status !== 'running') throw new Error('Writing run is not active.');
      const snapshot = this.snapshot(id); const article = this.version({ id: run.articleId, revision: snapshot.revision }); const pack = this.confirmed(article);
      if (snapshot.factPack?.version !== pack.version) throw new Error('Fact Pack changed during generation.');
      this.history(article);
      if (run.stage === 'review') {
        const review = writingReviewSchema.parse(raw);
        this.db.prepare("UPDATE articles SET review_json=?,review_digest=?,status='review',ready_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(JSON.stringify(review), this.digest(article), now(), article.id);
      } else {
        const output = writingMarkdownSchema.parse(raw);
        if (output.evidenceIds.some(ref => !pack.evidence.some(item => item.id === ref))) throw new Error('Unknown generated evidence reference.');
        if (run.stage === 'outline') this.db.prepare("UPDATE articles SET outline_md=?,outline_version=?,draft_version=NULL,review_digest=NULL,status='outline',ready_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(output.markdown, pack.version, now(), article.id);
        else this.db.prepare("UPDATE articles SET draft_md=?,final_md=?,draft_version=?,review_digest=NULL,status='draft',ready_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(output.markdown, output.markdown, pack.version, now(), article.id);
      }
      this.db.prepare("UPDATE writing_runs SET status='completed',result_json=?,calls_json=?,finished_at=? WHERE id=?").run(JSON.stringify(raw), JSON.stringify(calls), now(), id);
      this.decision(article, 'writing_' + run.stage, raw, null);
    })();
  }
  finish(id: string, status: 'failed'|'canceled', error: string, calls: WritingRun['calls']) { this.db.prepare("UPDATE writing_runs SET status=?,error=?,calls_json=?,finished_at=? WHERE id=? AND status='running'").run(status, error, JSON.stringify(calls), now(), id); }
  recover() { this.db.prepare("UPDATE writing_runs SET status='failed',error='Application closed during this run. Retry explicitly.',finished_at=? WHERE status='running'").run(now()); }
  markdown(id: string): string {
    const article = this.get(id); const pack = this.confirmed(article);
    if (article.status !== 'ready' || !article.reviewCurrent || article.draftVersion !== pack.version) throw new Error('Complete human review before exporting.');
    return `# ${article.title}\n\n${article.finalMd}\n\n## Evidence\n\n${pack.evidence.map(item => `- ${item.title}${item.sourceUrl ? ` — ${item.sourceUrl}` : ''} (${item.kind}: ${item.id})`).join('\n')}\n\n## Limitations\n\n${pack.limitations.map(value => `- ${value}`).join('\n')}\n\nFact Pack version: ${pack.version}\n`;
  }
}
