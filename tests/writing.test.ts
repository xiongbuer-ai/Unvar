import { describe, expect, it, vi } from 'vitest';
import { confirmFactPackSchema, writingMarkdownSchema, writingReviewSchema, readyArticleSchema, saveInterviewSchema } from '../packages/shared/src/writing';
import { validatedHandler } from '../apps/desktop/src/main/validated-ipc';
const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
describe('Writing contracts', () => {
  it('keeps generated content separate from confirmation and human answers', () => {
    expect(writingMarkdownSchema.safeParse({ markdown: 'text', evidenceIds: [id], confirmed: true }).success).toBe(false);
    expect(writingMarkdownSchema.safeParse({ markdown: 'text', evidenceIds: [] }).success).toBe(false);
    expect(writingReviewSchema.safeParse({ summary: 'review', issues: [], ready: true }).success).toBe(false);
    expect(readyArticleSchema.safeParse({ id, revision: 0, reason: '' }).success).toBe(false);
    expect(saveInterviewSchema.safeParse({ id, revision: 0, title: 'test', answers: { observations: '', experience: '', opinions: '', unknowns: '', aiAnswered: true } }).success).toBe(false);
  });
  it('validates confirmation versions and trusted IPC before mutations', async () => {
    const sender = {}; const mainFrame = { url: 'file:///app/index.html' }; const operation = vi.fn();
    const handler = validatedHandler(confirmFactPackSchema.array().length(1), () => ({ sender, mainFrame, url: mainFrame.url }), operation);
    const input = { id, revision: 0, version: 1 };
    await expect(handler({ sender: {}, senderFrame: mainFrame }, input)).rejects.toThrow('Untrusted');
    await expect(handler({ sender, senderFrame: { url: mainFrame.url } }, input)).rejects.toThrow('Untrusted');
    for (const change of [{ version: 0 }, { revision: -1 }, { confirmed: true }, { sql: 'DELETE' }]) await expect(handler({ sender, senderFrame: mainFrame }, { ...input, ...change })).rejects.toThrow('Invalid request');
    expect(operation).not.toHaveBeenCalled(); await handler({ sender, senderFrame: mainFrame }, input); expect(operation).toHaveBeenCalledTimes(1);
  });
});
