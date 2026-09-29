import { ipcMain } from 'electron';
import { z } from 'zod';
import { piChannels,piSettingsSchema,piStartSchema,piAnswersSchema,idSchema } from '@unvar/shared';
import { PiWorkflowAdapter } from '@unvar/workflows';
import type { WorkspaceService } from './workspace-service';
import type { TrustedRenderer } from './app-info';
import { validatedHandler } from './validated-ipc';
import prompt from '../../../../prompts/pi-interview.md?raw';
export function registerPiIPC(service:WorkspaceService,trusted:()=>TrustedRenderer|null,scoring?:import('@unvar/workflows').JevScoringService) {
  service.store.pi.recover();const workflow=new PiWorkflowAdapter(service.store,prompt,undefined,scoring);
  const register=<T>(channel:string,schema:z.ZodType<T>,operation:(input:T)=>unknown)=>ipcMain.handle(channel,validatedHandler(schema,trusted,operation));
  register(piChannels.getPiSettings,z.tuple([]),()=>service.store.pi.settings());
  register(piChannels.savePiSettings,z.tuple([piSettingsSchema]),([input])=>{service.store.pi.configure(input);if(!input.enabled)workflow.stop();});
  register(piChannels.listPiRuns,z.tuple([idSchema]),([id])=>service.store.pi.list(id));
  register(piChannels.startPiInterview,z.tuple([piStartSchema]),([input])=>{const config=service.store.getProvider(input.providerId);if(!config.enabled)throw new Error('Provider is disabled.');return workflow.start(input,config,()=>service.credentials.get(config.credentialKeyRef));});
  register(piChannels.cancelPiRun,z.tuple([idSchema]),([id])=>workflow.cancel(id));
  register(piChannels.savePiAnswers,z.tuple([piAnswersSchema]),([input])=>service.store.pi.applyAnswers(input));
  return workflow;
}
