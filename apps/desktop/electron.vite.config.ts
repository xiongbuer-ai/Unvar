import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

export default defineConfig(({ command }) => {
  const nonce = randomBytes(16).toString('base64');
  const scriptPolicy = command === 'serve' ? `'self' 'nonce-${nonce}'` : "'self'";
  const connectPolicy = command === 'serve' ? "'self' ws://127.0.0.1:*" : "'self'";
  return {
    main: { build: { externalizeDeps: { exclude: ['@unvar/shared', '@unvar/db', '@unvar/llm', '@unvar/workflows', '@unvar/decision'] }, rollupOptions: { external: ['better-sqlite3', 'jsdom'] } } },
    // Bundle workspace code into the sandbox-compatible CommonJS preload.
    preload: { build: { externalizeDeps: false, rollupOptions: { output: { format: 'cjs' } } } },
    renderer: {
      html: command === 'serve' ? { cspNonce: nonce } : {},
      plugins: [react(), {
        name: 'unvar-content-security-policy',
        transformIndexHtml: (html) => html
          .replace('__SCRIPT_POLICY__', scriptPolicy)
          .replace('__CONNECT_POLICY__', connectPolicy),
      }],
      server: { host: '127.0.0.1' },
    },
  };
});
