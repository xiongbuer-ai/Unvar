import { z } from 'zod';
import { idSchema } from './contracts';
const text = z.string().trim().max(12000);
export const articleSourceSchema = z.object({ kind: z.enum(['experiment','finding']), id: idSchema }).strict();
export const interviewSchema = z.object({ observations: text, experience: text, opinions: text, unknowns: text }).strict();
export type Interview = z.infer<typeof interviewSchema>;
export const createArticleSchema = z.object({ title: z.string().trim().min(1).max(240), source: articleSourceSchema, operationId: z.uuid() }).strict();
const revision = z.number().int().min(0);
export const saveInterviewSchema = z.object({ id: idSchema, revision, title: z.string().trim().min(1).max(240), answers: interviewSchema }).strict();
export const articleVersionSchema = z.object({ id: idSchema, revision }).strict();
export const confirmFactPackSchema = z.object({ id: idSchema, revision, version: z.number().int().min(1) }).strict();
export const writingStageSchema = z.enum(['outline','draft','review']);
export type WritingStage = z.infer<typeof writingStageSchema>;
export const generateWritingSchema = z.object({ articleId: idSchema, providerId: idSchema, stage: writingStageSchema, operationId: z.uuid() }).strict();
export const writingMarkdownSchema = z.object({ markdown: z.string().trim().min(1).max(100000), evidenceIds: z.array(idSchema).min(1).max(30) }).strict();
export const writingReviewSchema = z.object({ summary: z.string().trim().min(1).max(12000), issues: z.array(z.string().trim().min(1).max(2000)).max(20) }).strict();
export const editArticleSchema = z.object({ id: idSchema, revision, part: z.enum(['outline','draft']), markdown: z.string().trim().min(1).max(100000), reason: z.string().trim().min(1).max(4000) }).strict();
export const readyArticleSchema = z.object({ id: idSchema, revision, reason: z.string().trim().min(1).max(4000) }).strict();
export interface FactEvidence { id: string; kind: 'experiment' | 'finding'; title: string; text: string; limitations: string; sourceUrl: string; relation?: 'supports' | 'contradicts' | 'contextual'; note?: string }
export interface FactPack { version: number; confirmedFacts: { text: string; evidenceIds: string[] }[]; userOpinions: string[]; userExperiences: string[]; evidence: FactEvidence[]; limitations: string[]; unknowns: string[] }
export interface Article {
  id: string; revision: number; title: string; source: z.infer<typeof articleSourceSchema>; status: 'interview'|'evidence'|'outline'|'draft'|'edit'|'review'|'ready';
  interview: Interview; factPack: FactPack | null; confirmedVersion: number | null; confirmationValid: boolean;
  outlineMd: string; draftMd: string; finalMd: string; outlineVersion: number | null; draftVersion: number | null;
  review: z.infer<typeof writingReviewSchema> | null; reviewCurrent: boolean; readyAt: string | null; updatedAt: string;
}
export interface WritingRun { id: string; articleId: string; stage: WritingStage; status: 'running'|'completed'|'failed'|'canceled'; error: string | null; startedAt: string; finishedAt: string | null; calls: { model: string; durationMs: number; usage: Record<string, number> }[] }
export type CreateArticleInput = z.infer<typeof createArticleSchema>;
export type SaveInterviewInput = z.infer<typeof saveInterviewSchema>;
export type ArticleVersionInput = z.infer<typeof articleVersionSchema>;
export type ConfirmFactPackInput = z.infer<typeof confirmFactPackSchema>;
export type GenerateWritingInput = z.infer<typeof generateWritingSchema>;
export type EditArticleInput = z.infer<typeof editArticleSchema>;
export type ReadyArticleInput = z.infer<typeof readyArticleSchema>;
export type WritingOutput = z.infer<typeof writingMarkdownSchema> | z.infer<typeof writingReviewSchema>;
export interface WritingAPI {
  listArticles(): Promise<Article[]>; createArticle(input: CreateArticleInput): Promise<Article>;
  saveInterview(input: SaveInterviewInput): Promise<Article>; buildFactPack(input: ArticleVersionInput): Promise<Article>;
  confirmFactPack(input: ConfirmFactPackInput): Promise<Article>; generateWriting(input: GenerateWritingInput): Promise<WritingRun>;
  listWritingRuns(): Promise<WritingRun[]>; cancelWritingRun(id: string): Promise<void>;
  editArticle(input: EditArticleInput): Promise<Article>; readyArticle(input: ReadyArticleInput): Promise<Article>;
  exportArticle(id: string): Promise<{ canceled: boolean }>;
}
export const writingChannels = { listArticles:'unvar:writing:list', createArticle:'unvar:writing:create', saveInterview:'unvar:writing:interview', buildFactPack:'unvar:writing:pack', confirmFactPack:'unvar:writing:confirm', generateWriting:'unvar:writing:generate', listWritingRuns:'unvar:writing:runs', cancelWritingRun:'unvar:writing:cancel', editArticle:'unvar:writing:edit', readyArticle:'unvar:writing:ready', exportArticle:'unvar:writing:export' } as const;
