// Opt-in paid provider check with explicitly synthetic research inputs.
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/db/src/index';
import { HttpLLMProvider } from '../packages/llm/src/index';
import { FindingWorkflow } from '../packages/workflows/src/finding';
import { SystemCredentialStore } from '../apps/desktop/src/main/credentials';

async function run() {
  if (process.env.UNVAR_LIVE_ACCEPTANCE !== '1') throw new Error('Explicit opt-in required.');
  await app.whenReady();
  const directory = mkdtempSync(join(tmpdir(), 'unvar-finding-live-'));
  const store = await openStore(join(directory, 'unvar.db'), join(directory, 'backups'));
  let workflow: FindingWorkflow | undefined;
  try {
    const source = store.saveSignal({ kind: 'note', title: 'Synthetic acceptance fixture', text: 'A database transaction should preserve atomic writes.', url: '', tags: ['synthetic-acceptance'] });
    store.radar.saveAnalysis(source.id, { claims: [{ text: source.text, type: 'claim', evidenceText: source.text }], questions: [{ claimIndex: 0, text: 'Does the transaction roll back a partial insert?', whyRelevant: 'Synthetic acceptance', proposedExperiment: 'Inject failure into the second write of a transaction.', estimatedMinutes: 10 }] }, [{ workRelevance: 2, experimentability: 3, evidencePotential: 3, uniqueness: 1, seriesPotential: 1 }], 'fixture:not-model');
    const id = store.radar.createExperiment(store.radar.listQuestions()[0].id).id;
    let experiment = store.lab.save({ id, revision: 0, title: 'Synthetic transaction fixture', prediction: 'Fixture prediction: zero partial inserts.', baseline: 'Independent writes', method: 'Two inserts in one transaction; fail the second.', metrics: 'Persisted rows', result: 'Synthetic fixture observation: zero inserted rows persisted after the injected failure.', limitations: 'Synthetic integration data only, not a real research result; one scenario.', trust: 3, humanTimeMinutes: 0, interventionCount: 0, bugCount: 0, reworkCount: 0 });
    for (const status of ['ready','running','analyzing','done'] as const) experiment = store.lab.transition({ id, revision: experiment.revision, status });
    const config = store.saveProvider({ providerType: 'deepseek', displayName: 'Live acceptance', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', enabled: true });
    const provider = new HttpLLMProvider(config, () => new SystemCredentialStore().get('acceptance:deepseek'));
    workflow = new FindingWorkflow(store, readFileSync('prompts/finding.md', 'utf8'));
    const started = workflow.start({ experimentIds: [id], providerId: config.id, operationId: randomUUID() }, provider);
    await workflow.waitForIdle();
    const outcome = store.findings.run(started.id);
    const candidate = outcome.findingId ? store.findings.get(outcome.findingId) : undefined;
    const passed = outcome.status === 'completed' && candidate?.status === 'candidate' && candidate.confirmedAt === null && candidate.evidence.length > 0 && provider.calls.length > 0;
    mkdirSync('spec/execution', { recursive: true });
    writeFileSync('spec/execution/m4-live-acceptance.md', `# M4 real-provider integration\n\nDate: ${new Date().toISOString()}\n\nStatus: ${passed ? 'passed' : 'failed'}; run: ${outcome.status}. Actual response models: ${provider.calls.map(call => call.model).join(', ') || 'none'}. Requests: ${provider.calls.length}.\n\nInput was an explicitly synthetic completed experiment in a temporary isolated database, not a user-authored research result. The real DeepSeek call produced ${candidate ? 'one validated candidate with ' + candidate.evidence.length + ' selected experiment evidence reference(s)' : 'no saved candidate'}. Automatic acceptance: ${candidate?.confirmedAt ? 'unexpected' : 'none'}. No human confirmation was fabricated.\n\n${outcome.error ?? 'The temporary database was closed and removed. Credentials were read from the existing OS keychain reference and were not persisted or logged.'}\n`);
    console.log(JSON.stringify({ passed, status: outcome.status, model: provider.calls.map(call => call.model), requests: provider.calls.length }));
    if (!passed) process.exitCode = 1;
  } finally { workflow?.stop(); await workflow?.waitForIdle(); store.close(); rmSync(directory, { recursive: true, force: true }); app.quit(); }
}
void run().catch(() => { console.error('Finding live acceptance failed; no credential details are logged.'); app.exit(1); });
