import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';

export class FetchError extends Error {}
export function normalizeUrl(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new FetchError('Invalid URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new FetchError('Only HTTP(S) URLs without credentials are supported.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === 'unicast';
  } catch { return false; }
}
export interface SourceContent { normalizedUrl: string; finalUrl: string; title: string; text: string; contentHash: string }
export function extractSource(html: string, url: string): SourceContent {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  try {
    const document = dom.window.document;
    document.querySelectorAll('script,style,noscript,iframe,form,svg').forEach((element) => element.remove());
    const article = new Readability(document).parse();
    const text = (article?.textContent ?? document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 80) throw new FetchError('This page has insufficient readable text. Capture the relevant text as a note instead.');
    return { normalizedUrl: normalizeUrl(url), finalUrl: url, title: article?.title || document.title || url, text: text.slice(0, 100_000), contentHash: createHash('sha256').update(text).digest('hex') };
  } finally { dom.window.close(); }
}

export async function fetchSource(input: string, signal?: AbortSignal): Promise<SourceContent> {
  const normalizedUrl = normalizeUrl(input);
  const combined = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
  let current = normalizedUrl;
  try {
    for (let redirect = 0; redirect <= 5; redirect++) {
      combined.throwIfAborted();
      const url = new URL(current);
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = await new Promise<Awaited<ReturnType<typeof lookup>>[]>((resolve, reject) => {
        const abort = () => reject(new FetchError('Source DNS resolution was canceled or timed out.'));
        combined.addEventListener('abort', abort, { once: true });
        lookup(hostname, { all: true }).then(resolve, reject).finally(() => combined.removeEventListener('abort', abort));
        if (combined.aborted) abort();
      });
      combined.throwIfAborted();
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new FetchError('Local and private network URLs are not allowed.');
      const response = await new Promise<{ status: number; location?: string; contentType: string; body: string }>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
          agent: false, signal: combined,
          // Pin the already validated DNS result; redirects repeat validation.
          lookup: (_hostname, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family),
          headers: { 'user-agent': 'Unvar/0.1 (+local research capture)', accept: 'text/html,text/plain', 'accept-encoding': 'identity' },
        }, (result) => {
          if ([301,302,303,307,308].includes(result.statusCode ?? 0)) { result.resume(); resolve({ status: result.statusCode!, location: result.headers.location, contentType: '', body: '' }); return; }
          const chunks: Buffer[] = []; let size = 0;
          result.on('error', reject);
          result.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) result.destroy(new FetchError('Source exceeds the 2 MB fetch limit.')); else chunks.push(chunk); });
          result.on('end', () => resolve({ status: result.statusCode ?? 0, contentType: result.headers['content-type'] ?? '', body: Buffer.concat(chunks).toString('utf8') }));
        });
        request.on('error', reject); request.end();
      });
      if ([301,302,303,307,308].includes(response.status)) {
        if (!response.location || redirect === 5) throw new FetchError('Source redirected too many times.');
        current = normalizeUrl(new URL(response.location, current).href); continue;
      }
      if (response.status < 200 || response.status >= 300) throw new FetchError(`Source returned HTTP ${response.status}.`);
      if (!/^(text\/(html|plain)|application\/xhtml\+xml)(?:\s*;|$)/i.test(response.contentType)) throw new FetchError('Only HTML and plain-text sources are supported.');
      if (/text\/plain/i.test(response.contentType)) {
        const text = response.body.trim();
        if (text.length < 80) throw new FetchError('Source has insufficient readable text.');
        return { normalizedUrl, finalUrl: current, title: current, text: text.slice(0,100000), contentHash: createHash('sha256').update(text).digest('hex') };
      }
      return { ...extractSource(response.body, current), normalizedUrl };
    }
    throw new FetchError('Unable to fetch source.');
  } catch (error) {
    if (signal?.aborted) throw new FetchError('Canceled by user.');
    if (error instanceof FetchError) throw error;
    throw new FetchError('Source could not be fetched within 20 seconds. Check its URL and retry.');
  }
}

/** Proxy-managed DNS: no local DNS preflight. Not a guarantee against domain-to-private-IP resolution. */
export async function fetchProxySource(input: string, signal: AbortSignal | undefined, transport: typeof fetch): Promise<SourceContent> {
  const normalizedUrl = normalizeUrl(input);
  const combined = AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
  let current = normalizedUrl;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      combined.throwIfAborted();
      const url = new URL(current);
      const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !host.includes(':') || ipaddr.isValid(host) && !isPublicAddress(host)) {
        throw new FetchError('Local hostnames and private IP literals are not allowed.');
      }
      const response = await transport(current, { redirect: 'manual', credentials: 'omit', signal: combined,
        headers: { accept: 'text/html,text/plain', 'user-agent': 'Unvar/0.1 (+local research capture)' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || hop === 5) throw new FetchError('Source redirected too many times.');
        current = normalizeUrl(new URL(location, current).href); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new FetchError(`Source returned HTTP ${response.status}.`); }
      const type = response.headers.get('content-type') ?? '';
      if (!/^(text\/(html|plain)|application\/xhtml\+xml)(?:\s*;|$)/i.test(type)) {
        await response.body?.cancel(); throw new FetchError('Only HTML and plain-text sources are supported.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new FetchError('Source returned no readable body.');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          combined.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2_000_000) { await reader.cancel(); throw new FetchError('Source exceeds the 2 MB fetch limit.'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks).toString('utf8');
      if (/^text\/plain/i.test(type)) {
        const text = body.trim();
        if (text.length < 80) throw new FetchError('Source has insufficient readable text.');
        return { normalizedUrl, finalUrl: current, title: current, text: text.slice(0, 100000), contentHash: createHash('sha256').update(text).digest('hex') };
      }
      return { ...extractSource(body, current), normalizedUrl };
    }
    throw new FetchError('Unable to fetch source.');
  } catch (error) {
    if (signal?.aborted) throw new FetchError('Canceled by user.');
    if (error instanceof FetchError) throw error;
    throw new FetchError('Source request failed or timed out. Check the system proxy and retry.');
  }
}
