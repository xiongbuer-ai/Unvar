import { ipcMain } from 'electron';
import { z } from 'zod';
import { findingChannels, generateFindingSchema, editFindingSchema, reviewFindingSchema, idSchema } from '@unvar/shared';
import { HttpLLMProvider } from '@unvar/llm';
import { FindingWorkflow } from '@unvar/workflows';
import type { WorkspaceService } from './workspace-service';
import type { TrustedRenderer } from './app-info';
import { validatedHandler } from './validated-ipc';
import prompt from '../../../../prompts/finding.md?raw';

export function registerFindingIPC(service: WorkspaceService, trusted: () => TrustedRenderer | null) {
  service.store.findings.recover();
  const workflow = new FindingWorkflow(service.store, prompt);
  const register = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => unknown) => ipcMain.handle(channel, validatedHandler(schema, trusted, operation));
  register(findingChannels.listFindings, z.tuple([]), () => service.store.findings.list());
  register(findingChannels.listFindingRuns, z.tuple([]), () => service.store.findings.runs());
  register(findingChannels.generateFinding, z.tuple([generateFindingSchema]), ([input]) => {
    const config = service.store.getProvider(input.providerId);
    if (!config.enabled) throw new Error('Provider is disabled.');
    return workflow.start(input, new HttpLLMProvider(config, () => service.credentials.get(config.credentialKeyRef)));
  });
  register(findingChannels.cancelFindingRun, z.tuple([idSchema]), ([id]) => workflow.cancel(id));
  register(findingChannels.editFinding, z.tuple([editFindingSchema]), ([input]) => service.store.findings.edit(input));
  register(findingChannels.reviewFinding, z.tuple([reviewFindingSchema]), ([input]) => service.store.findings.review(input));
  return workflow;
}
