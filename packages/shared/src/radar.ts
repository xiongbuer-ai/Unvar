import { z } from 'zod';
import { idSchema } from './contracts';

export const scoreKeys = ['workRelevance', 'experimentability', 'evidencePotential', 'uniqueness', 'seriesPotential'] as const;
const level = z.number().int().min(0).max(3);
export const scoresSchema = z.object({ workRelevance: level, experimentability: level, evidencePotential: level, uniqueness: level, seriesPotential: level }).strict();
export type QuestionScores = z.infer<typeof scoresSchema>;
export const analysisSchema = z.object({
  claims: z.array(z.object({ text: z.string().trim().min(1).max(3000), type: z.enum(['fact','data','claim','opinion','prediction','marketing']), evidenceText: z.string().max(3000) }).strict()).min(1).max(8),
  questions: z.array(z.object({ claimIndex: z.number().int().min(0), text: z.string().trim().min(1).max(2000), whyRelevant: z.string().max(3000), proposedExperiment: z.string().trim().min(1).max(4000), estimatedMinutes: z.number().int().min(1).max(10080) }).strict()).min(1).max(3),
}).strict().refine((analysis) => analysis.questions.every((question) => question.claimIndex < analysis.claims.length), 'Every question must reference an existing claim.');
export type SignalAnalysis = z.infer<typeof analysisSchema>;
export type QuestionStatus = 'candidate' | 'backlog' | 'archived';
export interface RadarQuestion {
  id: string; signalId: string; claimId: string; text: string; claim: string;
  sourceTitle: string; sourceUrl: string; whyRelevant: string; proposedExperiment: string;
  estimatedMinutes: number; scores: QuestionScores; aiScores: QuestionScores;
  humanOverride: boolean; overrideReason: string | null; status: QuestionStatus; engine: string;
}
export interface WorkflowRun { id: string; entityId: string; status: 'running' | 'failed' | 'completed' | 'canceled'; stage: string; errorMessage: string | null; startedAt: string; finishedAt: string | null }
export const analyzeInputSchema = z.object({ signalId: idSchema, providerId: idSchema }).strict();
export const editQuestionSchema = z.object({ id: idSchema, text: z.string().trim().min(1).max(2000), proposedExperiment: z.string().trim().min(1).max(4000), reason: z.string().trim().min(1).max(2000) }).strict();
export const overrideScoreSchema = z.object({ id: idSchema, scores: scoresSchema, reason: z.string().trim().min(1).max(2000) }).strict();
export const questionStatusSchema = z.object({ id: idSchema, status: z.enum(['candidate', 'backlog', 'archived']) }).strict();
export interface ClaimRecord { id: string; signalId: string; text: string; type: string; evidenceText: string; sourceTitle: string; sourceUrl: string }
export interface RadarAPI {
  listClaims(): Promise<ClaimRecord[]>;
  analyzeSignal(input: z.infer<typeof analyzeInputSchema>): Promise<WorkflowRun>;
  cancelAnalysis(runId: string): Promise<void>;
  listRuns(): Promise<WorkflowRun[]>;
  listQuestions(): Promise<RadarQuestion[]>;
  editQuestion(input: z.infer<typeof editQuestionSchema>): Promise<void>;
  overrideScore(input: z.infer<typeof overrideScoreSchema>): Promise<void>;
  setQuestionStatus(input: z.infer<typeof questionStatusSchema>): Promise<void>;
  createExperiment(questionId: string): Promise<{ id: string }>;
  testProvider(providerId: string): Promise<{ ok: boolean; message: string }>;
}
export const radarChannels = {
  listClaims: 'unvar:claims:list',
  analyzeSignal: 'unvar:radar:analyze', cancelAnalysis: 'unvar:radar:cancel', listRuns: 'unvar:runs:list',
  listQuestions: 'unvar:questions:list', editQuestion: 'unvar:questions:edit', overrideScore: 'unvar:questions:score',
  setQuestionStatus: 'unvar:questions:status', createExperiment: 'unvar:experiments:create', testProvider: 'unvar:providers:test',
} as const;
