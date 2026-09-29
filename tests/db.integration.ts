import { verifyJev } from './jev.integration';
import { verifyPi } from './pi.integration';
import { verifyDecisions } from './decisions.integration';
import { verifyWriting } from './writing.integration';
import { verifyWorkspaceFolder } from './workspace-folder.integration';
import { verifyFindings } from './finding.integration';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, migrate, migrations, type Store } from '../packages/db/src/index';
import { WorkspaceService } from '../apps/desktop/src/main/workspace-service';
import { SystemCredentialStore, type CredentialStore } from '../apps/desktop/src/main/credentials';

import { verifyLab } from './lab.integration';
import { verifyRadar } from './radar.integration';

async function run() {
  const directory = mkdtempSync(join(tmpdir(), 'unvar-db-test-'));
  const filename = join(directory, 'unvar.db');
  const backups = join(directory, 'backups');
  let store: Store | undefined;
  try {
    await verifyWorkspaceFolder(directory);
    const upgradePath = join(directory, 'upgrade.db');
    let upgraded = await openStore(upgradePath, join(directory, 'upgrade-backups'), migrations.slice(0, 2));
    const oldNote = upgraded.saveSignal({ kind: 'note', title: 'Before Lab migration', text: 'Existing source evidence', url: '', tags: ['upgrade'] });
    upgraded.close();
    upgraded = await openStore(upgradePath, join(directory, 'upgrade-backups'));
    assert.deepEqual(upgraded.getSignal(oldNote.id), oldNote);
    assert.deepEqual(upgraded.lab.list(), []);
    upgraded.close();
    store = await openStore(filename, backups);
    assert.equal(store.db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(store.db.pragma('foreign_keys', { simple: true }), 1);
    const note = store.saveSignal({ kind: 'note', title: 'Persistent observation', text: 'User content', url: '', tags: ['test', 'test'] });
    assert.equal(note.id.length, 26);
    assert.deepEqual(note.tags, ['test']);
    store.saveResearchSettings({ researchFocus: 'Developer tools' });
    store.close();
    store = await openStore(filename, backups);
    assert.deepEqual(store.getSignal(note.id), note);
    assert.equal(store.getResearchSettings().researchFocus, 'Developer tools');
    const edited = store.saveSignal({ id: note.id, kind: note.kind, title: note.title, text: 'Edited content', url: '', tags: ['updated'] });
    assert.deepEqual(edited.tags, ['updated']);
    assert.equal(edited.createdAt, note.createdAt);
    store.setSignalStatus(note.id, 'archived');
    assert.equal(store.listSignals({}).length, 0);
    assert.equal(store.listSignals({ status: 'all', search: 'updated' }).length, 1);
    store.setSignalStatus(note.id, 'inbox');
    assert.equal(store.listSignals({}).length, 1);
    assert.throws(() => store!.db.prepare('INSERT INTO signal_tags VALUES (?, ?)').run('missing', 'bad'));
    assert.throws(() => store!.saveSignal({ kind: 'note', title: '', text: '', url: '', tags: [] }));
    assert.equal(store.listSignals({}).length, 1);

    const fake = new Map<string, string>();
    const credentials: CredentialStore = { get: async (ref) => fake.get(ref) ?? null, set: async (ref, value) => { fake.set(ref, value); }, delete: async (ref) => { fake.delete(ref); } };
    const service = new WorkspaceService(store, credentials);
    const provider = await service.saveProvider({ providerType: 'openai-compatible', displayName: 'Test', baseUrl: 'https://example.com/v1', model: 'mock', enabled: true });
    assert.equal(provider.configured, false);
    await service.setCredential(provider.id, 'fake-private-key');
    assert.equal((await service.listProviders())[0].configured, true);
    assert.equal(JSON.stringify(await service.listProviders()).includes('fake-private-key'), false);
    assert.equal('credentialKeyRef' in (await service.listProviders())[0], false);
    await service.setCredential(provider.id, 'fake-replacement-key');
    assert.deepEqual([...fake.values()], ['fake-replacement-key']);
    await service.deleteCredential(provider.id);
    assert.equal((await service.listProviders())[0].configured, false);

    await verifyRadar(store);
    const recoveryId = verifyLab(store);
    const findingId = await verifyFindings(store);
    const articleId = await verifyWriting(store);
    const decisionId = verifyDecisions(store);
    const piId = await verifyPi(store);
    const jevQuestionId=await verifyJev(store);
    store.close(); store = await openStore(filename, backups);
    assert.ok(store.jev.list(jevQuestionId).length>0);
    assert.equal(store.lab.get(recoveryId).status, 'running');
    assert.equal(store.pi.get(piId).applied, true);
    assert.equal(store.pi.get(piId).traces.length, 2);
    assert.equal(store.decisions.get(decisionId).outcomeHistory.length, 2);
    assert.equal(store.decisions.get(decisionId).outcome, 'Follow-up found a limitation.');
    assert.equal(store.writing.get(articleId).status, 'ready');
    assert.equal(store.writing.get(articleId).confirmationValid, false);
    assert.equal(store.writing.get(articleId).factPack?.version, 2);
    assert.equal(store.findings.get(findingId).status, 'archived');
    assert.equal(store.findings.get(findingId).aiProposal.text, 'The tested transaction prevented partial writes.');
    assert.ok(store.lab.get(recoveryId).timerStartedAt);
    assert.ok(store.lab.logs(recoveryId).some(log => log.text === 'Must survive a full database restart.'));

    const before = store.listSignals({ status: 'all' });
    await assert.rejects(migrate(store.db, backups, [...migrations, { version: migrations.length + 1, sql: "CREATE TABLE should_rollback(id TEXT); INSERT INTO nonexistent VALUES ('fail');" }]));
    assert.deepEqual(store.listSignals({ status: 'all' }), before);
    assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'should_rollback'").get(), undefined);
    assert.equal((store.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number }).count, migrations.length);
    await assert.rejects(migrate(store.db, backups, [{ version: 1, sql: 'modified history' }]));
    assert.ok(readdirSync(backups).length >= 2);
    store.close(); store = undefined;
    assert.equal(readFileSync(filename).includes(Buffer.from('fake-private-key')), false);
    assert.equal(readFileSync(filename).includes(Buffer.from('fake-replacement-key')), false);
    console.log('Database integration passed: restart persistence, tags, archive/search, settings, FK/validation, migration rollback/history, credential projection and replacement/deletion.');

    if (process.env.UNVAR_TEST_KEYCHAIN === '1') {
      const keychain = new SystemCredentialStore('org.unvar.integration-test');
      const reference = `test-${Date.now()}`;
      try {
        await keychain.set(reference, 'fake-unvar-test-key');
        assert.equal(await keychain.get(reference), 'fake-unvar-test-key');
        await keychain.set(reference, 'fake-unvar-test-replacement');
        assert.equal(await keychain.get(reference), 'fake-unvar-test-replacement');
        await keychain.delete(reference);
        assert.equal(await keychain.get(reference), null);
        console.log('OS credential integration passed: save, read in main-side adapter, replace, delete.');
      } finally { await keychain.delete(reference); }
    }
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
