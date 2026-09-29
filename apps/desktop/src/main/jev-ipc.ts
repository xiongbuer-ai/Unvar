import { JevScoringService } from '@unvar/workflows';
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jevChannels, jevSettingsSchema, jevSecretSchema, idSchema, type JevSettings } from '@unvar/shared';
import { JevOpenRouterDecisionEngine } from '@unvar/decision';
import type { WorkspaceService } from './workspace-service';
import type { TrustedRenderer } from './app-info';
import { validatedHandler, SafeOperationError } from './validated-ipc';

export function registerJevIPC(service:WorkspaceService,trusted:()=>TrustedRenderer|null) {
  const db = service.store.db;
  function record(): JevSettings & {credentialRef:string} {
    const row = db.prepare("SELECT value_json FROM app_settings WHERE key='jev'").get() as {value_json:string}|undefined;
    if (row) { const value = JSON.parse(row.value_json); return {...jevSettingsSchema.parse({enabled:value.enabled,model:value.model}),credentialRef:z.string().min(1).parse(value.credentialRef)}; }
    const value = {enabled:false,model:'typesafe/jev-1.13',credentialRef:`jev:${randomUUID()}`};
    save(value); return value;
  }
  function save(value:JevSettings & {credentialRef:string}) { db.prepare("INSERT INTO app_settings VALUES ('jev',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(JSON.stringify(value),new Date().toISOString()); }
  const scoring=new JevScoringService(service.store,record,()=>service.credentials.get(record().credentialRef));
  const register=<T>(channel:string,schema:z.ZodType<T>,operation:(input:T)=>unknown)=>ipcMain.handle(channel,validatedHandler(schema,trusted,async(input)=>{
    try{return await operation(input);}catch(error){
      const allowed=['Jev key is not configured.','Jev authentication failed.','OpenRouter balance is insufficient.','Jev rate limit reached.','Jev request failed or returned invalid scores.','Unable to save Jev credential.','Unable to delete Jev credential.','Jev connection test is already running.'];
      if(error instanceof Error && allowed.includes(error.message)) {
        throw new SafeOperationError(error.message);
      }
      throw error;
    }
  }));
  register(jevChannels.scoreWithJev,z.tuple([idSchema]),([id])=>scoring.scoreExisting(id,'radar'));
  register(jevChannels.cancelJevScore,z.tuple([idSchema]),([id])=>scoring.cancel(id));
  register(jevChannels.listJevEvaluations,z.tuple([idSchema]),([id])=>service.store.jev.list(id));
  register(jevChannels.getJevSettings,z.tuple([]),async()=>{ const {credentialRef,...settings}=record();return {...settings,configured:(await service.credentials.get(credentialRef))!==null}; });
  register(jevChannels.saveJevSettings,z.tuple([jevSettingsSchema]),([input])=>{save({...record(),...input});if(!input.enabled)scoring.stop();});
  register(jevChannels.setJevCredential,z.tuple([jevSecretSchema]),async([secret])=>{try{scoring.stop();await service.credentials.set(record().credentialRef,secret);}catch{throw new Error('Unable to save Jev credential.');}});
  register(jevChannels.deleteJevCredential,z.tuple([]),async()=>{try{const settings=record();scoring.stop();await service.credentials.delete(settings.credentialRef);save({...settings,enabled:false});}catch{throw new Error('Unable to delete Jev credential.');}});
  let testing=false;
  register(jevChannels.testJevConnection,z.tuple([]),async()=>{
    if(testing)throw new Error('Jev connection test is already running.');
    testing=true;
    try {
      const settings=record();const key=await service.credentials.get(settings.credentialRef);
      if(!key)throw new Error('Jev key is not configured.');
      const engine=new JevOpenRouterDecisionEngine(key,settings.model);
      await engine.scoreQuestion({question:'Does adding an index reduce query latency?',claim:'An index can reduce lookup time.',proposedExperiment:'Compare median latency on the same synthetic SQLite dataset with and without an index.',researchFocus:'Local database performance'});
      return {model:engine.lastResult!.model,durationMs:engine.lastResult!.durationMs};
    } finally {testing=false;}
  });
  return scoring;
}
