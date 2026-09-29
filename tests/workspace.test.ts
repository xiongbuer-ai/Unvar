import { describe, expect, it, vi } from 'vitest';
import { signalInputSchema, providerInputSchema, credentialInputSchema, httpUrlSchema } from '../packages/shared/src/contracts';
import { validatedHandler } from '../apps/desktop/src/main/validated-ipc';
import { signalMarkdown } from '../apps/desktop/src/main/markdown';

describe('capture and settings contracts', () => {
  const note = { kind: 'note', title: '', text: 'Observation', url: '', tags: [' research ', 'research'] };
  it('normalizes tags without changing user content', () => {
    expect(signalInputSchema.parse(note).tags).toEqual(['research']);
    expect(signalInputSchema.parse(note).text).toBe('Observation');
  });
  it('rejects empty notes, missing URL captures, and unknown fields', () => {
    expect(signalInputSchema.safeParse({ ...note, text: '  ' }).success).toBe(false);
    expect(signalInputSchema.safeParse({ ...note, kind: 'url' }).success).toBe(false);
    expect(signalInputSchema.safeParse({ ...note, secret: 'fake' }).success).toBe(false);
  });
  it.each(['file:///etc/hosts', 'javascript:alert(1)', 'https://user:password@example.com'])('rejects unsafe URL %s', (url) => {
    expect(httpUrlSchema.safeParse(url).success).toBe(false);
  });
  it('rejects secrets in provider metadata', () => {
    expect(providerInputSchema.safeParse({ providerType: 'openai-compatible', displayName: 'Mock', baseUrl: 'https://example.com', model: 'mock', enabled: true, secret: 'fake' }).success).toBe(false);
  });
  it('exports original text and source without provider data', () => {
    const result = signalMarkdown({ ...signalInputSchema.parse(note), id: '01J00000000000000000000000', status: 'inbox', source: 'manual', createdAt: '2026-09-29', updatedAt: '2026-09-29' });
    expect(result).toContain('Observation');
    expect(result).toContain('research');
  });
});

describe('validated IPC boundary', () => {
  const sender = {};
  const mainFrame = { url: 'file:///app/index.html' };
  const trusted = () => ({ sender, mainFrame, url: mainFrame.url });
  const event = { sender, senderFrame: mainFrame };
  it('rejects extra arguments before invoking a mutation', async () => {
    const mutation = vi.fn();
    const handler = validatedHandler(credentialInputSchema.array().length(1), trusted, mutation);
    await expect(handler(event, {}, {})).rejects.toThrow('Invalid request');
    expect(mutation).not.toHaveBeenCalled();
  });
  it('rejects other windows', async () => {
    const mutation = vi.fn();
    const handler = validatedHandler(credentialInputSchema.array(), trusted, mutation);
    await expect(handler({ ...event, sender: {} })).rejects.toThrow('Untrusted');
    expect(mutation).not.toHaveBeenCalled();
  });
  it('never includes a credential or backend error detail in the public error', async () => {
    const handler = validatedHandler(credentialInputSchema.array(), trusted, () => { throw new Error('fake-private-secret'); });
    await expect(handler(event)).rejects.toThrow('Operation could not be completed');
    await expect(handler(event)).rejects.not.toThrow('fake-private-secret');
  });
});
