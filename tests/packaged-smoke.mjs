import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { _electron as electron } from 'playwright-core';
const executable=resolve(process.argv[2]??'dist/installers/mac-arm64/Unvar.app/Contents/MacOS/Unvar');
const directory=await mkdtemp(join(tmpdir(),'unvar-packaged-profile-'));
let app;
const launch=()=>electron.launch({executablePath:executable,args:[`--unvar-profile=${directory}`],env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
try {
  app=await launch();let page=await app.firstWindow();
  const state=await app.evaluate(({app,BrowserWindow})=>({packaged:app.isPackaged,userData:app.getPath('userData'),prefs:BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()}));
  assert.equal(state.packaged,true);assert.equal(state.userData,directory);assert.equal(state.prefs.sandbox,true);assert.equal(state.prefs.contextIsolation,true);assert.equal(state.prefs.nodeIntegration,false);
  await page.getByRole('heading',{name:'今日',exact:true}).waitFor();
  const first=await page.evaluate(async()=>{
    const info=await window.unvar.getAppInfo();
    const signal=await window.unvar.saveSignal({kind:'note',title:'Packaged persistence fixture',text:'Synthetic installer verification.',url:'',tags:['package-test']});
    await window.unvar.saveJevSettings({enabled:true,model:'typesafe/jev-1.13'});
    try {await window.unvar.setJevCredential('fake-packaged-credential');const configured=await window.unvar.getJevSettings();if(!configured.configured)throw new Error('Credential save failed');await window.unvar.setJevCredential('fake-packaged-replacement');}
    finally {await window.unvar.deleteJevCredential();}
    return {info,id:signal.id,bridgeSafe:typeof window.require==='undefined'&&typeof window.process==='undefined'};
  });
  assert.equal(first.bridgeSafe,true);assert.equal(first.info.name,'Unvar');
  await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('heading',{name:'今日',exact:true}).waitFor();
  const result=await page.evaluate(async()=>({signals:await window.unvar.listSignals({status:'all'}),jev:await window.unvar.getJevSettings()}));
  assert.ok(result.signals.some(item=>item.id===first.id&&item.tags.includes('package-test')));assert.equal(result.jev.configured,false);assert.equal(result.jev.enabled,false);
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/packaged-arm64.png'});
  console.log('Packaged smoke passed: actual packaged executable, isolated profile, secure bridge, native SQLite restart persistence, OS credential save/replace/delete and Jev settings.');
} finally {if(app)await app.close();await rm(directory,{recursive:true,force:true});}
