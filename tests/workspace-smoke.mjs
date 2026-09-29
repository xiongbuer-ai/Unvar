import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, access, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { _electron } from 'playwright-core';

const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), 'unvar-workspace-smoke-')));
const profile = join(root, 'profile'); const target = join(root, 'synced-workspace');
await mkdir(profile); await mkdir(target);
const env = { ...process.env, UNVAR_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
let application;
async function launch() {
  application = await _electron.launch({ executablePath: require('electron'), args: [desktop], env });
  const page = await application.firstWindow();
  await page.locator('.brand-mark').waitFor();
  return page;
}
async function switchFolder(page, path, mode) {
  // Drive the real IPC/quit/backup path, replacing only OS chooser and automatic respawn.
  await application.evaluate(({ dialog, app }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    app.relaunch = () => {};
  }, path);
  const exited = once(application.process(), 'exit');
  await page.evaluate(mode => window.unvar.chooseWorkspaceFolder(mode), mode).catch(error => {
    if (!String(error).includes('closed')) throw error;
  });
  await exited; application = undefined;
}
try {
  const seed = fileURLToPath(new URL('../.cache/seed-workspace-smoke.cjs', import.meta.url));
  await build({ entryPoints: [fileURLToPath(new URL('./seed-desktop.ts', import.meta.url))], outfile: seed, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'native', setup(builder) { builder.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3'), external: true })); } }] });
  assert.equal(spawnSync(require('electron'), [seed, profile], { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }).status, 0);
  let page = await launch();
  const source = (await page.evaluate(() => window.unvar.getWorkspaceFolder())).path;
  assert.equal(source, join(profile, 'workspace'));
  await access(join(profile, 'unvar.db')); // legacy original retained
  assert.ok((await page.evaluate(() => window.unvar.listSignals({ status: 'all' }))).length > 0);
  const note = await page.evaluate(async () => {
    await window.unvar.saveInterfacePreferences({ locale: 'en' });
    await window.unvar.saveResearchSettings({ researchFocus: 'Portable workspace verification' });
    return window.unvar.saveSignal({ kind: 'note', title: 'Workspace copy check', text: 'Saved before migration', tags: ['portable'], url: '' });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open settings' }).click();
  await page.getByRole('heading', { name: 'Workspace folder' }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL('../test-results/workspace-settings.png', import.meta.url)) });
  await switchFolder(page, target, 'copy');
  assert.equal(JSON.parse(await readFile(join(profile, 'workspace-location.json'), 'utf8')).path, target);
  await access(join(source, 'unvar.db'));
  await rm(join(target, 'materials'), { recursive: true }); // Git does not preserve empty folders.
  page = await launch();
  await access(join(target, 'materials'));
  assert.equal((await page.evaluate(() => window.unvar.getWorkspaceFolder())).path, target);
  assert.deepEqual(await page.evaluate(() => window.unvar.getInterfacePreferences()), { locale: 'en' });
  assert.equal((await page.evaluate(() => window.unvar.getResearchSettings())).researchFocus, 'Portable workspace verification');
  assert.ok((await page.evaluate(() => window.unvar.listSignals({ status: 'all' }))).some(row => row.id === note.id));
  const second = await page.evaluate(() => window.unvar.saveSignal({ kind: 'note', title: 'Only in copied workspace', text: 'Separate database', tags: [], url: '' }));
  await switchFolder(page, source, 'open');
  page = await launch();
  assert.equal((await page.evaluate(() => window.unvar.getWorkspaceFolder())).path, source);
  assert.equal((await page.evaluate(() => window.unvar.listSignals({ status: 'all' }))).some(row => row.id === second.id), false);
  console.log('Workspace smoke passed: legacy migration, settings UI, SQLite copy, pointer persistence, preferences, restart and opening an existing workspace.');
} finally {
  if (application) await application.close();
  await rm(root, { recursive: true, force: true });
}
