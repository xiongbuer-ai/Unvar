import { describe, expect, it, vi } from 'vitest';
import { HttpLLMProvider } from '../packages/llm/src/index';
import { analysisSchema, scoresSchema } from '../packages/shared/src/radar';
import { isPublicAddress, normalizeUrl, extractSource, fetchSource } from '../packages/fetcher/src/index';
import { routeQuestion, RuleDecisionEngine } from '../packages/decision/src/index';

const config = { id: 'test', providerType: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
const response = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], model: 'actual-model', usage: { total_tokens: 12 } }));
describe('Provider contract', () => {
  it('uses configured DeepSeek endpoint and permits one schema repair', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(response('{"value":"wrong"}')).mockResolvedValueOnce(response(JSON.stringify({ workRelevance: 3, experimentability: 2, evidencePotential: 2, uniqueness: 1, seriesPotential: 1 })));
    const provider = new HttpLLMProvider(config, async () => 'fake-key', transport);
    expect(await provider.generateStructured({ system: 'JSON', prompt: 'Question', schema: scoresSchema })).toMatchObject({ workRelevance: 3 });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.max_tokens).toBe(8192);
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body)).messages[1].content).toContain('Previous output:');
  });
  it('rejects invalid output after the one permitted repair', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => response('invalid'));
    const provider = new HttpLLMProvider(config, async () => 'fake-key', transport);
    await expect(provider.generateStructured({ system: 'JSON', prompt: 'Question', schema: scoresSchema })).rejects.toThrow('one repair');
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('does not retry HTTP errors or disclose response bodies', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-secret', { status: 401 }));
    const provider = new HttpLLMProvider(config, async () => 'fake-key', transport);
    await expect(provider.generateText({ system: '', prompt: '' })).rejects.toThrow('HTTP 401');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not start a canceled or unconfigured request', async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = new HttpLLMProvider(config, async () => null, transport);
    await expect(provider.generateText({ system: '', prompt: '' })).rejects.toThrow('not configured');
    await expect(provider.generateText({ system: '', prompt: '', signal: AbortSignal.abort() })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it('adapts Anthropic text blocks and actual model', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hello' }], model: 'actual' })));
    const provider = new HttpLLMProvider({ ...config, providerType: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, async () => 'fake-key', transport);
    expect(await provider.generateText({ system: 'System', prompt: 'User' })).toMatchObject({ text: 'Hello', model: 'actual' });
    expect(transport.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });
});
describe('Source safety and scoring', () => {
  it('canonicalizes tracking and rejects unsupported protocols and credentials', () => {
    expect(normalizeUrl('https://example.com/a?z=2&utm_source=x&a=1#section')).toBe('https://example.com/a?a=1&z=2');
    for (const url of ['file:///etc/passwd', 'https://user:password@example.com', 'javascript:alert(1)']) expect(() => normalizeUrl(url)).toThrow();
  });
  it('rejects loopback, private, reserved and IPv4-mapped private networks', async () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', '::ffff:127.0.0.1', '0.0.0.0']) expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    await expect(fetchSource('http://127.0.0.1/')).rejects.toThrow('private');
  });
  it('extracts static text without executing source scripts', () => {
    const source = extractSource(`<html><title>Research</title><body><article><p>${'Evidence about database transactions and reliable applications. '.repeat(10)}</p></article><script>throw new Error('executed')</script></body></html>`, 'https://example.com');
    expect(source.title).toBe('Research');
    expect(source.text).not.toContain('executed');
    expect(source.contentHash).toHaveLength(64);
  });
  it('rejects incomplete scores and invalid claim references', () => {
    expect(scoresSchema.safeParse({ workRelevance: 4 }).success).toBe(false);
    expect(analysisSchema.safeParse({ claims: [{ text: 'Claim', type: 'fact', evidenceText: 'Claim' }], questions: [{ claimIndex: 1, text: 'Q', whyRelevant: '', proposedExperiment: 'Test', estimatedMinutes: 10 }] }).success).toBe(false);
  });
  it('keeps conservative rules results in backlog', async () => {
    const scores = await new RuleDecisionEngine().scoreQuestion({ question: 'Q', claim: 'C', researchFocus: '', proposedExperiment: 'Test' });
    expect(routeQuestion(scores)).toBe('backlog');
    expect(routeQuestion({ workRelevance: 2, experimentability: 2, evidencePotential: 2, uniqueness: 0, seriesPotential: 0 })).toBe('candidate');
  });
});
