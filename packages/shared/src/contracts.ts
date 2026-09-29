import type { PiAPI } from './pi';
import type { DecisionAPI } from './decisions';
import type { WritingAPI } from './writing';
import type { FindingAPI } from './finding';
import type { LabAPI } from './lab';
import { z } from 'zod';
import type { RadarAPI } from './radar';

export const idSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export const httpUrlSchema = z.string().trim().max(4096).url().refine((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}, 'Use an HTTP(S) URL without embedded credentials.');
export const signalKinds = ['url', 'note', 'question', 'judgment', 'experiment_idea', 'code'] as const;
export const signalStatusSchema = z.enum(['inbox', 'archived']);
export const signalInputSchema = z.object({
  id: idSchema.optional(),
  kind: z.enum(signalKinds),
  title: z.string().trim().max(240),
  text: z.string().max(100_000),
  url: z.union([httpUrlSchema, z.literal('')]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).transform((tags) => [...new Set(tags)]),
}).strict().superRefine((input, context) => {
  if (input.kind === 'url' && !input.url) context.addIssue({ code: 'custom', message: 'URL is required.', path: ['url'] });
  if (input.kind !== 'url' && !input.text.trim()) context.addIssue({ code: 'custom', message: 'Text is required.', path: ['text'] });
});
export const signalQuerySchema = z.object({
  search: z.string().trim().max(240).default(''),
  status: z.enum(['inbox', 'archived', 'all']).default('inbox'),
}).strict();
export const statusInputSchema = z.object({ id: idSchema, status: signalStatusSchema }).strict();
export const providerInputSchema = z.object({
  id: idSchema.optional(),
  providerType: z.enum(['openai-compatible', 'anthropic', 'deepseek']),
  displayName: z.string().trim().min(1).max(80),
  baseUrl: httpUrlSchema,
  model: z.string().trim().min(1).max(160),
  enabled: z.boolean(),
}).strict();
export const credentialInputSchema = z.object({ providerId: idSchema, secret: z.string().min(1).max(8192) }).strict();
export const researchSettingsSchema = z.object({ researchFocus: z.string().trim().max(4000) }).strict();

export type SignalInput = z.infer<typeof signalInputSchema>;
export interface Signal extends Omit<SignalInput, 'id'> {
  id: string;
  source: string;
  status: z.infer<typeof signalStatusSchema>;
  createdAt: string;
  updatedAt: string;
}
export type SignalQuery = z.input<typeof signalQuerySchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export interface ProviderSettings extends Omit<ProviderInput, 'id'> { id: string; configured: boolean }
export type ResearchSettings = z.infer<typeof researchSettingsSchema>;

export interface WorkspaceAPI extends RadarAPI, LabAPI, FindingAPI, WritingAPI, DecisionAPI, PiAPI {
  listSignals(input: SignalQuery): Promise<Signal[]>;
  saveSignal(input: SignalInput): Promise<Signal>;
  setSignalStatus(input: z.infer<typeof statusInputSchema>): Promise<void>;
  exportSignal(id: string): Promise<{ canceled: boolean }>;
  listProviders(): Promise<ProviderSettings[]>;
  saveProvider(input: ProviderInput): Promise<ProviderSettings>;
  setCredential(input: z.infer<typeof credentialInputSchema>): Promise<void>;
  deleteCredential(providerId: string): Promise<void>;
  getResearchSettings(): Promise<ResearchSettings>;
  saveResearchSettings(input: ResearchSettings): Promise<void>;
}

export const channels = {
  listSignals: 'unvar:signals:list', saveSignal: 'unvar:signals:save',
  setSignalStatus: 'unvar:signals:status', exportSignal: 'unvar:signals:export',
  listProviders: 'unvar:providers:list', saveProvider: 'unvar:providers:save',
  setCredential: 'unvar:credentials:set', deleteCredential: 'unvar:credentials:delete',
  getResearchSettings: 'unvar:settings:get', saveResearchSettings: 'unvar:settings:save',
} as const;
