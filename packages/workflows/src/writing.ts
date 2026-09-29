import type { Store } from '@unvar/db';
import { writingMarkdownSchema, writingReviewSchema, type WritingRun, type GenerateWritingInput, type WritingOutput } from '@unvar/shared';
import { ProviderError, type LLMProvider } from '@unvar/llm';

export class WritingWorkflow {
  private active = new Map<string, AbortController>();
  private pending = new Set<Promise<void>>();
  constructor(private store: Store, private prompt: string, private timeoutMs = 120000) {}
  start(input: GenerateWritingInput, provider: LLMProvider): WritingRun {
    const run = this.store.writing.start(input);
    if (run.status !== 'running' || this.active.has(run.id)) return run;
    const controller = new AbortController(); this.active.set(run.id, controller);
    const task = Promise.resolve().then(() => this.execute(run, provider, controller));
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return run;
  }
  cancel(id: string) { this.active.get(id)?.abort(); }
  stop() { for (const controller of this.active.values()) controller.abort(); }
  async waitForIdle() { await Promise.allSettled([...this.pending]); }
  private async execute(run: WritingRun, provider: LLMProvider, controller: AbortController) {
    const signal = controller.signal;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const callsStart = provider.calls?.length ?? 0;
    let onAbort: () => void = () => {};
    const calls = () => provider.calls?.slice(callsStart) ?? [];
    try {
      signal.throwIfAborted();
      const article = this.store.writing.snapshot(run.id);
      const ids = article.factPack!.evidence.map(item => item.id);
      const markdown = writingMarkdownSchema.refine(value => value.evidenceIds.every(id => ids.includes(id)), 'Use only supplied evidence IDs.');
      const prompt = JSON.stringify({ stage: run.stage, title: article.title, factPack: article.factPack,
        outline: run.stage === 'outline' ? undefined : article.outlineMd, draft: run.stage === 'review' ? article.finalMd : undefined });
      if (prompt.length > 160000) throw new Error('Writing input exceeds the generation limit.');
      const generation: Promise<WritingOutput> = run.stage === 'review'
        ? provider.generateStructured({ system: this.prompt, prompt, schema: writingReviewSchema, signal })
        : provider.generateStructured({ system: this.prompt, prompt, schema: markdown, signal });
      const output = await Promise.race([generation,
        new Promise<never>((_resolve, reject) => { onAbort = () => reject(new Error('Canceled')); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); }),
      ]);
      signal.throwIfAborted();
      this.store.writing.complete(run.id, output, calls());
    } catch (error) {
      const message = timedOut ? 'Writing generation timed out. Retry explicitly.' : signal.aborted ? 'Canceled by user.' : error instanceof ProviderError ? error.message : 'Writing generation failed validation or the article changed. No generated content was saved.';
      this.store.writing.finish(run.id, signal.aborted && !timedOut ? 'canceled' : 'failed', message, calls());
    } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); this.active.delete(run.id); }
  }
}
