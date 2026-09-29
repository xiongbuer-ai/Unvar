import { z } from 'zod';
import { idSchema } from './contracts';
export const piSearchSchema=z.object({query:z.string().trim().min(1).max(240)}).strict();
export const piReadSchema=z.object({id:idSchema}).strict();
export const piSettingsSchema = z.object({ enabled: z.boolean() }).strict();
export const piStartSchema = z.object({ articleId:idSchema,providerId:idSchema,operationId:z.uuid() }).strict();
export const piCandidateSchema = z.object({ summary:z.string().trim().min(1).max(8000),evidenceIds:z.array(idSchema).min(1).max(20),questions:z.array(z.object({field:z.enum(['observations','experience','opinions','unknowns']),text:z.string().trim().min(1).max(1000)}).strict()).min(1).max(3) }).strict();
export const piAnswersSchema = z.object({ runId:idSchema,articleRevision:z.number().int().min(0),answers:z.array(z.object({index:z.number().int().min(0).max(2),text:z.string().trim().min(1).max(3000)}).strict()).min(1).max(3) }).strict().refine(input=>new Set(input.answers.map(answer=>answer.index)).size===input.answers.length,'Duplicate answer.');
export type PiStartInput=z.infer<typeof piStartSchema>;
export type PiAnswersInput=z.infer<typeof piAnswersSchema>;
export type PiCandidate=z.infer<typeof piCandidateSchema>;
export interface PiTrace { tool:string; status:'completed'|'failed'|'blocked'; evidenceIds:string[]; at:string }
export interface PiRun { id:string;articleId:string;providerId:string;status:'running'|'completed'|'failed'|'canceled';error:string|null;candidate:PiCandidate|null;traces:PiTrace[];calls:{model:string;durationMs:number;usage:Record<string,number>}[];startedAt:string;finishedAt:string|null;applied:boolean }
export interface PiAPI { getPiSettings():Promise<{enabled:boolean}>;savePiSettings(input:{enabled:boolean}):Promise<void>;startPiInterview(input:PiStartInput):Promise<PiRun>;listPiRuns(articleId:string):Promise<PiRun[]>;cancelPiRun(id:string):Promise<void>;savePiAnswers(input:PiAnswersInput):Promise<void> }
export const piChannels={getPiSettings:'unvar:pi:settings',savePiSettings:'unvar:pi:configure',startPiInterview:'unvar:pi:start',listPiRuns:'unvar:pi:runs',cancelPiRun:'unvar:pi:cancel',savePiAnswers:'unvar:pi:answers'} as const;
