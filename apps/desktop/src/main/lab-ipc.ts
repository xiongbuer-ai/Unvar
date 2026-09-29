import { ipcMain, dialog, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { idSchema, labChannels, experimentInputSchema, transitionExperimentSchema, timerInputSchema, experimentLogInputSchema } from '@unvar/shared';
import type { Store } from '@unvar/db';
import type { TrustedRenderer } from './app-info';
import { validatedHandler } from './validated-ipc';
import { experimentMarkdown } from './markdown';

export function registerLabIPC(store: Store, trusted: () => TrustedRenderer | null, getWindow: () => BrowserWindow | null, exportDirectory: string) {
  const register = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => unknown) => ipcMain.handle(channel, validatedHandler(schema, trusted, operation));
  register(labChannels.listExperiments, z.tuple([]), () => store.lab.list());
  register(labChannels.saveExperiment, z.tuple([experimentInputSchema]), ([input]) => store.lab.save(input));
  register(labChannels.transitionExperiment, z.tuple([transitionExperimentSchema]), ([input]) => store.lab.transition(input));
  register(labChannels.controlExperimentTimer, z.tuple([timerInputSchema]), ([input]) => store.lab.timer(input));
  register(labChannels.appendExperimentLog, z.tuple([experimentLogInputSchema]), ([input]) => store.lab.appendLog(input));
  register(labChannels.listExperimentLogs, z.tuple([idSchema]), ([id]) => store.lab.logs(id));
  register(labChannels.exportExperiment, z.tuple([idSchema]), async ([id]) => {
    const window = getWindow(); if (!window) throw new Error('Window unavailable.');
    const item = store.lab.get(id);
    const output = experimentMarkdown(item, store.lab.logs(id));
    const result = await dialog.showSaveDialog(window, { defaultPath: join(exportDirectory, `${id}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, output, 'utf8'); return { canceled: false };
  });
}
