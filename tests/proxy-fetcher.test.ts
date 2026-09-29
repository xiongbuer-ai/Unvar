import { describe, expect, it, vi } from 'vitest';
import { fetchProxySource } from '../packages/fetcher/src/index';
const body = 'A reproducible research observation with sufficient readable evidence. '.repeat(4);
const ok = () => new Response(body, { headers: { 'content-type': 'text/plain' } });
describe('Proxy-managed source transport', () => {
  it('delegates public hostnames to transport without local DNS preflight', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(ok());
    expect((await fetchProxySource('https://example.com', undefined, transport)).text).toBe(body.trim());
    expect(transport.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'manual' });
  });
  it('rejects explicit local targets and non-HTTP schemes before transport', async () => {
    const transport = vi.fn<typeof fetch>();
    for (const target of ['http://localhost', 'http://service.local', 'http://printer', 'http://127.1', 'http://[::1]', 'http://10.0.0.1', 'file:///etc/passwd', 'https://user:pass@example.com']) {
      await expect(fetchProxySource(target, undefined, transport)).rejects.toThrow();
    }
    expect(transport).not.toHaveBeenCalled();
  });
  it('revalidates each redirect target', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    await expect(fetchProxySource('https://example.com', undefined, transport)).rejects.toThrow('private');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('bounds redirect loops', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/loop' } }));
    await expect(fetchProxySource('https://example.com', undefined, transport)).rejects.toThrow('too many');
    expect(transport).toHaveBeenCalledTimes(6);
  });
  it('rejects unsupported and oversized responses', async () => {
    await expect(fetchProxySource('https://example.com', undefined, async () => new Response('pdf', { headers: { 'content-type': 'application/pdf' } }))).rejects.toThrow('HTML');
    await expect(fetchProxySource('https://example.com', undefined, async () => new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/plain' } }))).rejects.toThrow('2 MB');
  });
  it('does not start canceled fetches', async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(fetchProxySource('https://example.com', AbortSignal.abort(), transport)).rejects.toThrow('Canceled');
    expect(transport).not.toHaveBeenCalled();
  });
  it('reports HTTP errors without returning remote body contents', async () => {
    await expect(fetchProxySource('https://example.com', undefined, async () => new Response('sensitive', { status: 403 }))).rejects.toThrow('HTTP 403');
  });
});
