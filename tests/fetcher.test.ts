import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, RequestOptions } from 'node:http';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:http', () => ({ request: network.request }));
vi.mock('node:https', () => ({ request: network.request }));
import { fetchSource } from '../packages/fetcher/src/index';

type Reply = { status?: number; location?: string; type?: string; body?: string };
function respond(replies: Reply[]) {
  network.request.mockImplementation((_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => queueMicrotask(() => {
      const reply = replies.shift();
      if (!reply) { request.emit('error', new Error('Unexpected request')); return; }
      const response = new PassThrough() as unknown as IncomingMessage;
      response.statusCode = reply.status ?? 200;
      response.headers = { 'content-type': reply.type ?? 'text/plain', ...(reply.location ? { location: reply.location } : {}) };
      callback(response);
      (response as unknown as PassThrough).end(reply.body ?? 'A repeatable experiment should preserve evidence and make its limitations explicit. '.repeat(4));
    });
    return request;
  });
}
beforeEach(() => {
  network.lookup.mockReset().mockResolvedValue([{ address: '93.184.215.14', family: 4 }]);
  network.request.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('Bounded source fetching', () => {
  it('pins the validated public DNS result instead of resolving again', async () => {
    respond([{}]);
    const source = await fetchSource('https://example.com/article');
    expect(source.text).toContain('repeatable experiment');
    const options = network.request.mock.calls[0][1];
    const callback = vi.fn();
    options.lookup('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.215.14', family: 4 }]);
    expect(network.lookup).toHaveBeenCalledTimes(1);
  });
  it('rejects mixed public/private DNS responses before opening a connection', async () => {
    network.lookup.mockResolvedValue([{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    await expect(fetchSource('https://example.com')).rejects.toThrow('private');
    expect(network.request).not.toHaveBeenCalled();
  });
  it('checks redirect destinations for private addresses', async () => {
    network.lookup.mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }]).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    respond([{ status: 302, location: 'http://localhost/admin' }]);
    await expect(fetchSource('https://example.com')).rejects.toThrow('private');
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it('rejects redirect credentials and non-HTTP schemes', async () => {
    for (const location of ['file:///etc/passwd', 'https://name:password@example.com']) {
      respond([{ status: 302, location }]);
      await expect(fetchSource('https://example.com')).rejects.toThrow('HTTP(S)');
    }
  });
  it('caps redirect loops at six requests', async () => {
    respond(Array.from({ length: 6 }, () => ({ status: 302, location: '/loop' })));
    await expect(fetchSource('https://example.com')).rejects.toThrow('too many');
    expect(network.request).toHaveBeenCalledTimes(6);
  });
  it('retains the original URL while following a safe relative redirect', async () => {
    respond([{ status: 302, location: '/article' }, {}]);
    const source = await fetchSource('https://example.com/start');
    expect(source.normalizedUrl).toBe('https://example.com/start');
    expect(source.finalUrl).toBe('https://example.com/article');
  });
  it('rejects a response over two megabytes', async () => {
    respond([{ body: 'x'.repeat(2_000_001) }]);
    await expect(fetchSource('https://example.com')).rejects.toThrow('2 MB');
  });
  it('rejects unsupported MIME types and HTTP failures', async () => {
    respond([{ type: 'application/pdf' }]);
    await expect(fetchSource('https://example.com')).rejects.toThrow('HTML and plain-text');
    respond([{ status: 403 }]);
    await expect(fetchSource('https://example.com')).rejects.toThrow('HTTP 403');
  });
  it('cancels an unresolved DNS lookup without opening a connection', async () => {
    network.lookup.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = fetchSource('https://example.com', controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('Canceled by user');
    expect(network.request).not.toHaveBeenCalled();
  });
  it('aborts an in-flight HTTP request without retrying', async () => {
    const controller = new AbortController();
    network.request.mockImplementation((_url: URL, options: RequestOptions) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => controller.abort();
      options.signal?.addEventListener('abort', () => request.emit('error', new Error('Aborted')), { once: true });
      return request;
    });
    await expect(fetchSource('https://example.com', controller.signal)).rejects.toThrow('Canceled by user');
    expect(network.request).toHaveBeenCalledTimes(1);
  });
  it('applies the overall timeout during DNS resolution', async () => {
    network.lookup.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const pending = fetchSource('https://example.com');
    controller.abort();
    await expect(pending).rejects.toThrow('timed out');
    expect(network.request).not.toHaveBeenCalled();
  });
});
