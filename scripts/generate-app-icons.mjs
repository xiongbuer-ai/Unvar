import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

// Rasterize the shared vector with transparent macOS icon margins.
// Set UNVAR_CHROMIUM_PATH when using an existing local Chromium installation.
const source = await readFile(new URL('../apps/desktop/src/renderer/src/assets/unvar.svg', import.meta.url), 'utf8');
const output = new URL('../apps/desktop/src/main/assets/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.UNVAR_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{position:absolute;left:10%;top:10%;width:80%;height:80%}</style>${source}`);
  const chunks = [];
  for (const [size, kind] of [[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']]) {
    await page.setViewportSize({ width: size, height: size });
    const png = await page.screenshot({ omitBackground: true });
    if (size === 1024) await writeFile(new URL('app-icon.png', output), png);
    const header = Buffer.alloc(8); header.write(kind); header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const body = Buffer.concat(chunks); const header = Buffer.alloc(8);
  header.write('icns'); header.writeUInt32BE(body.length + 8, 4);
  await writeFile(new URL('app-icon.icns', output), Buffer.concat([header, body]));
  console.log(`Generated native icons in ${fileURLToPath(output)}`);
} finally { await browser.close(); }
