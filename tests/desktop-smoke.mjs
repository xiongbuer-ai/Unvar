import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';

const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const mode = process.env.UNVAR_SMOKE_CDP ? 'development' : 'built';
const directory = await mkdtemp(join(tmpdir(), 'unvar-desktop-test-'));
const appSnapshot = await mkdtemp(join(tmpdir(), 'unvar-app-snapshot-'));
const env = { ...process.env, UNVAR_USER_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
let application;
let browser;
const launch = () => electron.launch({ executablePath: require('electron'), args: [appSnapshot], env });
try {
  if (mode === 'built') {
    // Keep all restart assertions on the same build even when another dev session rebuilds out/.
    await cp(join(desktop, 'out'), join(appSnapshot, 'out'), { recursive: true });
    await cp(join(desktop, 'package.json'), join(appSnapshot, 'package.json'));
    await symlink(join(desktop, 'node_modules'), join(appSnapshot, 'node_modules'));
    const fixture = fileURLToPath(new URL('../.cache/seed-desktop.cjs', import.meta.url));
    await build({ entryPoints: [fileURLToPath(new URL('./seed-desktop.ts', import.meta.url))], outfile: fixture, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'native', setup(builder) {
      builder.onResolve({ filter: /^better-sqlite3$/ }, args => ({ path: require.resolve(args.path), external: true }));
    } }] });
    const seeded = spawnSync(require('electron'), [fixture, directory], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
    assert.equal(seeded.status, 0);
  }
  let page;
  if (process.env.UNVAR_SMOKE_CDP) {
    browser = await chromium.connectOverCDP(process.env.UNVAR_SMOKE_CDP);
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
    assert.ok(page, 'Development renderer exists');
  } else {
    application = await launch();
    page = await application.firstWindow();
    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const prefs = window.webContents.getLastWebPreferences();
      return { contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox, visible: window.isVisible() };
    });
    assert.deepEqual(preferences, { contextIsolation: true, nodeIntegration: false, sandbox: true, visible: true });
    if (process.platform === 'darwin') assert.deepEqual(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getWindowButtonPosition()), { x: 20, y: 28 });
  }
  const errors = [];
  if (mode === 'built') await page.getByRole('heading', { name: '今日', exact: true }).waitFor();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: /^(Settings|设置)$/ }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).hover();
  await page.getByRole('tooltip', { name: 'Collapse navigation', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Toggle navigation', exact: true }).evaluate(element => window.getComputedStyle(element).backgroundColor), 'rgb(230, 230, 230)');
  await page.keyboard.press('Escape');
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });
  await page.bringToFront();
  await page.getByRole('button', { name: 'Inbox', exact: true }).hover();
  await page.waitForFunction(() => window.getComputedStyle(window.document.querySelector('nav button[aria-label="Inbox"]')).backgroundColor === 'rgb(233, 233, 233)').catch(async error => {
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../test-results/hover-debug.png', import.meta.url)) });
    console.log(await page.getByRole('button', { name: 'Inbox', exact: true }).evaluate(element => ({ background: window.getComputedStyle(element).backgroundColor, hover: element.matches(':hover'), current: element.getAttribute('aria-current') })));
    throw error;
  });
  assert.equal(await page.getByRole('button', { name: 'Inbox', exact: true }).evaluate(element => window.getComputedStyle(element).borderColor), 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'Open Inbox', exact: true }).hover();
  await page.waitForFunction(() => Array.from(window.document.querySelectorAll('button')).some(element => element.textContent === 'Open Inbox' && window.getComputedStyle(element).backgroundColor === 'rgb(230, 230, 230)')).catch(async error => { await page.screenshot({ path: fileURLToPath(new URL('../test-results/button-hover-debug.png', import.meta.url)) }); console.log(await page.getByRole('button', { name: 'Open Inbox', exact: true }).evaluate(element => ({ background: window.getComputedStyle(element).backgroundColor, hover: element.matches(':hover'), text: element.textContent }))); throw error; });
  await page.reload();
  await page.getByRole('heading', { name: 'Today', exact: true }).waitFor();
  await page.getByText('Desktop connected', { exact: false }).waitFor();
  const result = await page.evaluate(async () => ({
    info: await window.unvar.getAppInfo(),
    bridgeKeys: Object.keys(window.unvar).sort(),
    require: typeof window.require, process: typeof window.process, ipcRenderer: typeof window.ipcRenderer,
  }));
  assert.deepEqual(result, {
    info: { name: 'Unvar', version: '0.0.0' },
    bridgeKeys: ['scoreWithJev','cancelJevScore','listJevEvaluations','getJevSettings', 'saveJevSettings', 'setJevCredential', 'deleteJevCredential', 'testJevConnection', 'getWorkspaceFolder', 'chooseWorkspaceFolder', 'revealWorkspaceFolder', 'getInterfacePreferences', 'saveInterfacePreferences', 'listFindings', 'generateFinding', 'listFindingRuns', 'cancelFindingRun', 'editFinding', 'reviewFinding', 'listArticles', 'createArticle', 'saveInterview', 'buildFactPack', 'confirmFactPack', 'generateWriting', 'listWritingRuns', 'cancelWritingRun', 'editArticle', 'readyArticle', 'exportArticle', 'getAppInfo', 'listSignals', 'saveSignal', 'setSignalStatus', 'exportSignal', 'listProviders', 'saveProvider', 'setCredential', 'deleteCredential', 'getResearchSettings', 'saveResearchSettings', 'analyzeSignal', 'cancelAnalysis', 'listRuns', 'getPiSettings', 'savePiSettings', 'startPiInterview', 'listPiRuns', 'cancelPiRun', 'savePiAnswers', 'listDecisions', 'saveDecisionOutcome', 'listClaims', 'listQuestions', 'editQuestion', 'overrideScore', 'setQuestionStatus', 'createExperiment', 'testProvider', 'listExperiments', 'saveExperiment', 'transitionExperiment', 'controlExperimentTimer', 'appendExperimentLog', 'listExperimentLogs', 'exportExperiment'].sort(),
    require: 'undefined', process: 'undefined', ipcRenderer: 'undefined',
  });
  assert.equal(await page.evaluate(() => window.open('https://example.com/') === null), true);
  const title = `Persistence check ${Date.now()}`;
  assert.equal(await page.locator('.sidebar [aria-current="page"]').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'New capture', exact: true }).evaluate(element => window.getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.getByRole('button', { name: 'New capture', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Content', { exact: true }).fill('A human observation preserved after restart.');
  await page.getByLabel('Tags', { exact: true }).fill('research, verification');
  await page.getByRole('button', { name: 'Save capture', exact: true }).click();
  const row = page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });
  await row.waitFor();
  await row.getByRole('button', { name: 'Archive', exact: true }).click();
  await row.waitFor({ state: 'hidden' });
  await page.getByLabel('Status', { exact: true }).selectOption('archived');
  await row.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('inbox');
  await row.waitFor();
  if (application) {
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page.getByRole('button', { name: 'Inbox', exact: true }).click();
    await page.getByRole('heading', { name: title }).waitFor();
    assert.equal(await page.getByText('A human observation preserved after restart.', { exact: true }).count(), 1);
  }
  if (application) {
    await page.getByRole('button', { name: 'Lab', exact: true }).click();
    const labId = await page.evaluate(async () => (await window.unvar.listExperiments()).find(item => item.title === 'Lab smoke experiment').id);
    await page.getByLabel('Experiment', { exact: true }).selectOption(labId);
    await page.getByRole('heading', { name: 'Lab smoke experiment', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Mark ready', exact: true }).isDisabled(), true);
    await page.getByLabel('Your prediction', { exact: true }).fill('I expect zero partial writes.');
    await page.getByLabel('Baseline', { exact: true }).fill('Two independent writes');
    await page.getByLabel('Metrics', { exact: true }).fill('Surviving rows');
    await page.getByRole('button', { name: 'Save experiment', exact: true }).click();
    await page.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await page.getByRole('button', { name: 'Start experiment', exact: true }).click();
    await page.getByRole('button', { name: 'Pause timer', exact: true }).waitFor();
    await page.getByLabel('Your observation', { exact: true }).fill('Observed rollback after injected failure.');
    await page.getByRole('button', { name: 'Add log', exact: true }).click();
    await page.getByText('Observed rollback after injected failure.', { exact: true }).waitFor();
    await application.close(); application = await launch(); page = await application.firstWindow();
    await page.getByRole('button', { name: 'Lab', exact: true }).click();
    await page.getByRole('button', { name: 'Pause timer', exact: true }).waitFor();
    await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../test-results/lab-restart-debug.png', import.meta.url)), fullPage: true });
    assert.equal(await page.getByLabel('Your prediction', { exact: true }).inputValue(), 'I expect zero partial writes.');
    assert.equal(await page.getByLabel('Your prediction', { exact: true }).getAttribute('readonly'), '');
    await page.getByText('Observed rollback after injected failure.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pause timer', exact: true }).click();
    await page.getByLabel('Result', { exact: true }).fill('No partial writes survived.');
    await page.getByLabel('Limitations', { exact: true }).fill('Single local test only.');
    await page.getByLabel('Trust', { exact: true }).selectOption('3');
    await page.getByRole('button', { name: 'Save experiment', exact: true }).click();
    await page.getByRole('button', { name: 'Analyze results', exact: true }).click();
    await page.getByRole('button', { name: 'Complete experiment', exact: true }).click();
    await page.getByRole('button', { name: 'Archive experiment', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Findings', exact: true }).click();
    const finding = page.getByRole('article', { name: 'Finding candidate', exact: true });
    await finding.getByRole('heading', { name: 'Fixture finding: rollback preserved rows.', exact: true }).waitFor();
    assert.equal(await finding.getByRole('button', { name: 'Confirm finding', exact: true }).isDisabled(), true);
    await finding.getByLabel('Finding text', { exact: true }).fill('Human-reviewed bounded finding.');
    await finding.getByLabel('Your review reason', { exact: true }).fill('Narrow the scope to the fixture observation.');
    assert.equal(await finding.getByRole('button', { name: 'Confirm finding', exact: true }).isDisabled(), true);
    await finding.getByRole('button', { name: 'Save finding edits', exact: true }).click();
    await finding.getByRole('heading', { name: 'Human-reviewed bounded finding.', exact: true }).waitFor();
    await finding.getByLabel('Your review reason', { exact: true }).fill('I checked the linked experiment result.');
    await finding.getByRole('button', { name: 'Confirm finding', exact: true }).click();
    await finding.waitFor({ state: 'hidden' });
    await application.close(); application = await launch(); page = await application.firstWindow();
    await page.getByRole('button', { name: 'Lab', exact: true }).click();
    await page.getByRole('button', { name: 'Findings', exact: true }).click();
    await page.getByLabel('Finding status', { exact: true }).selectOption('accepted');
    const accepted = page.getByRole('article', { name: 'Finding candidate', exact: true });
    await accepted.getByRole('heading', { name: 'Human-reviewed bounded finding.', exact: true }).waitFor();
    await accepted.getByText('Confirmed on', { exact: false }).waitFor();
    await accepted.getByLabel('Counter-evidence and limitations', { exact: true }).fill('Additional limitation from human review.');
    await accepted.getByLabel('Your review reason', { exact: true }).fill('This needs a new confirmation.');
    await accepted.getByRole('button', { name: 'Save finding edits', exact: true }).click();
    await accepted.waitFor({ state: 'hidden' });
    await page.getByLabel('Finding status', { exact: true }).selectOption('candidate');
    await accepted.getByLabel('Evidence relation: Finding evidence fixture', { exact: true }).selectOption('contradicts');
    await accepted.getByLabel('Your review reason', { exact: true }).fill('The evidence does not support this conclusion.');
    await accepted.getByRole('button', { name: 'Save finding edits', exact: true }).click();
    await accepted.getByLabel('Your review reason', { exact: true }).fill('Reject until more evidence is available.');
    await accepted.getByRole('button', { name: 'Reject finding', exact: true }).click();
    await accepted.waitFor({ state: 'hidden' });
    await page.getByLabel('Finding status', { exact: true }).selectOption('archived');
    await accepted.getByRole('heading', { name: 'Human-reviewed bounded finding.', exact: true }).waitFor();
    assert.equal(await accepted.getByLabel('Evidence relation: Finding evidence fixture', { exact: true }).inputValue(), 'contradicts');
    await page.screenshot({ path: fileURLToPath(new URL('../test-results/built-Findings.png', import.meta.url)), fullPage: true });

  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open settings' }).click();
  const jevPanel=page.locator('section').filter({has:page.getByRole('heading',{name:'Jev / OpenRouter',exact:true})});
  await jevPanel.getByLabel('Jev model',{exact:true}).fill('typesafe/jev-1.13');
  await jevPanel.getByRole('button',{name:'Save Jev settings',exact:true}).click();
  await jevPanel.getByText('Settings saved.',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.unvar.getJevSettings())).model,'typesafe/jev-1.13');
  if(process.env.UNVAR_TEST_KEYCHAIN==='1') {
    try {
      for(const fake of ['fake-jev-test-key','fake-jev-replacement']) {
        await jevPanel.getByLabel('OpenRouter API Key',{exact:true}).fill(fake);
        await jevPanel.getByRole('button',{name:'Save or replace Jev key',exact:true}).click();
        await jevPanel.getByText('Jev key saved.',{exact:true}).waitFor();
        assert.equal(await jevPanel.getByLabel('OpenRouter API Key',{exact:true}).inputValue(),'');
        const publicSettings=await page.evaluate(()=>window.unvar.getJevSettings());
        assert.equal(publicSettings.configured,true);assert.deepEqual(Object.keys(publicSettings).sort(),['configured','enabled','model']);
      }
      if(application) {
        await jevPanel.getByLabel('Enable Jev scoring',{exact:true}).check();
        await jevPanel.getByRole('button',{name:'Save Jev settings',exact:true}).click();
        await jevPanel.getByText('Settings saved.',{exact:true}).waitFor();
        await application.evaluate(()=>{
          const original=globalThis.fetch;globalThis.__unvarOriginalFetch=original;
          globalThis.fetch=async(input,init)=>{
            if(String(input)!=='https://openrouter.ai/api/v1/systemone')return original(input,init);
            if(globalThis.__unvarStallJev)return new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('Canceled')),{once:true});});
            return globalThis.Response.json({model:'typesafe/jev-desktop-mock',answers:Object.fromEntries(['workRelevance','experimentability','evidencePotential','uniqueness','seriesPotential'].map(key=>[key,{type:'choice',choice:'2',confidence:1,probabilities:{'0':0,'1':0,'2':1,'3':0}}])),usage:{input_tokens:5,output_tokens:5}});
          };
        });
        await page.getByRole('button',{name:'Radar',exact:true}).click();
        await page.getByLabel('Question status',{exact:true}).selectOption('all');
        const card=page.locator('article').first();
        await card.getByRole('button',{name:'Rescore with Jev',exact:true}).click();
        await card.getByText('Actual scoring engine: jev',{exact:true}).waitFor();
        await card.locator('summary').filter({hasText:'Scoring provenance'}).click();
        await card.getByText(/typesafe\/jev-desktop-mock/).first().waitFor();
        await application.evaluate(()=>{globalThis.__unvarStallJev=true;});
        await card.getByRole('button',{name:'Rescore with Jev',exact:true}).click();
        await card.getByRole('button',{name:'Cancel scoring',exact:true}).click();
        await card.getByText('Scoring canceled or failed. Retry explicitly.',{exact:true}).waitFor();
        await application.evaluate(()=>{globalThis.fetch=globalThis.__unvarOriginalFetch;delete globalThis.__unvarOriginalFetch;delete globalThis.__unvarStallJev;});
        await page.getByRole('button',{name:'Settings',exact:true}).click();
        await page.getByRole('menuitem',{name:'Open settings',exact:true}).click();
      }
    } finally {
      await jevPanel.getByRole('button',{name:'Delete Jev key',exact:true}).click();
      await jevPanel.getByText('Jev key deleted.',{exact:true}).waitFor();
    }
  }
  await page.getByLabel('Research focus', { exact: true }).fill('Reliable developer tools');
  await page.getByRole('button', { name: 'Save research context', exact: true }).click();
  await page.getByText('Settings saved.', { exact: true }).last().waitFor();
  await page.getByLabel('Display name', { exact: true }).fill('Test provider');
  await page.getByLabel('Model', { exact: true }).fill('test-model');
  await page.getByRole('button', { name: 'Save provider', exact: true }).click();
  await page.getByText('Not configured', { exact: true }).waitFor();
  if (process.env.UNVAR_TEST_KEYCHAIN === '1') {
    await page.getByLabel('New API key', { exact: true }).fill('fake-unvar-desktop-smoke-key');
    await page.getByRole('button', { name: 'Save key', exact: true }).click();
    try {
      await page.getByText('Configured', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('New API key', { exact: true }).inputValue(), '');
      assert.equal((await page.evaluate(() => window.unvar.listProviders())).some((provider) => 'secret' in provider || 'credentialKeyRef' in provider), false);
    } finally {
      await page.getByRole('button', { name: 'Delete key', exact: true }).click();
      await page.getByText('Not configured', { exact: true }).waitFor();
    }
  }
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByLabel('Search', { exact: true }).fill(title);
  await page.getByRole('heading', { name: title }).waitFor();
  await page.locator('.recent-captures button').filter({ hasText: title }).click();
  assert.equal(await page.locator('.sidebar [aria-current="page"]').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-current'), null);
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  assert.equal(await page.locator('.sidebar [aria-current="page"]').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page');
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  assert.deepEqual(errors, []);
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(`../test-results/${mode}.png`, import.meta.url)), fullPage: true });
  for (const view of ['Today', 'Inbox', 'Radar', 'Lab', 'Settings']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    if (view === 'Settings') await page.getByRole('menuitem', { name: 'Open settings' }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`../test-results/${mode}-${view}.png`, import.meta.url)), fullPage: true });
  }
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByLabel('Quick capture', { exact: true }).fill('Bilingual capture stays unchanged / 双语记录');
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  await page.getByText('Capture saved.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Toggle navigation', exact: true }).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '简体中文' }).click();
  await page.getByRole('heading', { name: '今日', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.document.documentElement.lang), 'zh-CN');
  await page.screenshot({ path: fileURLToPath(new URL(`../test-results/${mode}-zh.png`, import.meta.url)), fullPage: true });
  await page.getByRole('button', { name: '切换导航栏', exact: true }).hover();
  await page.getByRole('tooltip', { name: '收起侧边栏', exact: true }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL(`../test-results/${mode}-hover-zh.png`, import.meta.url)), fullPage: true });
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('heading', { name: '今日', exact: true }).waitFor();
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  await page.getByRole('heading', { name: 'Bilingual capture stays unchanged / 双语记录', exact: true }).waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Toggle overview', exact: true }).first().click();
  assert.equal(await page.locator('#workspace-overview').count(), 0);
  await page.getByRole('button', { name: 'Toggle overview', exact: true }).click();
  await page.locator('#workspace-overview').waitFor();
  await page.getByRole('button', { name: 'Toggle overview', exact: true }).first().click();
  await page.setViewportSize({ width: 1280, height: 688 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const languageBounds = await page.getByRole('menu').boundingBox();
  assert.ok(languageBounds && languageBounds.y + languageBounds.height <= 688, 'Settings menu stays visible in short windows');
  await page.keyboard.press('Escape');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.getByLabel('Search', { exact: true }).waitFor();
  await page.waitForFunction(() => window.document.activeElement?.id === 'library-search');
  await page.setViewportSize({ width: 700, height: 480 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForFunction(() => { const bounds = window.document.querySelector('[role="menu"]')?.getBoundingClientRect(); return bounds && bounds.top >= 0 && bounds.bottom <= window.innerHeight; });
  const shortLanguageBounds = await page.getByRole('menu').boundingBox();
  assert.ok(shortLanguageBounds && shortLanguageBounds.y + shortLanguageBounds.height <= 480, 'Settings menu stays visible at minimum window height');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 540, height: 800 });
  assert.equal(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth), true, 'Narrow layout has no horizontal overflow');
  await page.screenshot({ path: fileURLToPath(new URL(`../test-results/${mode}-narrow.png`, import.meta.url)), fullPage: true });
  console.log(`${mode} smoke passed: capture, archive/restore, search, settings, bilingual preferences, layout toggles, narrow layout, bridge isolation${application ? ', full restart persistence' : ''}${process.env.UNVAR_TEST_KEYCHAIN === '1' ? ', OS credential UI save/delete' : ''}.`);
} finally {
  if (application) await application.close();
  if (browser) await browser.close();
  await rm(directory, { recursive: true, force: true });
  await rm(appSnapshot, { recursive: true, force: true });
}
