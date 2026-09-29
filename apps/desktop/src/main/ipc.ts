import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { channels, signalInputSchema, signalQuerySchema, statusInputSchema, providerInputSchema,
  credentialInputSchema, researchSettingsSchema, idSchema } from '@unvar/shared';
import type { WorkspaceService } from './workspace-service';
import type { TrustedRenderer } from './app-info';
import { validatedHandler } from './validated-ipc';
import { signalMarkdown } from './markdown';

export function registerWorkspaceIPC(service: WorkspaceService, trusted: () => TrustedRenderer | null, getWindow: () => BrowserWindow | null, exportDirectory: string) {
  const register = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => unknown) => {
    ipcMain.handle(channel, validatedHandler(schema, trusted, operation));
  };
  register(channels.listSignals, z.tuple([signalQuerySchema]), ([input]) => service.store.listSignals(input));
  register(channels.saveSignal, z.tuple([signalInputSchema]), ([input]) => service.store.saveSignal(input));
  register(channels.setSignalStatus, z.tuple([statusInputSchema]), ([input]) => service.store.setSignalStatus(input.id, input.status));
  register(channels.listProviders, z.tuple([]), () => service.listProviders());
  register(channels.saveProvider, z.tuple([providerInputSchema]), ([input]) => service.saveProvider(input));
  register(channels.setCredential, z.tuple([credentialInputSchema]), ([input]) => service.setCredential(input.providerId, input.secret));
  register(channels.deleteCredential, z.tuple([idSchema]), ([id]) => service.deleteCredential(id));
  register(channels.getResearchSettings, z.tuple([]), () => service.store.getResearchSettings());
  register(channels.saveResearchSettings, z.tuple([researchSettingsSchema]), ([input]) => service.store.saveResearchSettings(input));
  register(channels.exportSignal, z.tuple([idSchema]), async ([id]) => {
    const window = getWindow();
    if (!window) throw new Error('Window unavailable.');
    const signal = service.store.getSignal(id);
    const result = await dialog.showSaveDialog(window, { defaultPath: join(exportDirectory, `${signal.id}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, signalMarkdown(signal), 'utf8');
    return { canceled: false };
  });
}
