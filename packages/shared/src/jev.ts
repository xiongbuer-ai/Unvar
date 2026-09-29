import { z } from 'zod';
export const jevSettingsSchema = z.object({ enabled: z.boolean(), model: z.string().trim().regex(/^typesafe\/jev-[a-zA-Z0-9.-]+$/).max(120) }).strict();
export const jevSecretSchema = z.string().trim().min(1).max(4096);
export type JevSettings = z.infer<typeof jevSettingsSchema>;
export interface JevPublicSettings extends JevSettings { configured: boolean }
export interface JevTestResult { model: string; durationMs: number }
export interface JevAPI {
  scoreWithJev(questionId:string):Promise<JevEvaluation>;
  cancelJevScore(questionId:string):Promise<void>;
  listJevEvaluations(questionId:string):Promise<JevEvaluation[]>;
  getJevSettings(): Promise<JevPublicSettings>;
  saveJevSettings(input: JevSettings): Promise<void>;
  setJevCredential(secret: string): Promise<void>;
  deleteJevCredential(): Promise<void>;
  testJevConnection(): Promise<JevTestResult>;
}
export const jevChannels = { scoreWithJev:'unvar:jev:score', cancelJevScore:'unvar:jev:cancel', listJevEvaluations:'unvar:jev:evaluations', getJevSettings:'unvar:jev:settings', saveJevSettings:'unvar:jev:configure', setJevCredential:'unvar:jev:credential:set', deleteJevCredential:'unvar:jev:credential:delete', testJevConnection:'unvar:jev:test' } as const;

import type { QuestionScores } from './radar';
export interface ScoreEvaluation {
  engine:'jev'|'rules'; model:string|null; ruleVersion:string;
  input:{question:string;claim:string;proposedExperiment:string;researchFocus:string};
  scores:QuestionScores; rawAnswers:unknown; usage:unknown; durationMs:number; error:string|null;
}
export interface JevEvaluation extends ScoreEvaluation {id:string;questionId:string;origin:'radar'|'pi';createdAt:string}
