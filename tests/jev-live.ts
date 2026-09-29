// Explicit paid acceptance: read only the Jev configuration, never print credentials.
import { app } from 'electron';
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemCredentialStore } from '../apps/desktop/src/main/credentials';
import { JevScoringService } from '../packages/workflows/src/jev';
import { openStore } from '../packages/db/src/index';
import assert from 'node:assert/strict';
async function run() {
  if(process.env.UNVAR_LIVE_ACCEPTANCE!=='1')throw new Error('Opt-in required');
  await app.whenReady();
  const root=join(homedir(),'Library/Application Support/Unvar');
  const location=JSON.parse(readFileSync(join(root,'workspace-location.json'),'utf8')) as {path:string};
  const db=new Database(join(location.path,'unvar.db'),{readonly:true});
  const row=db.prepare("SELECT value_json FROM app_settings WHERE key='jev'").get() as {value_json:string}|undefined;db.close();
  if(!row)throw new Error('Jev configuration is missing');
  const config=JSON.parse(row.value_json) as {model:string;credentialRef:string};
  const key=await new SystemCredentialStore().get(config.credentialRef);if(!key)throw new Error('Jev credential is missing');
  const directory=mkdtempSync(join(tmpdir(),'unvar-jev-live-'));let store=await openStore(join(directory,'unvar.db'),join(directory,'backups'));
  try {
    store.saveResearchSettings({researchFocus:'Local database performance and reliable developer tools'});
    const source=store.saveSignal({kind:'note',title:'Synthetic Jev workflow acceptance',text:'Indexes may reduce lookup latency.',url:'',tags:[]});
    store.radar.saveAnalysis(source.id,{claims:[{text:source.text,type:'claim',evidenceText:source.text}],questions:[{claimIndex:0,text:'Does an index reduce median lookup latency?',whyRelevant:'Synthetic fixture',proposedExperiment:'Compare 1000 identical queries before and after adding an index on a synthetic SQLite dataset, reporting median milliseconds.',estimatedMinutes:20}]},[{workRelevance:0,experimentability:0,evidencePotential:0,uniqueness:0,seriesPotential:0}],'fixture');
    const question=store.radar.listQuestions()[0];const scoring=new JevScoringService(store,()=>({enabled:true,model:config.model}),async()=>key);
    const result=await scoring.scoreExisting(question.id,'radar');assert.equal(result.engine,'jev',result.error??'');
    assert.equal(store.radar.getQuestion(question.id).engine,'jev');assert.ok(store.jev.list(question.id)[0].rawAnswers);
    const human={...result.scores,workRelevance:0};store.radar.overrideScore(question.id,human,'Synthetic reviewer decision for acceptance only');
    store.close();store=await openStore(join(directory,'unvar.db'),join(directory,'backups'));
    assert.equal(store.jev.list(question.id)[0].model,result.model);assert.deepEqual(store.radar.getQuestion(question.id).scores,human);
    mkdirSync('spec/execution',{recursive:true});
    writeFileSync('spec/execution/m8-live-workflow-acceptance.md',`# M8 live workflow acceptance

Date: ${new Date().toISOString()}

Actual engine: Jev via OpenRouter System One. Model: ${result.model}. Duration: ${result.durationMs} ms.

Validated scores: ${JSON.stringify(result.scores)}

Usage: ${JSON.stringify(result.usage)}

Passed shared scoring service, atomic Question/evaluation/Decision persistence, raw-answer/model provenance, explicit synthetic reviewer override and restart. Original workspace read-only. Synthetic isolated research fixture removed; no real user research changed. Key from OS credential store, never logged.
`);
    console.log(JSON.stringify({passed:true,model:result.model,scores:result.scores,durationMs:result.durationMs,persistence:true,humanOverride:true,restart:true}));
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}

}
void run().then(()=>app.quit()).catch(()=>{console.error('Jev live acceptance failed; check configured credential, model or network. No secrets logged.');app.exit(1);});
