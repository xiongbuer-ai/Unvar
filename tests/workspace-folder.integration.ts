import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../packages/db/src/index';
import { WorkspaceFolder, initializeWorkspace, copyWorkspace, validateWorkspace, assertCopyDestination } from '../apps/desktop/src/main/workspace-folder';

export async function verifyWorkspaceFolder(root: string) {
  root = realpathSync(root);
  const profile = join(root, 'portable-profile'); mkdirSync(profile);
  const manager = new WorkspaceFolder(profile);
  initializeWorkspace(manager.path);
  const source = await openStore(join(manager.path, 'unvar.db'), join(manager.path, 'backups'));
  const target = join(root, 'synced workspace'); mkdirSync(target);
  try {
    source.db.pragma('wal_autocheckpoint = 0');
    const note = source.saveSignal({ kind: 'note', title: 'Portable evidence', text: 'Must include WAL writes', url: '', tags: ['sync'] });
    source.saveResearchSettings({ researchFocus: 'Portable research' });
    const provider = source.saveProvider({ providerType: 'deepseek', displayName: 'Portable provider', baseUrl: 'https://api.deepseek.com', model: 'test-model', enabled: true });
    manager.savePreferences({ locale: 'en' });
    writeFileSync(join(manager.path, 'materials', 'source.md'), 'Original source');
    writeFileSync(join(manager.path, 'exports', 'finding.md'), 'User export');
    writeFileSync(join(manager.path, 'cache', 'temporary'), 'not portable');
    manager.select(manager.path);
    assert.throws(() => assertCopyDestination(manager.path, manager.path));
    const nested = join(manager.path, 'nested'); mkdirSync(nested);
    assert.throws(() => assertCopyDestination(manager.path, nested));
    const dotNested = join(manager.path, '..notes'); mkdirSync(dotNested);
    assert.throws(() => assertCopyDestination(manager.path, dotNested));
    const occupied = join(root, 'occupied'); mkdirSync(occupied); writeFileSync(join(occupied, 'keep'), 'Do not overwrite');
    await assert.rejects(copyWorkspace(manager.path, occupied, file => source.db.backup(file)));
    assert.equal(readFileSync(join(occupied, 'keep'), 'utf8'), 'Do not overwrite');
    const failed = join(root, 'failed'); mkdirSync(failed);
    await assert.rejects(copyWorkspace(manager.path, failed, async () => { throw new Error('disk full'); }));
    assert.equal(existsSync(join(failed, 'unvar-workspace.json')), false);
    assert.equal(new WorkspaceFolder(profile).path, manager.path);
    await copyWorkspace(manager.path, target, file => source.db.backup(file));
    assert.equal(validateWorkspace(target), target);
    const restored = await openStore(join(target, 'unvar.db'), join(target, 'backups'));
    try {
      assert.deepEqual(restored.getSignal(note.id), note);
      assert.equal(restored.getResearchSettings().researchFocus, 'Portable research');
      assert.equal(restored.getProvider(provider.id).model, 'test-model');
      assert.equal(restored.db.pragma('integrity_check', { simple: true }), 'ok');
    } finally { restored.close(); }
    manager.select(target);
    const reopened = new WorkspaceFolder(profile);
    assert.equal(reopened.path, target);
    assert.deepEqual(reopened.preferences(), { locale: 'en' });
    assert.equal(readFileSync(join(target, 'materials', 'source.md'), 'utf8'), 'Original source');
    assert.equal(readFileSync(join(target, 'exports', 'finding.md'), 'utf8'), 'User export');
    assert.equal(existsSync(join(target, 'cache', 'temporary')), false);
    assert.deepEqual(source.getSignal(note.id), note);
    assert.throws(() => manager.select(occupied));
    assert.equal(new WorkspaceFolder(profile).path, target);
    writeFileSync(join(target, 'unvar-workspace.json'), '{"format":"unvar-workspace","version":999}');
    assert.throws(() => new WorkspaceFolder(profile));
  } finally { source.close(); }
}
