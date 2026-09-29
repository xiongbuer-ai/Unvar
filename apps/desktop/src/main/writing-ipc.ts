import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { writingChannels, createArticleSchema, saveInterviewSchema, articleVersionSchema, confirmFactPackSchema, generateWritingSchema, editArticleSchema, readyArticleSchema, idSchema } from '@unvar/shared';
import { HttpLLMProvider } from '@unvar/llm';
import { WritingWorkflow } from '@unvar/workflows';
import type { WorkspaceService } from './workspace-service';
import type { TrustedRenderer } from './app-info';
import { validatedHandler } from './validated-ipc';
import prompt from '../../../../prompts/writing.md?raw';

export function registerWritingIPC(service: WorkspaceService, trusted: () => TrustedRenderer | null, getWindow: () => BrowserWindow | null, exportDirectory: string) {
  const repository = service.store.writing;
  repository.recover();
  const workflow = new WritingWorkflow(service.store, prompt);
  const register = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => unknown) => ipcMain.handle(channel, validatedHandler(schema, trusted, operation));
  register(writingChannels.listArticles, z.tuple([]), () => repository.list());
  register(writingChannels.createArticle, z.tuple([createArticleSchema]), ([input]) => repository.create(input));
  register(writingChannels.saveInterview, z.tuple([saveInterviewSchema]), ([input]) => repository.saveInterview(input));
  register(writingChannels.buildFactPack, z.tuple([articleVersionSchema]), ([input]) => repository.buildPack(input));
  register(writingChannels.confirmFactPack, z.tuple([confirmFactPackSchema]), ([input]) => repository.confirm(input));
  register(writingChannels.listWritingRuns, z.tuple([]), () => repository.runs());
  register(writingChannels.generateWriting, z.tuple([generateWritingSchema]), ([input]) => {
    const config = service.store.getProvider(input.providerId);
    if (!config.enabled) throw new Error('Provider is disabled.');
    return workflow.start(input, new HttpLLMProvider(config, () => service.credentials.get(config.credentialKeyRef)));
  });
  register(writingChannels.cancelWritingRun, z.tuple([idSchema]), ([id]) => workflow.cancel(id));
  register(writingChannels.editArticle, z.tuple([editArticleSchema]), ([input]) => repository.edit(input));
  register(writingChannels.readyArticle, z.tuple([readyArticleSchema]), ([input]) => repository.ready(input));
  register(writingChannels.exportArticle, z.tuple([idSchema]), async ([id]) => {
    const window = getWindow(); if (!window) throw new Error('Window unavailable.');
    const output = repository.markdown(id);
    const result = await dialog.showSaveDialog(window, { defaultPath: join(exportDirectory, `${id}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    if (repository.markdown(id) !== output) throw new Error('Article changed while choosing the export location. Retry export.');
    await writeFile(result.filePath, output, 'utf8'); return { canceled: false };
  });
  return workflow;
}
