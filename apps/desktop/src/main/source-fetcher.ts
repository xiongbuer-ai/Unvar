import { net, session } from 'electron';
import { fetchProxySource } from '@unvar/workflows';

// Chromium fetch rejects manual redirects in Electron; net.request exposes the redirect event.
const proxyTransport: typeof fetch = (input, init) => new Promise((resolve, reject) => {
  const request = net.request({ url: String(input), method: 'GET', redirect: 'manual',
    session: session.fromPartition('unvar-source-fetch', { cache: false }), useSessionCookies: false });
  const abort = () => { request.abort(); reject(new Error('Request canceled')); };
  const cleanup = () => init?.signal?.removeEventListener('abort', abort);
  init?.signal?.addEventListener('abort', abort, { once: true });
  if (init?.signal?.aborted) { abort(); cleanup(); return; }
  new Headers(init?.headers).forEach((value, key) => request.setHeader(key, value));
  request.on('redirect', (status, _method, redirectUrl) => {
    cleanup();
    resolve(new Response(null, { status, headers: { location: redirectUrl } }));
    request.abort();
  });
  request.on('response', response => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    // Electron's IncomingMessage is event-based rather than a Node Readable.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let size = 0; let finished = false;
        const fail = () => { if (!finished) { finished = true; cleanup(); controller.error(new Error('Source stream interrupted')); } };
        response.on('data', chunk => {
          if (finished) return;
          size += chunk.length;
          if (size > 2_000_000) { fail(); request.abort(); return; }
          controller.enqueue(chunk);
        });
        response.on('end', () => { if (!finished) { finished = true; cleanup(); controller.close(); } });
        response.on('error', fail); response.on('aborted', fail); request.on('error', fail);
      },
      cancel() { cleanup(); request.abort(); },
    });
    resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : body, { status: response.statusCode, headers }));
  });
  request.on('error', () => { cleanup(); reject(new Error('Source transport failed')); });
  request.end();
});

/** Separate, non-persistent browser network context; no renderer, scripts or application cookies. */
export function fetchDesktopSource(url: string, signal?: AbortSignal) {
  return fetchProxySource(url, signal, proxyTransport);
}
