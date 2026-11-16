/**
 * Screenshots of the board example in a real (headless) browser, mid-animation and at the end of
 * each sample, on a laptop and a phone viewport, plus an FPS measure of the realtime sample with a
 * 4× CPU throttle.
 *
 * Start the dev server first (`npx vite --port 5196 --strictPort --host 127.0.0.1`), then:
 *   npx tsx examples/board/shots.ts [--url http://127.0.0.1:5196/] [--shots <dir>] [--only <level id>]
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5196/' },
    shots: { type: 'string', default: '.' },
    only: { type: 'string' },
    fps: { type: 'boolean', default: true },
  },
});
const base = args.url!.endsWith('/') ? args.url! : `${args.url}/`;
const shots = resolve(args.shots!);
mkdirSync(shots, { recursive: true });

interface Hook {
  samples: string[];
  select(id: string): void;
  run(): Promise<void>;
  hold(keys: string[]): void;
  stop(): void;
  view: { speed: number | 'instant'; playing: boolean; index: number; hud: unknown; world: string | null; inventory: Record<string, number> };
}
const hook = <T>(p: Page, fn: string): Promise<T> => p.evaluate(`(async () => { const b = window.__board; ${fn} })()`) as Promise<T>;

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
];

async function shootSample(page: Page, vp: string, id: string): Promise<void> {
  await hook(page, `b.select(${JSON.stringify(id)});`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `${vp}-${id}-0-start.png`) });
  if (id === 'cocos') {
    await hook(page, `b.hold(['left']); b.run();`);
    await page.waitForTimeout(1300);
    await hook(page, `b.hold(['right']);`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(shots, `${vp}-${id}-1-mid.png`) });
    await hook(page, `b.hold([]);`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: join(shots, `${vp}-${id}-2-later.png`) });
    const hud = await hook<unknown>(page, 'return b.view.hud;');
    console.log(vp, id, 'hud', JSON.stringify(hud));
    await hook(page, 'b.stop();');
    return;
  }
  await hook(page, `b.view.speed = 2; b.run();`);
  await page.waitForTimeout(id === 'pentagono' ? 2200 : 1500);
  await page.screenshot({ path: join(shots, `${vp}-${id}-1-mid.png`) });
  await page.waitForFunction(() => !(window as unknown as { __board: Hook }).__board.view.playing, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(shots, `${vp}-${id}-2-end.png`) });
  console.log(vp, id, 'end', await page.locator('#status').textContent(), JSON.stringify(await hook(page, 'return b.view.inventory;')));
}

async function measureFps(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}examples/board/?level=cocos`);
  await page.waitForFunction(() => !!(window as unknown as { __board?: Hook }).__board);
  const cdp = await page.context().newCDPSession(page);
  for (const [label, rate] of [
    ['no throttle', 1],
    ['4x CPU throttle', 4],
  ] as const) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await hook(page, `b.select('cocos'); b.hold(['left']); b.run();`);
    await page.waitForTimeout(800);
    // A string, so the bundler's helpers (`__name`) do not leak into the page.
    const r = (await page.evaluate(`new Promise((done) => {
      const v = window.__board.view;
      const render = v.frame.bind(v);
      let busy = 0, frames = 0;
      v.frame = (s) => { const a = performance.now(); render(s); busy += performance.now() - a; frames++; };
      v.view.renderer.setAnimationLoop((ms) => v.frame(ms / 1000));
      const times = [];
      const t0 = performance.now();
      const loop = (t) => {
        times.push(t);
        if (t - t0 < 4000) requestAnimationFrame(loop);
        else {
          const gaps = times.slice(1).map((x, i) => x - times[i]);
          done({ fps: (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000), worst: Math.max(...gaps), cpu: busy / frames });
        }
      };
      requestAnimationFrame(loop);
    })`)) as { fps: number; worst: number; cpu: number };
    console.log(`fps realtime ${label}: ${r.fps.toFixed(1)} (worst frame ${r.worst.toFixed(1)} ms, main-thread time per frame ${r.cpu.toFixed(2)} ms)`);
    await hook(page, 'b.stop();');
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.close();
}

const browser = await chromium.launch({ args: ['--use-angle=gl-egl'] });
try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, deviceScaleFactor: vp.touch ? 3 : 1 });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    await page.goto(`${base}examples/board/?test`);
    await page.waitForFunction(() => !!(window as unknown as { __board?: Hook }).__board);
    const ids = await hook<string[]>(page, 'return b.samples;');
    for (const id of ids) if (!args.only || args.only === id) await shootSample(page, vp.name, id);
    if (errors.length) console.log(vp.name, 'console:', errors.slice(0, 10));
    await ctx.close();
  }
  if (args.fps && (!args.only || args.only === 'fps')) await measureFps(browser);
} finally {
  await browser.close();
}
console.log('shots in', shots);
