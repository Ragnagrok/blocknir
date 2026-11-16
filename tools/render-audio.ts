/**
 * Renders the demo track, every sound effect and a few ambiences to WAV with an
 * OfflineAudioContext in headless Chromium, and measures peak and RMS: it shows whether something
 * clips or came out silent without having to listen to it. Exits with 1 if anything does
 * (peak at or above 0.99, or below -60 dB).
 *
 *   npx tsx tools/render-audio.ts [folder for the WAV files]
 *
 * It starts its own Vite dev server to serve tools/render-audio.browser.ts and the engine sources.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import type { Render } from './render-audio.browser.js';

const [folder] = process.argv.slice(2);
const out = folder ? resolve(folder) : null;
if (out) mkdirSync(out, { recursive: true });

// The audio code has no npm dependencies, so dependency pre-bundling is skipped.
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, optimizeDeps: { noDiscovery: true, entries: [] }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';

// In WSL headless Chromium needs ANGLE on EGL; it doesn't hurt elsewhere.
const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--autoplay-policy=no-user-gesture-required'] });
let results: Render[];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  // Any page on the dev server's origin will do: the module is imported from it.
  await page.route(`${url}__render-audio`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>render</title>' }));
  await page.goto(`${url}__render-audio`);
  results = await page.evaluate((path) => import(path).then((m: { renderAll: () => Promise<Render[]> }) => m.renderAll()), '/tools/render-audio.browser.ts');
} finally {
  await browser.close();
  await server.close();
}

let bad = 0;
const db = (v: number): string => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '-inf');
for (const r of results) {
  if (out) writeFileSync(join(out, `${r.name}.wav`), Buffer.from(r.wav, 'base64'));
  // Below -60 dB it is silent (an error); below -40 dB merely quiet (a warning).
  const problem = r.peak >= 0.99 ? 'CLIPS' : r.peak < 0.001 ? 'SILENT' : r.peak < 0.01 ? 'quiet' : '';
  if (problem && problem !== 'quiet') bad++;
  console.log(`${problem.padEnd(7)}${r.name.padEnd(24)}${r.seconds.toFixed(1).padStart(5)} s   peak ${db(r.peak).padStart(9)}   rms ${db(r.rms).padStart(9)}`);
}
console.log(bad ? `${bad} with problems` : 'All OK', out ? `· WAV files in ${out}` : '');
process.exit(bad ? 1 : 0);
