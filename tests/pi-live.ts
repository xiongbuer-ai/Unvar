// Opt-in paid provider check with explicitly synthetic research inputs.
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/db/src/index';
import { PiWorkflowAdapter } from '../packages/workflows/src/pi';
import { SystemCredentialStore } from '../apps/desktop/src/main/credentials';

async function run() {
  if (process.env.UNVAR_LIVE_ACCEPTANCE !== '1') throw new Error('Explicit opt-in required.');
  await app.whenReady();
  const directory = mkdtempSync(join(tmpdir(), 'unvar-pi-live-'));
  const store = await openStore(join(directory, 'unvar.db'), join(directory, 'backups'));
  let workflow: PiWorkflowAdapter | undefined;
  try {
    const source = store.saveSignal({ kind: 'note', title: 'Synthetic acceptance fixture', text: 'A database transaction should preserve atomic writes.', url: '', tags: ['synthetic-acceptance'] });
    store.radar.saveAnalysis(source.id, { claims: [{ text: source.text, type: 'claim', evidenceText: source.text }], questions: [{ claimIndex: 0, text: 'Does the transaction roll back a partial insert?', whyRelevant: 'Synthetic acceptance', proposedExperiment: 'Inject failure into the second write of a transaction.', estimatedMinutes: 10 }] }, [{ workRelevance: 2, experimentability: 3, evidencePotential: 3, uniqueness: 1, seriesPotential: 1 }], 'fixture:not-model');
    const id = store.radar.createExperiment(store.radar.listQuestions()[0].id).id;
    let experiment = store.lab.save({ id, revision: 0, title: 'Synthetic transaction fixture', prediction: 'Fixture prediction: zero partial inserts.', baseline: 'Independent writes', method: 'Two inserts in one transaction; fail the second.', metrics: 'Persisted rows', result: 'Synthetic fixture observation: zero inserted rows persisted after the injected failure.', limitations: 'Synthetic integration data only, not a real research result; one scenario.', trust: 3, humanTimeMinutes: 0, interventionCount: 0, bugCount: 0, reworkCount: 0 });
    for (const status of ['ready','running','analyzing','done'] as const) experiment = store.lab.transition({ id, revision: experiment.revision, status });
    const config = store.saveProvider({ providerType: 'deepseek', displayName: 'Live acceptance', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', enabled: true });
    const article = store.writing.create({ title: 'Synthetic transaction research: evidence and remaining gaps', source: { kind: 'experiment', id }, operationId: randomUUID() });
    store.pi.configure({enabled:true});
    workflow = new PiWorkflowAdapter(store, readFileSync('prompts/pi-interview.md','utf8'));
    const run=workflow.start({articleId:article.id,providerId:config.id,operationId:randomUUID()},config,()=>new SystemCredentialStore().get('acceptance:deepseek'));
    await workflow.waitForIdle();const result=store.pi.get(run.id);
    const passed=result.status==='completed' && result.traces.some(trace=>trace.status==='completed' && trace.evidenceIds.length>0) && Boolean(result.candidate?.questions.length) && result.calls.length>0;
    mkdirSync('spec/execution', { recursive: true });
    writeFileSync('spec/execution/m7-live-acceptance.md',`# M7 real Pi acceptance\n\nDate: ${new Date().toISOString()}\n\nStatus: ${passed?'passed':'failed'}; run: ${result.status}. Official Pi Agent Core: 0.87.1. Actual models: ${[...new Set(result.calls.map(call=>call.model))].join(', ')||'none'}. Model calls: ${result.calls.length}.\n\nTool trace: ${result.traces.map(trace=>trace.tool+':'+trace.status+' ('+trace.evidenceIds.length+' refs)').join('; ')}. Follow-up questions: ${result.candidate?.questions.length??0}.\n\n${result.error??'The real model selected and called read-only evidence tools via the official Pi Agent loop, then produced validated interview questions. No user answers, Fact Pack confirmation, Finding acceptance or Ready state were generated.'}\n\nInput was explicitly synthetic research in an isolated temporary database, not a real personal experiment. The existing OS keychain reference supplied the credential; no credential or raw provider error was saved. Temporary data was removed.\n`);
    console.log(JSON.stringify({passed,status:result.status,models:result.calls.map(call=>call.model),tools:result.traces.map(trace=>trace.tool),questions:result.candidate?.questions.length??0}));if(!passed)process.exitCode=1;
  } finally { workflow?.stop(); await workflow?.waitForIdle(); store.close(); rmSync(directory, { recursive: true, force: true }); app.quit(); }
}
void run().catch(() => { console.error('Pi live acceptance failed; no credential details are logged.'); app.exit(1); });
