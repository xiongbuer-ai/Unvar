import type { Store } from '@unvar/db';
import { analysisSchema, type ScoreEvaluation, type QuestionScores, type WorkflowRun } from '@unvar/shared';
import { ProviderError, type LLMProvider } from '@unvar/llm';
import { FetchError, fetchSource, normalizeUrl } from '@unvar/fetcher';
import { LLMDecisionEngine } from '@unvar/decision';

export class RadarWorkflow {
  private active = new Map<string, AbortController>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private store: Store, private prompts: { analysis: string; score: string }, private fetcher = fetchSource, private scoring?: {enabled():boolean; evaluate(input:import('@unvar/decision').ScoreQuestionInput,signal?:AbortSignal):Promise<ScoreEvaluation>}) {}
  start(signalId: string, provider: LLMProvider): WorkflowRun {
    this.store.getSignal(signalId);
    const existing = this.store.radar.listRuns().find((run) => run.entityId === signalId && run.status === 'running');
    if (existing) return existing;
    const run = this.store.radar.startRun(signalId);
    const controller = new AbortController(); this.active.set(run.id, controller);
    // Serial analysis avoids duplicate work across URLs which resolve to identical content.
    this.queue = this.queue.then(() => this.execute(run, provider, controller)).catch(() => {
      this.store.radar.updateRun(run.id, 'failed', 'failed', 'Analysis could not be persisted. Retry explicitly.');
    });
    return run;
  }
  cancel(runId: string) { this.active.get(runId)?.abort(); }
  async waitForIdle() { await this.queue; }
  stop() { for (const controller of this.active.values()) controller.abort(); }
  private async execute(run: WorkflowRun, provider: LLMProvider, controller: AbortController) {
    const signal = controller.signal;
    const repository = this.store.radar;
    const callsStart = provider.calls?.length ?? 0;
    try {
      signal.throwIfAborted();
      let sourceId = repository.canonicalSignal(run.entityId);
      let source = this.store.getSignal(sourceId);
      if (source.kind === 'url') {
        const normalized = normalizeUrl(source.url);
        const duplicate = repository.existingSource(normalized);
        if (duplicate) { repository.linkDuplicate(sourceId, duplicate); sourceId = duplicate; source = this.store.getSignal(sourceId); }
        if (!repository.cachedSource(sourceId)) {
          repository.updateRun(run.id, 'fetching');
          const fetched = await this.fetcher(source.url, signal);
          signal.throwIfAborted();
          sourceId = repository.cacheSource(sourceId, fetched);
          source = this.store.getSignal(sourceId);
        }
      }
      if (repository.hasAnalysis(sourceId)) { repository.updateRun(run.id, 'reused_existing_analysis', 'completed', null, { sourceId, reused: true }); return; }
      const cached = repository.cachedSource(sourceId);
      const sourceText = (cached?.text ?? source.text).replace(/\s+/g, ' ').trim().slice(0, 45000);
      if (!sourceText) throw new FetchError('Source has no text to analyze.');
      const researchFocus = this.store.getResearchSettings().researchFocus;
      repository.updateRun(run.id, 'extracting_claims_and_questions');
      const schema = analysisSchema.refine((value) => value.claims.every((claim) => claim.evidenceText.length > 0 && sourceText.includes(claim.evidenceText)), 'Claim excerpts must occur in sourceText.');
      const analysis = await provider.generateStructured({ system: this.prompts.analysis, prompt: JSON.stringify({ sourceTitle: cached?.title ?? source.title, sourceText, researchFocus }), schema, signal });
      const validated = schema.parse(analysis);
      repository.updateRun(run.id, 'scoring_questions');
      const engine = new LLMDecisionEngine(provider, this.prompts.score);
      const scores: QuestionScores[] = [];
      const evaluations:ScoreEvaluation[]=[];const useJev=this.scoring?.enabled();
      for (const question of validated.questions) {
        signal.throwIfAborted();
        const input={ question: question.text, proposedExperiment: question.proposedExperiment, claim: validated.claims[question.claimIndex].text, researchFocus };
        if(useJev){const evaluation=await this.scoring!.evaluate(input,signal);evaluations.push(evaluation);scores.push(evaluation.scores);}else scores.push(await engine.scoreQuestion(input,signal));
      }
      signal.throwIfAborted();
      this.store.db.transaction(() => {
        repository.saveAnalysis(sourceId, validated, scores, `llm:${provider.id}`, useJev?evaluations:undefined);
        repository.updateRun(run.id, 'completed', 'completed', null, { sourceId, providerId: provider.id, questions: validated.questions.length, calls: provider.calls?.slice(callsStart) ?? [] });
      })();
    } catch (error) {
      const message = signal.aborted ? 'Canceled by user.' : error instanceof ProviderError || error instanceof FetchError ? error.message : 'Analysis failed validation or storage. No partial claims/questions were saved.';
      repository.updateRun(run.id, signal.aborted ? 'canceled' : 'failed', signal.aborted ? 'canceled' : 'failed', message, { providerId: provider.id, calls: provider.calls?.slice(callsStart) ?? [] });
    } finally { this.active.delete(run.id); }
  }
}

export { fetchProxySource } from '@unvar/fetcher';
export { FindingWorkflow } from './finding';
export { WritingWorkflow } from './writing';
export { PiWorkflowAdapter } from './pi';

export { JevScoringService } from './jev';
