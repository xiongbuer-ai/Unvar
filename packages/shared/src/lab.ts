import { z } from 'zod';
import { idSchema } from './contracts';
export const experimentStatusSchema = z.enum(['idea', 'ready', 'running', 'analyzing', 'done', 'archived']);
export type ExperimentStatus = z.infer<typeof experimentStatusSchema>;
const text = z.string().trim().max(20000);
const count = z.number().int().min(0).max(1000000);
export const experimentInputSchema = z.object({
  id: idSchema, revision: count, title: z.string().trim().min(1).max(300), prediction: text, baseline: text, method: text,
  metrics: text, result: text, limitations: text, trust: z.number().int().min(1).max(5).nullable(),
  humanTimeMinutes: count, interventionCount: count, bugCount: count, reworkCount: count,
}).strict();
export type ExperimentInput = z.infer<typeof experimentInputSchema>;
export interface Experiment extends ExperimentInput {
  questionId: string; question: string; claim: string; signalId: string; sourceTitle: string; sourceUrl: string;
  status: ExperimentStatus; timerStartedAt: string | null; elapsedSeconds: number; startedAt: string | null; finishedAt: string | null;
}
export const transitionExperimentSchema = z.object({ id: idSchema, status: experimentStatusSchema, revision: count }).strict();
export const timerInputSchema = z.object({ id: idSchema, action: z.enum(['start','pause']) }).strict();
export const experimentLogInputSchema = z.object({ experimentId: idSchema, operationId: z.uuid(), text: z.string().trim().min(1).max(20000) }).strict();
export interface ExperimentLog { id: string; experimentId: string; eventType: string; text: string; elapsedSeconds: number; createdAt: string }
export interface LabAPI {
  listExperiments(): Promise<Experiment[]>;
  saveExperiment(input: ExperimentInput): Promise<Experiment>;
  transitionExperiment(input: z.infer<typeof transitionExperimentSchema>): Promise<Experiment>;
  controlExperimentTimer(input: z.infer<typeof timerInputSchema>): Promise<Experiment>;
  appendExperimentLog(input: z.infer<typeof experimentLogInputSchema>): Promise<void>;
  listExperimentLogs(id: string): Promise<ExperimentLog[]>;
  exportExperiment(id: string): Promise<{ canceled: boolean }>;
}
export const labChannels = {
  listExperiments: 'unvar:lab:list', saveExperiment: 'unvar:lab:save', transitionExperiment: 'unvar:lab:transition',
  controlExperimentTimer: 'unvar:lab:timer', appendExperimentLog: 'unvar:lab:log:add', listExperimentLogs: 'unvar:lab:logs', exportExperiment: 'unvar:lab:export',
} as const;
