import { z } from 'zod';
import { idSchema } from './contracts';
export const decisionEntitySchema = z.enum(['question','experiment','finding','article']);
export const decisionQuerySchema = z.object({ search: z.string().trim().max(240).default(''), entityType: decisionEntitySchema.optional(), entityId: idSchema.optional(), overridesOnly: z.boolean().default(false), offset: z.number().int().min(0).max(1000000).default(0), limit: z.number().int().min(1).max(100).default(30) }).strict();
export const decisionOutcomeSchema = z.object({ id: idSchema, revision: z.number().int().min(0), text: z.string().trim().min(1).max(12000), operationId: z.uuid() }).strict();
export type DecisionQuery = z.input<typeof decisionQuerySchema>;
export type DecisionOutcomeInput = z.infer<typeof decisionOutcomeSchema>;
export interface DecisionRecord { id: string; type: string; entityType: z.infer<typeof decisionEntitySchema>; entityId: string; entityTitle: string; entityStatus: string; currentResult: string; aiRecommendation: unknown; humanDecision: unknown; override: boolean; reason: string; outcome: string; outcomeRevision: number; createdAt: string; resolvedAt: string | null; outcomeHistory: { revision: number; text: string; createdAt: string }[] }
export interface DecisionAPI { listDecisions(query: DecisionQuery): Promise<{ items: DecisionRecord[]; total: number }>; saveDecisionOutcome(input: DecisionOutcomeInput): Promise<DecisionRecord> }
export const decisionChannels = { listDecisions: 'unvar:decisions:list', saveDecisionOutcome: 'unvar:decisions:outcome' } as const;
