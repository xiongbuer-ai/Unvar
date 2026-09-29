import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../packages/db/src/index';
async function run() {
  const directory = process.argv[2]; if (!directory) throw new Error('Test profile required.');
  const store = await openStore(join(directory, 'unvar.db'), join(directory, 'backups'));
  try {
    const signal = store.saveSignal({ kind: 'note', title: 'Lab smoke source', text: 'Transactions prevent partial updates.', url: '', tags: ['test-fixture'] });
    store.radar.saveAnalysis(signal.id, { claims: [{ text: signal.text, type: 'claim', evidenceText: signal.text }], questions: [{ claimIndex: 0, text: 'Lab smoke experiment', whyRelevant: 'Test fixture', proposedExperiment: 'Inject a failed write', estimatedMinutes: 10 }] }, [{ workRelevance: 2, experimentability: 3, evidencePotential: 3, uniqueness: 1, seriesPotential: 1 }], 'mock:smoke-fixture');
    store.radar.createExperiment(store.radar.listQuestions()[0].id);
    const evidenceSignal = store.saveSignal({ kind: 'note', title: 'Finding smoke source', text: 'Synthetic result fixture, not user research.', url: '', tags: ['test-fixture'] });
    store.radar.saveAnalysis(evidenceSignal.id, { claims: [{ text: evidenceSignal.text, type: 'claim', evidenceText: evidenceSignal.text }], questions: [{ claimIndex: 0, text: 'Finding evidence fixture', whyRelevant: 'Test fixture', proposedExperiment: 'Check fixture rollback', estimatedMinutes: 10 }] }, [{ workRelevance: 2, experimentability: 3, evidencePotential: 3, uniqueness: 1, seriesPotential: 1 }], 'mock:smoke-fixture');
    const id = store.radar.createExperiment(store.radar.listQuestions().find(item => item.text === 'Finding evidence fixture')!.id).id;
    let experiment = store.lab.get(id);
    experiment = store.lab.save({ id, revision: experiment.revision, title: experiment.title, method: experiment.method, prediction: 'Synthetic prediction fixture.', baseline: 'Independent writes', metrics: 'Row count', result: 'No partial writes survived in this fixture.', limitations: 'Synthetic desktop test only.', trust: 3, humanTimeMinutes: 0, interventionCount: 0, bugCount: 0, reworkCount: 0 });

    for (const status of ['ready','running','analyzing','done'] as const) experiment = store.lab.transition({ id, revision: experiment.revision, status });
    const provider = store.saveProvider({ providerType: 'openai-compatible', displayName: 'Mock finding fixture', baseUrl: 'https://example.com/v1', model: 'mock:smoke-fixture', enabled: false });
    const run = store.findings.start({ experimentIds: [id], providerId: provider.id, operationId: randomUUID() });
    store.findings.complete(run.id, { text: 'Fixture finding: rollback preserved rows.', confidence: 'low', counterEvidence: 'Synthetic fixture only.', evidence: [{ experimentId: id, relation: 'supports', note: 'Fixture result.' }] }, [{ model: 'mock:smoke-fixture', durationMs: 0, usage: {} }]);
  } finally { store.close(); }
}
void run().catch(() => { console.error('Desktop fixture setup failed.'); process.exitCode = 1; });
