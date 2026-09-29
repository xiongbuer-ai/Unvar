/* global window */
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { _electron as electron } from 'playwright-core';
const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'unvar-writing-smoke-'));
const snapshot = join(root, 'app'); const profile = join(root, 'profile');
const piMode=process.env.UNVAR_SMOKE_PI==='1';
let piStall=piMode; let piRequests=0;
let application; let providerId; let page; let requests = 0;
const server = createServer(async (req,res) => {
  try {
    assert.equal(req.url, '/v1/chat/completions');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if(input.tools) {
      piRequests++; if(piStall)return;
      const content=input.messages.find(message=>message.role==='user').content;
      const article=JSON.parse(typeof content==='string'?content:content.map(part=>part.text??'').join(''));
      const hasResults=input.messages.some(message=>message.role==='tool');
      res.writeHead(200,{'content-type':'text/event-stream'});
      const chunk=(delta,finish_reason=null)=>res.write('data: '+JSON.stringify({id:'pi-smoke',object:'chat.completion.chunk',created:0,model:'mock:desktop-pi',choices:[{index:0,delta,finish_reason}]})+'\n\n');
      if(!hasResults) { chunk({role:'assistant',tool_calls:[{index:0,id:'read',type:'function',function:{name:'get_experiment',arguments:JSON.stringify({id:article.source.id})}},{index:1,id:'search',type:'function',function:{name:'search_library',arguments:JSON.stringify({query:'fixture'})}}]});chunk({},'tool_calls'); }
      else { chunk({role:'assistant',content:JSON.stringify({summary:'Synthetic evidence leaves a coverage gap.',evidenceIds:[article.source.id],questions:[{field:'unknowns',text:'Which failure mode remains untested?'}]})});chunk({},'stop'); }
      res.end('data: [DONE]\n\n');return;
    }
    const context = JSON.parse(input.messages.at(-1).content); requests++;
    const result = context.stage === 'review' ? { summary: 'Synthetic review: the scope is limited.', issues: [] } : { markdown: context.stage === 'outline' ? '## Test observation\n## Limitations' : 'The synthetic fixture retained no partial rows. This is not general research evidence.', evidenceIds: context.factPack.evidence.map(item => item.id) };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], model: 'mock:desktop-writing', usage: { total_tokens: 1 } }));
  } catch { res.writeHead(500); res.end('Mock failed'); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, UNVAR_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
const launch = () => electron.launch({ executablePath: require('electron'), args: [snapshot, `--user-data-dir=${profile}`], env });
const waitStage = async stage => page.waitForFunction(async stage => (await window.unvar.listArticles()).some(item => item.status === stage),stage);
try {
  await mkdir(profile); await mkdir(snapshot);
  await cp(join(desktop,'out'),join(snapshot,'out'),{ recursive:true }); await cp(join(desktop,'package.json'),join(snapshot,'package.json')); await symlink(join(desktop,'node_modules'),join(snapshot,'node_modules'));
  const fixture = join(root,'seed.cjs');
  await build({ entryPoints: [fileURLToPath(new URL('./seed-desktop.ts',import.meta.url))],outfile:fixture,bundle:true,platform:'node',format:'cjs',plugins:[{ name:'native',setup(builder) { builder.onResolve({filter:/^better-sqlite3$/},args => ({path:require.resolve(args.path),external:true})); } }] });
  assert.equal(spawnSync(require('electron'),[fixture,profile],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit'}).status,0);
  application = await launch(); page = await application.firstWindow();
  await page.getByRole('heading',{name:'今日',exact:true}).waitFor();
  providerId = await page.evaluate(async endpoint => {
    await window.unvar.saveInterfacePreferences({locale:'en'});
    const provider = await window.unvar.saveProvider({providerType:'openai-compatible',displayName:'Desktop writing mock',baseUrl:endpoint,model:'mock:desktop-writing',enabled:true});
    await window.unvar.setCredential({providerId:provider.id,secret:'fake-local-writing-smoke-key'}); return provider.id;
  },endpoint); await page.reload();
  await page.bringToFront();
  await page.getByRole('button',{name:'Writing',exact:true}).click();
  await page.getByLabel('Article title',{exact:true}).fill('Desktop synthetic article');
  const evidence = await page.evaluate(async () => (await window.unvar.listExperiments()).find(item => item.status === 'done').id);
  await page.getByLabel('Article source',{exact:true}).selectOption(evidence);
  await page.getByRole('button',{name:'Create article',exact:true}).click();
  await page.getByRole('heading',{name:'Author interview',exact:true}).waitFor();
  const editor = page.locator('.writing-editor');
  assert.equal((await page.evaluate(()=>window.unvar.getPiSettings())).enabled,false);
  if(piMode) {
    await page.getByLabel('Enable Pi interview',{exact:true}).check();
    await page.getByRole('button',{name:'Find evidence and ask questions',exact:true}).click();
    await page.getByRole('button',{name:'Cancel Pi interview',exact:true}).click();
    await page.waitForFunction(async()=>{const article=(await window.unvar.listArticles())[0];return (await window.unvar.listPiRuns(article.id))[0]?.status==='canceled';});
    piStall=false;
    await page.getByRole('button',{name:'Find evidence and ask questions',exact:true}).click();
    await page.getByLabel('Which failure mode remains untested?',{exact:true}).waitFor();
    await page.getByLabel('Which failure mode remains untested?',{exact:true}).fill('Synthetic user answer: power loss was not tested.');
    await page.getByRole('button',{name:'Save my answers and build Fact Pack',exact:true}).click();
    await page.waitForFunction(async()=>{const article=(await window.unvar.listArticles())[0];return article.factPack?.version===1&&!article.confirmationValid;});
    assert.ok((await page.evaluate(()=>window.unvar.listArticles()))[0].interview.unknowns.includes('power loss'));
    await page.getByRole('button',{name:'Use fixed interview',exact:true}).click();
    await page.getByText('Pi is off. The author interview below remains available.',{exact:true}).waitFor();
  }

  assert.ok(await editor.getByRole('button',{name:'Generate outline',exact:true}).isDisabled());
  await editor.getByLabel('Your observations',{exact:true}).fill('Synthetic author observation.');
  await editor.getByLabel('Your experience',{exact:true}).fill('Test-driver experience, not real personal research.');
  await editor.getByRole('button',{name:'Save interview',exact:true}).click();
  await page.waitForFunction(async () => (await window.unvar.listArticles())[0].interview.observations === 'Synthetic author observation.');
  await editor.getByRole('button',{name:'Build Fact Pack',exact:true}).click();
  await page.getByText('Fact Pack needs confirmation',{exact:false}).waitFor();
  assert.ok(await editor.getByRole('button',{name:'Generate draft',exact:true}).isDisabled());
  await editor.getByRole('button',{name:'Confirm Fact Pack',exact:true}).click();
  await page.getByText('Fact Pack confirmed',{exact:false}).waitFor();
  await editor.getByRole('button',{name:'Generate outline',exact:true}).click();
  await page.waitForFunction(async () => Boolean((await window.unvar.listArticles())[0].outlineMd));
  await editor.getByRole('button',{name:'Generate draft',exact:true}).click(); await waitStage('draft');
  await editor.getByLabel('Article body',{exact:true}).fill('Human edited synthetic draft. Only this fixture was tested.');
  await editor.getByLabel('Your editorial reason',{exact:true}).fill('Keep the scope explicit.');
  await editor.getByRole('button',{name:'Save draft edits',exact:true}).click(); await waitStage('edit');
  await editor.getByRole('button',{name:'Review draft',exact:true}).click(); await waitStage('review');
  assert.ok(await editor.getByRole('button',{name:'Mark Ready',exact:true}).isDisabled());
  await editor.getByLabel('Your editorial reason',{exact:true}).fill('Synthetic test-driver review completed.');
  await editor.getByRole('button',{name:'Mark Ready',exact:true}).click(); await waitStage('ready');
  const output = join(root,'export.md');
  await application.evaluate(({dialog},path) => { dialog.showSaveDialog = async () => ({canceled:false,filePath:path}); },output);
  await editor.getByRole('button',{name:'Export article Markdown',exact:true}).click();
  for (let i=0;i<30;i++) { try { assert.match(await readFile(output,'utf8'),/Human edited synthetic draft/); break; } catch { if(i===29) throw new Error('Export was not written'); await new Promise(resolve=>setTimeout(resolve,100)); } }
  assert.ok((await readFile(output,'utf8')).includes('Fact Pack version: '+(piMode?2:1))); assert.equal(requests,3);
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Decision Log',exact:true}).click();
  await page.getByLabel('Search decisions',{exact:true}).fill('Desktop synthetic article');
  await page.getByLabel('Entity type',{exact:true}).selectOption('article');
  let decision = page.locator('.decision-card').filter({hasText:'Synthetic test-driver review completed.'});
  await decision.getByRole('heading',{name:'Human decision',exact:true}).waitFor();
  await decision.getByLabel('Observed outcome',{exact:true}).fill('Synthetic follow-up: export retained the evidence.');
  await decision.getByRole('button',{name:'Save outcome',exact:true}).click();
  await page.waitForFunction(async()=> (await window.unvar.listDecisions({search:'Synthetic follow-up: export retained the evidence.'})).total === 1);
  await decision.getByRole('button',{name:'Entity history',exact:true}).click();
  await page.getByRole('button',{name:'Show all decisions',exact:true}).waitFor();
  await decision.getByLabel('Observed outcome',{exact:true}).fill('Synthetic follow-up revised after checking limits.');
  await decision.getByRole('button',{name:'Save outcome',exact:true}).click();
  await page.waitForFunction(async()=> (await window.unvar.listDecisions({search:'Synthetic follow-up revised'})).items[0]?.outcomeHistory.length === 2);
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await decision.locator('summary').filter({hasText:'Outcome history · 2'}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL('../test-results/decision-smoke-en.png',import.meta.url))});
  await application.close(); application = await launch(); page = await application.firstWindow();
  await page.bringToFront();
  await page.getByRole('button',{name:'Writing',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.unvar.listDecisions({search:'Synthetic follow-up revised'}))).items[0].outcomeHistory.length,2);
  await page.getByRole('button',{name:'Export article Markdown',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Export article Markdown',exact:true}).isDisabled(),false);
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await page.getByRole('heading',{name:'Author interview',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL('../test-results/writing-smoke-en.png',import.meta.url))});
  await page.getByLabel('Your opinions',{exact:true}).fill('A new opinion invalidates confirmation.');
  await page.getByRole('button',{name:'Save interview',exact:true}).click(); await waitStage('interview');
  assert.ok(await page.getByRole('button',{name:'Export article Markdown',exact:true}).isDisabled());
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByLabel('Search',{exact:true}).fill('Desktop synthetic article');
  await page.getByRole('button',{name:'Continue this article',exact:true}).click();
  assert.equal(await page.getByLabel('Your opinions',{exact:true}).inputValue(),'A new opinion invalidates confirmation.');
  await page.evaluate(async () => { await window.unvar.saveInterfacePreferences({locale:'zh-CN'}); }); await page.reload();
  await page.getByRole('button',{name:'写作',exact:true}).click();
  await page.getByRole('heading',{name:'作者采访',exact:true}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL('../test-results/writing-smoke-zh.png',import.meta.url))});
  await page.getByRole('button',{name:'资料库',exact:true}).click();
  await page.getByRole('button',{name:'决策记录',exact:true}).click();
  await page.getByLabel('实体类型',{exact:true}).selectOption('article');
  await page.screenshot({path:fileURLToPath(new URL('../test-results/decision-smoke-zh.png',import.meta.url))});
  if(piMode)console.log('Pi desktop smoke passed: enable, cancel without fallback, real Agent Core/mock SSE tools, human answers, unconfirmed Fact Pack, disable and fixed-flow Golden Path. Requests: '+piRequests);
  console.log('Writing and Decision Log desktop smoke passed: history, outcome versions/restart, bilingual UI; interview, Fact Pack confirmation, mock HTTP outline/draft/review, manual edit/Ready/export, restart, confirmation invalidation, Library navigation and bilingual UI.');
} catch (error) { if (page) { await mkdir(new URL('../test-results/',import.meta.url),{recursive:true}); await page.screenshot({path:fileURLToPath(new URL('../test-results/writing-smoke-failure.png',import.meta.url))}).catch(()=>{}); } throw error; }
finally { if (providerId && page) await page.evaluate(id=>window.unvar.deleteCredential(id),providerId).catch(()=>{}); if(application) await application.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await rm(root,{recursive:true,force:true}); }
