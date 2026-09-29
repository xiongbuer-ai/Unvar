import { z } from 'zod';
import { idSchema } from './contracts';
export const findingStatusSchema = z.enum(['candidate', 'testing', 'accepted', 'challenged', 'archived']);
export const findingEvidenceSchema = z.object({ experimentId: idSchema, relation: z.enum(['supports', 'contradicts', 'contextual']), note: z.string().trim().max(4000) }).strict();
const evidence = z.array(findingEvidenceSchema).max(20).refine(items => new Set(items.map(item => item.experimentId)).size === items.length, 'Evidence references must be unique.');
const fields = { text: z.string().trim().min(1).max(12000), confidence: z.enum(['low', 'medium', 'high']), counterEvidence: z.string().trim().max(12000), evidence };
export const findingCandidateSchema = z.object(fields).strict().refine(value => value.evidence.length > 0, 'A candidate requires experiment evidence.');
export type FindingCandidate = z.infer<typeof findingCandidateSchema>;
export const editFindingSchema = z.object({ ...fields, id: idSchema, revision: z.number().int().min(0), reason: z.string().trim().min(1).max(4000) }).strict();
export const reviewFindingSchema = z.object({ id: idSchema, revision: z.number().int().min(0), action: z.enum(['accept', 'reject']), reason: z.string().trim().min(1).max(4000) }).strict();
export const generateFindingSchema = z.object({ experimentIds: z.array(idSchema).min(1).max(10).refine(ids => new Set(ids).size === ids.length), providerId: idSchema, operationId: z.uuid() }).strict();
export interface Finding extends FindingCandidate {
  id: string; revision: number; status: z.infer<typeof findingStatusSchema>; aiProposal: FindingCandidate;
  runId: string; confirmedAt: string | null; createdAt: string; updatedAt: string;
}
export interface FindingRun {
  id: string; experimentIds: string[]; providerId: string; status: 'running' | 'completed' | 'failed' | 'canceled';
  error: string | null; findingId: string | null; startedAt: string; finishedAt: string | null;
  calls: { model: string; durationMs: number; usage: Record<string, number> }[];
}
export interface FindingAPI {
  listFindings(): Promise<Finding[]>;
  generateFinding(input: z.infer<typeof generateFindingSchema>): Promise<FindingRun>;
  listFindingRuns(): Promise<FindingRun[]>;
  cancelFindingRun(id: string): Promise<void>;
  editFinding(input: z.infer<typeof editFindingSchema>): Promise<Finding>;
  reviewFinding(input: z.infer<typeof reviewFindingSchema>): Promise<Finding>;
}
export const findingChannels = { listFindings: 'unvar:finding:list', generateFinding: 'unvar:finding:generate', listFindingRuns: 'unvar:finding:runs', cancelFindingRun: 'unvar:finding:cancel', editFinding: 'unvar:finding:edit', reviewFinding: 'unvar:finding:review' } as const;

export type GenerateFindingInput = z.infer<typeof generateFindingSchema>;
export type EditFindingInput = z.infer<typeof editFindingSchema>;
export type ReviewFindingInput = z.infer<typeof reviewFindingSchema>;
