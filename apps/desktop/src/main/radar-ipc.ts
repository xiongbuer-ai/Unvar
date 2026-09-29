import { fetchDesktopSource } from './source-fetcher';
import { ipcMain } from 'electron';
import { z } from 'zod';
import { radarChannels, analyzeInputSchema, idSchema, editQuestionSchema, overrideScoreSchema, questionStatusSchema } from '@unvar/shared';
import { HttpLLMProvider, ProviderError } from '@unvar/llm';
import { RadarWorkflow } from '@unvar/workflows';
import type { WorkspaceService } from './workspace-service';
import type { TrustedRenderer } from './app-info';
import { validatedHandler } from './validated-ipc';
import analysisPrompt from '../../../../prompts/radar.md?raw';
import scorePrompt from '../../../../prompts/question-score.md?raw';

export function registerRadarIPC(service: WorkspaceService, trusted: () => TrustedRenderer | null, scoring?:import('@unvar/workflows').JevScoringService) {
  const repository = service.store.radar;
  repository.recoverInterruptedRuns();
  const workflow = new RadarWorkflow(service.store, { analysis: analysisPrompt, score: scorePrompt }, fetchDesktopSource, scoring);
  const provider = (id: string) => {
    const config = service.store.getProvider(id);
    if (!config.enabled) throw new Error('Provider is disabled.');
    return new HttpLLMProvider(config, () => service.credentials.get(config.credentialKeyRef));
  };
  const register = <T>(channel: string, schema: z.ZodType<T>, operation: (input: T) => unknown) => ipcMain.handle(channel, validatedHandler(schema, trusted, operation));
  register(radarChannels.analyzeSignal, z.tuple([analyzeInputSchema]), ([input]) => workflow.start(input.signalId, provider(input.providerId)));
  register(radarChannels.cancelAnalysis, z.tuple([idSchema]), ([id]) => workflow.cancel(id));
  register(radarChannels.listRuns, z.tuple([]), () => repository.listRuns());
  register(radarChannels.listClaims, z.tuple([]), () => repository.listClaims());
  register(radarChannels.listQuestions, z.tuple([]), () => repository.listQuestions());
  register(radarChannels.editQuestion, z.tuple([editQuestionSchema]), ([input]) => repository.editQuestion(input.id, input.text, input.proposedExperiment, input.reason));
  register(radarChannels.overrideScore, z.tuple([overrideScoreSchema]), ([input]) => repository.overrideScore(input.id, input.scores, input.reason));
  register(radarChannels.setQuestionStatus, z.tuple([questionStatusSchema]), ([input]) => repository.setStatus(input.id, input.status));
  register(radarChannels.createExperiment, z.tuple([idSchema]), ([id]) => repository.createExperiment(id));
  register(radarChannels.testProvider, z.tuple([idSchema]), async ([id]) => {
    try {
      const result = await provider(id).generateText({ system: 'Connection test. Reply with OK only.', prompt: 'Reply OK.' });
      return { ok: Boolean(result.text.trim()), message: result.text.trim() ? `Connected to ${result.model}.` : 'Provider returned empty text.' };
    } catch (error) { return { ok: false, message: error instanceof ProviderError ? error.message : 'Provider is unavailable. Check Settings.' }; }
  });
  return workflow;
}
