// Explicit opt-in acceptance harness; excluded from ordinary unit tests.
import { app } from 'electron';
import { fetchDesktopSource } from '../apps/desktop/src/main/source-fetcher';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../packages/db/src/index';
import { HttpLLMProvider } from '../packages/llm/src/index';
import { RadarWorkflow } from '../packages/workflows/src/index';
import { SystemCredentialStore } from '../apps/desktop/src/main/credentials';
const urls = [
  'https://www.sqlite.org/wal.html',
  'https://www.sqlite.org/foreignkeys.html',
  'https://www.sqlite.org/atomiccommit.html',
  'https://www.electronjs.org/docs/latest/tutorial/security',
  'https://www.electronjs.org/docs/latest/tutorial/context-isolation',
  'https://www.electronjs.org/docs/latest/tutorial/sandbox',
  'https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
  'https://api-docs.deepseek.com/quick_start/rate_limit',
  'https://developer.mozilla.org/en-US/docs/Web/API/AbortController',
  'https://developer.mozilla.org/en-US/docs/Web/API/URL',
];
async function run() {
  if (process.env.UNVAR_LIVE_ACCEPTANCE !== '1') throw new Error('Explicit opt-in required.');
  await app.whenReady();
  const directory = mkdtempSync(join(tmpdir(), 'unvar-radar-live-'));
  const store = await openStore(join(directory, 'unvar.db'), join(directory, 'backups'));
  store.saveResearchSettings({ researchFocus: 'Acceptance fixture: reliable local-first TypeScript desktop research tools, databases, security and LLM workflows.' });
  const provider = new HttpLLMProvider({ id: 'live-deepseek', providerType: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, () => new SystemCredentialStore().get('acceptance:deepseek'));
  const workflow = new RadarWorkflow(store, { analysis: readFileSync('prompts/radar.md', 'utf8'), score: readFileSync('prompts/question-score.md', 'utf8') }, fetchDesktopSource);
  const rows: string[] = [];
  try {
    const textOnly = process.env.UNVAR_LIVE_TEXT_ONLY === '1';
    for (const url of textOnly ? ['Text fixture: transaction experiment'] : urls) {
      const source = store.saveSignal(textOnly
        ? { kind: 'note', title: url, text: 'A proposed research claim: grouping related database writes in a transaction prevents partially saved records when one write fails. This should be checked by injecting a failure between two related writes and inspecting the database after restart. No experiment has been performed yet.', url: '', tags: ['acceptance'] }
        : { kind: 'url', title: '', text: '', url, tags: ['acceptance'] });
      const run = workflow.start(source.id, provider);
      await workflow.waitForIdle();
      const result = store.radar.listRuns().find(item => item.id === run.id)!;
      const questions = store.radar.listQuestions().filter(item => item.signalId === store.radar.canonicalSignal(source.id));
      rows.push(`| ${url} | ${result.status} | ${questions.length} | ${result.errorMessage ?? 'Real DeepSeek analysis and scoring'} |`);
      mkdirSync('spec/execution', { recursive: true });
      writeFileSync(textOnly ? 'spec/execution/m2-live-text-acceptance.md' : 'spec/execution/m2-live-acceptance.md', `# M2 real-provider acceptance\n\nDate: ${new Date().toISOString()}\n\nEngine: LLM; configured model: deepseek-flash. Research context is a test fixture, not a user-authored profile. Credentials are read from the OS keychain.\n\n| URL | Status | Questions | Detail |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\nCompleted ${rows.length}/${textOnly ? 1 : 10} ${textOnly ? 'text-fixture' : 'URL'} attempts. Actual response models: ${[...new Set(provider.calls.map(call => call.model))].join(', ')}. Requests: ${provider.calls.length}. Report contains no credential or response headers.\n`);
      console.log(JSON.stringify({ url, status: result.status, questions: questions.length, error: result.errorMessage }));
    }
  } finally { workflow.stop(); await workflow.waitForIdle(); store.close(); app.quit(); }
}
void run().catch(() => { console.error('Live acceptance failed; inspect the sanitized report.'); app.exit(1); });
