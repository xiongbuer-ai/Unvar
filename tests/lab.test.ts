import { describe, expect, it } from 'vitest';
import { experimentInputSchema, experimentLogInputSchema, transitionExperimentSchema } from '../packages/shared/src/lab';
const input = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', revision: 0, title: 'Experiment', prediction: '', baseline: '', method: '', metrics: '', result: '', limitations: '', trust: null, humanTimeMinutes: 0, interventionCount: 0, bugCount: 0, reworkCount: 0 };
describe('Lab input boundaries', () => {
  it('allows empty Prediction for drafts, without inventing one', () => { expect(experimentInputSchema.parse(input).prediction).toBe(''); });
  it('rejects out-of-range trust, negative metrics and unexpected fields', () => {
    for (const change of [{ trust: 6 }, { trust: 0 }, { bugCount: -1 }, { humanTimeMinutes: 1.5 }, { sql: 'DROP TABLE experiments' }]) expect(experimentInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it('requires a valid idempotency key and nonempty human log text', () => {
    expect(experimentLogInputSchema.safeParse({ experimentId: input.id, operationId: 'bad', text: 'Observed' }).success).toBe(false);
    expect(experimentLogInputSchema.safeParse({ experimentId: input.id, operationId: '550e8400-e29b-41d4-a716-446655440000', text: ' ' }).success).toBe(false);
  });
  it('rejects invented statuses and revisions', () => {
    expect(transitionExperimentSchema.safeParse({ id: input.id, revision: 0, status: 'published' }).success).toBe(false);
    expect(transitionExperimentSchema.safeParse({ id: input.id, revision: -1, status: 'done' }).success).toBe(false);
  });
});
