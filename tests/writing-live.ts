// Opt-in paid provider check with explicitly synthetic research inputs.
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/db/src/index';
import { HttpLLMProvider } from '../packages/llm/src/index';
import { RadarWorkflow, WritingWorkflow } from '../packages/workflows/src/index';
import { FindingWorkflow } from '../packages/workflows/src/finding';
import { SystemCredentialStore } from '../apps/desktop/src/main/credentials';

async function run() {
  if (process.env.UNVAR_LIVE_ACCEPTANCE !== '1') throw new Error('Explicit opt-in required.');
  await app.whenReady();
  const directory = mkdtempSync(join(tmpdir(), 'unvar-writing-live-'));
  const store = await openStore(join(directory, 'unvar.db'), join(directory, 'backups'));
  let workflow: FindingWorkflow | undefined;
  let writing: WritingWorkflow | undefined;
  let radar: RadarWorkflow | undefined;
  try {
    const source = store.saveSignal({ kind: 'note', title: 'Synthetic acceptance fixture', text: 'A database transaction should preserve atomic writes.', url: '', tags: ['synthetic-acceptance'] });
    const config = store.saveProvider({ providerType: 'deepseek', displayName: 'Live acceptance', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', enabled: true });
    const provider = new HttpLLMProvider(config, () => new SystemCredentialStore().get('acceptance:deepseek'));
    store.saveResearchSettings({ researchFocus: 'Local desktop data integrity and SQLite transactions' });
    radar = new RadarWorkflow(store, { analysis: readFileSync('prompts/radar.md', 'utf8'), score: readFileSync('prompts/question-score.md', 'utf8') });
    const analysis = radar.start(source.id, provider); await radar.waitForIdle();
    if (store.radar.listRuns().find(run => run.id === analysis.id)?.status !== 'completed') throw new Error('Live Radar did not complete.');
    const id = store.radar.createExperiment(store.radar.listQuestions()[0].id).id;
    let experiment = store.lab.save({ id, revision: 0, title: 'Synthetic transaction fixture', prediction: 'Fixture prediction: zero partial inserts.', baseline: 'Independent writes', method: 'Two inserts in one transaction; fail the second.', metrics: 'Persisted rows', result: 'Synthetic fixture observation: zero inserted rows persisted after the injected failure.', limitations: 'Synthetic integration data only, not a real research result; one scenario.', trust: 3, humanTimeMinutes: 0, interventionCount: 0, bugCount: 0, reworkCount: 0 });
    for (const status of ['ready','running','analyzing','done'] as const) experiment = store.lab.transition({ id, revision: experiment.revision, status });
    workflow = new FindingWorkflow(store, readFileSync('prompts/finding.md', 'utf8'));
    const started = workflow.start({ experimentIds: [id], providerId: config.id, operationId: randomUUID() }, provider);
    await workflow.waitForIdle();
    const outcome = store.findings.run(started.id);
    const candidate = outcome.findingId ? store.findings.get(outcome.findingId) : undefined;
    if (!candidate || candidate.status !== 'candidate' || candidate.confirmedAt || !provider.calls.length) throw new Error('Live Finding did not produce a candidate.');
    // Explicit synthetic test-driver approvals, never recorded as a real user's research.
    const accepted = store.findings.review({ id: candidate.id, revision: candidate.revision, action: 'accept', reason: 'Synthetic acceptance driver approval only; not a real author confirmation.' });
    let article = store.writing.create({ title: 'Synthetic transaction acceptance walkthrough', source: { kind: 'finding', id: accepted.id }, operationId: randomUUID() });
    article = store.writing.saveInterview({ id: article.id, revision: article.revision, title: article.title, answers: { observations: 'Synthetic fixture reports zero partial rows.', experience: '', opinions: '', unknowns: 'No actual research or cross-platform conclusion is established by this fixture.' } });
    article = store.writing.buildPack({ id: article.id, revision: article.revision });
    article = store.writing.confirm({ id: article.id, revision: article.revision, version: article.factPack!.version });
    writing = new WritingWorkflow(store, readFileSync('prompts/writing.md', 'utf8'));
    for (const stage of ['outline','draft','review'] as const) {
      const run = writing.start({ articleId: article.id, providerId: config.id, stage, operationId: randomUUID() }, provider);
      await writing.waitForIdle();
      if (store.writing.run(run.id).status !== 'completed') throw new Error('Live Writing stage did not complete.');
    }
    article = store.writing.get(article.id);
    const passed = article.status === 'review' && article.reviewCurrent && article.confirmationValid && article.finalMd.length > 0;
    mkdirSync('spec/execution', { recursive: true });
    writeFileSync('spec/execution/m5-live-acceptance.md', `# M5 real-provider Golden Path\n\nDate: ${new Date().toISOString()}\n\nStatus: ${passed ? 'passed' : 'failed'}. Actual response models: ${[...new Set(provider.calls.map(call => call.model))].join(', ')}. Requests: ${provider.calls.length}.\n\nReal calls: Signal → Claim/Question → scoring → Finding Candidate → Outline → Draft → Review. The test driver supplied an explicitly synthetic experiment and interview, and explicit synthetic Finding/Fact Pack approvals. These are test fixtures, not personal experiences, human research or end-user acceptance. The model did not perform confirmations.\n\nSaved article state: ${article.status}; current Fact Pack: ${article.factPack?.version}; current review: ${article.reviewCurrent}. Draft characters: ${article.finalMd.length}; review issues: ${article.review?.issues.length}. No automatic Ready, export, publication or human review was fabricated. Final human Ready/export is covered separately by mock integration and desktop interaction tests.\n\nThe isolated temporary database was closed and removed. Existing OS keychain credentials were not persisted or logged.\n`);
    console.log(JSON.stringify({ passed, status: article.status, models: [...new Set(provider.calls.map(call => call.model))], requests: provider.calls.length }));
    if (!passed) process.exitCode = 1;
  } finally { radar?.stop(); workflow?.stop(); writing?.stop(); await Promise.all([radar?.waitForIdle(), workflow?.waitForIdle(), writing?.waitForIdle()]); store.close(); rmSync(directory, { recursive: true, force: true }); app.quit(); }
}
void run().catch(() => { console.error('Writing live acceptance failed; no credential details are logged.'); app.exit(1); });
