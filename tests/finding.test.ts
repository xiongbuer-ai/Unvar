import { describe, expect, it, vi } from 'vitest';
import { findingCandidateSchema, editFindingSchema, reviewFindingSchema, generateFindingSchema } from '../packages/shared/src/finding';
import { validatedHandler } from '../apps/desktop/src/main/validated-ipc';
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const candidate = { text: 'Bounded observation.', confidence: 'low', counterEvidence: '', evidence: [{ experimentId: id, relation: 'contextual', note: 'One local run.' }] };
describe('Finding contracts and trusted IPC', () => {
  it('forbids generated confirmation, unbounded confidence and missing/duplicate evidence', () => {
    for (const change of [{ status: 'accepted' }, { confirmedAt: 'now' }, { confidence: 0.99 }, { evidence: [] }, { evidence: [...candidate.evidence, ...candidate.evidence] }]) expect(findingCandidateSchema.safeParse({ ...candidate, ...change }).success).toBe(false);
    expect(findingCandidateSchema.safeParse(candidate).success).toBe(true);
  });
  it('requires explicit human reasons and optimistic revisions', () => {
    expect(editFindingSchema.safeParse({ ...candidate, id, revision: 0, reason: '' }).success).toBe(false);
    expect(reviewFindingSchema.safeParse({ id, revision: -1, action: 'accept', reason: 'Reviewed' }).success).toBe(false);
    expect(reviewFindingSchema.safeParse({ id, revision: 0, action: 'auto-accept', reason: 'Model' }).success).toBe(false);
  });
  it('requires a bounded, unique selection and a generation idempotency key', () => {
    const request = { experimentIds: [id], providerId: id, operationId: '550e8400-e29b-41d4-a716-446655440000' };
    expect(generateFindingSchema.safeParse(request).success).toBe(true);
    for (const change of [{ experimentIds: [] }, { experimentIds: [id, id] }, { operationId: '' }, { secret: 'fake' }]) expect(generateFindingSchema.safeParse({ ...request, ...change }).success).toBe(false);
  });
  it('rejects untrusted senders and payloads before a confirmation mutation', async () => {
    const sender = {}; const mainFrame = { url: 'file:///app/index.html' };
    const operation = vi.fn();
    const handler = validatedHandler(reviewFindingSchema.array().length(1), () => ({ sender, mainFrame, url: mainFrame.url }), operation);
    const input = { id, revision: 0, action: 'accept', reason: 'I checked the recorded evidence.' };
    await expect(handler({ sender: {}, senderFrame: mainFrame }, input)).rejects.toThrow('Untrusted');
    await expect(handler({ sender, senderFrame: { url: mainFrame.url } }, input)).rejects.toThrow('Untrusted');
    await expect(handler({ sender, senderFrame: mainFrame }, { ...input, sql: 'DELETE' })).rejects.toThrow('Invalid request');
    expect(operation).not.toHaveBeenCalled();
    await handler({ sender, senderFrame: mainFrame }, input); expect(operation).toHaveBeenCalledTimes(1);
  });
});
