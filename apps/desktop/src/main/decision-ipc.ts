import { ipcMain } from 'electron';
import { z } from 'zod';
import { decisionChannels, decisionQuerySchema, decisionOutcomeSchema } from '@unvar/shared';
import type { Store } from '@unvar/db';
import type { TrustedRenderer } from './app-info';
import { validatedHandler } from './validated-ipc';
export function registerDecisionIPC(store: Store, trusted: () => TrustedRenderer | null) {
  ipcMain.handle(decisionChannels.listDecisions,validatedHandler(z.tuple([decisionQuerySchema]),trusted,([query])=>store.decisions.list(query)));
  ipcMain.handle(decisionChannels.saveDecisionOutcome,validatedHandler(z.tuple([decisionOutcomeSchema]),trusted,([input])=>store.decisions.saveOutcome(input)));
}
