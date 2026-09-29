import type { Store } from '@unvar/db';
import { findingCandidateSchema, type FindingRun, type GenerateFindingInput } from '@unvar/shared';
import { ProviderError, type LLMProvider } from '@unvar/llm';

export class FindingWorkflow {
  private active = new Map<string, AbortController>();
  private pending = new Set<Promise<void>>();
  constructor(private store: Store, private prompt: string, private timeoutMs = 120000) {}
  start(input: GenerateFindingInput, provider: LLMProvider): FindingRun {
    const run = this.store.findings.start(input);
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
  private async execute(run: FindingRun, provider: LLMProvider, controller: AbortController) {
    const signal = controller.signal;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    const callsStart = provider.calls?.length ?? 0;
    let onAbort: () => void = () => {};
    const calls = () => provider.calls?.slice(callsStart) ?? [];
    try {
      signal.throwIfAborted();
      const schema = findingCandidateSchema.refine(value => value.evidence.every(item => run.experimentIds.includes(item.experimentId)), 'Evidence may only reference selected experiment IDs.');
      const experiments = this.store.findings.snapshot(run.id);
      // Supply only the selected experiment records. No library-wide or credential data is sent.
      const prompt = JSON.stringify({ experiments, outputLanguage: 'Use the language of the experiment results.' });
      if (prompt.length > 160000) throw new Error('Selected evidence exceeds the generation limit.');
      const candidate = await Promise.race([
        provider.generateStructured({ system: this.prompt, prompt, schema, signal }),
        new Promise<never>((_resolve, reject) => { onAbort = () => reject(new Error('Canceled')); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); }),
      ]);
      signal.throwIfAborted();
      this.store.findings.complete(run.id, schema.parse(candidate), calls());
    } catch (error) {
      const message = timedOut ? 'Finding generation timed out. Retry explicitly.' : signal.aborted ? 'Canceled by user.' : error instanceof ProviderError ? error.message : 'Finding generation failed validation or storage. No candidate was saved.';
      this.store.findings.finish(run.id, signal.aborted && !timedOut ? 'canceled' : 'failed', message, calls());
    } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); this.active.delete(run.id); }
  }
}
