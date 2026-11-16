/**
 * Drives the editor and the adventure example in a real (headless) browser, with mouse and keyboard.
 *
 * Start the dev server first (`npx vite --port 5192 --strictPort --host 127.0.0.1`), then:
 *   npx tsx tools/test-editor.ts [--url http://127.0.0.1:5192/] [--shots <dir>] [--legacy <old-project.json>]
 *
 * Each run uses fresh browser storage, so the editor starts from the starter project. `--legacy`
 * also opens a project saved in the old Spanish format and plays it.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Project, V3 } from '../src/core/index.js';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5192/' },
    shots: { type: 'string', default: '.' },
    legacy: { type: 'string' },
  },
});
const base = args.url!.endsWith('/') ? args.url! : `${args.url}/`;
const shots = resolve(args.shots!);
mkdirSync(shots, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail: unknown = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

// Shapes of the dev-only hooks the pages expose on `window`.
interface EditorHook {
  c: { project: Project; canUndo: boolean };
  tabs: { voxels: { modelId: string }; animation: { time: number; playing: boolean; model3d: { joints: Map<string, { rotation: { x: number } }> } | null } };
  json(): string;
  countCells(id: string): number;
}
interface AdventureHook {
  scene: { id: string };
  player: { pos: V3; heading: number; clip: string };
  camera: { id: string } | null;
  message: string;
  inventory: string[];
}
type Win = { __editor: EditorHook; __adventure: AdventureHook };

const editor = <T>(p: Page, fn: (e: EditorHook) => T): Promise<T> =>
  p.evaluate(`(${fn.toString()})(window.__editor)`) as Promise<T>;
const adventure = (p: Page): Promise<AdventureHook> =>
  p.evaluate(() => {
    const a = (window as unknown as Win).__adventure;
    return {
      scene: { id: a.scene.id },
      player: { pos: [...a.player.pos] as V3, heading: a.player.heading, clip: a.player.clip },
      camera: a.camera ? { id: a.camera.id } : null,
      message: a.message,
      inventory: [...a.inventory],
    };
  });

const click = (p: Page, name: string) => p.getByRole('button', { name, exact: true }).first().click();
const shot = (p: Page, name: string) => p.screenshot({ path: join(shots, name) });

async function ready(p: Page): Promise<string> {
  await p.waitForFunction(() => document.body.dataset.ready || document.getElementById('error')?.textContent, undefined, { timeout: 90000 });
  return (await p.textContent('#error')) ?? '';
}

function watchErrors(p: Page, errors: string[]): void {
  p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`${p.url()}: ${m.text()}`);
  });
  p.on('dialog', (d) => void d.accept());
}

async function newContext(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1500, height: 860 }, acceptDownloads: true });
  // The native "Save as" dialog cannot be driven headless: force the download fallback.
  await context.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  return context;
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** Steers the player with the keyboard (tank controls) until it stands near `to` (x, z). */
async function walkTo(p: Page, to: [number, number], tolerance = 0.15): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    const s = await adventure(p);
    const dx = to[0] - s.player.pos[0];
    const dz = to[1] - s.player.pos[2];
    const distance = Math.hypot(dx, dz);
    if (distance < tolerance) return true;
    const turn = wrap(Math.atan2(dx, dz) - s.player.heading);
    let key = 'KeyW';
    let seconds = Math.min(distance / 1.5, 0.3);
    if (Math.abs(turn) > 0.1) {
      key = turn > 0 ? 'KeyA' : 'KeyD';
      seconds = Math.min(Math.abs(turn) / 2.5, 0.3);
    }
    await p.keyboard.down(key);
    await p.waitForTimeout(Math.max(20, seconds * 1000));
    await p.keyboard.up(key);
  }
  return false;
}

async function press(p: Page, key: string): Promise<void> {
  await p.keyboard.press(key);
  await p.waitForTimeout(120);
}

const browser = await chromium.launch({ args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const errors: string[] = [];
try {
  const context = await newContext(browser);
  const p = await context.newPage();
  watchErrors(p, errors);
  await p.goto(`${base}editor/`);
  const failed = await ready(p);
  check('the editor opens', !failed, failed);
  const project = await editor(p, (e) => ({ name: e.c.project.name, scenes: e.c.project.scenes.length }));
  check('it starts with the starter project', project.name === 'Starter project' && project.scenes === 2, project);
  await p.waitForTimeout(500);
  await shot(p, 'editor-scene.png');

  // Scene: a camera from the current view, undone and redone.
  const cameras = () => editor(p, (e) => e.c.project.scenes[0]!.cameras.length);
  const before = await cameras();
  await click(p, '+ Camera from view');
  check('adds a camera from the view', (await cameras()) === before + 1, [before, await cameras()]);
  check('the new camera is selected', await p.getByRole('button', { name: 'Look through this camera' }).isVisible());
  await p.keyboard.press('Control+z');
  check('undo removes it', (await cameras()) === before);
  await p.keyboard.press('Control+y');
  check('redo brings it back', (await cameras()) === before + 1);

  // Voxels: paint one voxel with the mouse, undo, redo; then a box.
  await click(p, 'Voxels');
  await p.waitForTimeout(300);
  const modelId = await editor(p, (e) => e.tabs.voxels.modelId);
  const cells = () => p.evaluate((id) => (window as unknown as Win).__editor.countCells(id), modelId);
  const box = (await p.locator('#viewport').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const start = await cells();
  await p.mouse.move(cx, cy);
  await p.mouse.down();
  await p.mouse.up();
  await p.waitForTimeout(150);
  check('a click adds a voxel', (await cells()) === start + 1, [start, await cells()]);
  await p.locator('#viewport').focus();
  await p.keyboard.press('Control+z');
  check('undo removes it', (await cells()) === start, await cells());
  await p.keyboard.press('Control+y');
  const painted = await cells();
  check('redo puts it back', painted === start + 1, painted);
  await p.getByLabel('Box (drag from corner to corner)').check();
  await p.mouse.move(cx - 60, cy + 80);
  await p.mouse.down();
  await p.mouse.move(cx + 40, cy + 120, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  const boxed = await cells();
  check('a box fills an area', boxed > painted + 4, [painted, boxed]);
  await shot(p, 'editor-voxels.png');
  await p.locator('#viewport').focus();
  await p.keyboard.press('Control+z');
  check('undo removes the box', (await cells()) === painted);
  await p.getByLabel('Box (drag from corner to corner)').uncheck();

  // Animation: play the walk clip.
  await click(p, 'Animation');
  await p.waitForTimeout(300);
  await p.getByLabel('Clip', { exact: true }).selectOption('walk');
  await click(p, 'Play clip');
  await p.waitForTimeout(500);
  const anim = await editor(p, (e) => ({
    time: e.tabs.animation.time,
    playing: e.tabs.animation.playing,
    leg: e.tabs.animation.model3d?.joints.get('leg_l')?.rotation.x ?? 0,
  }));
  check('the animation tab plays a clip', anim.playing && anim.time > 0 && Math.abs(anim.leg) > 0.01, anim);
  await shot(p, 'editor-animation.png');
  await click(p, 'Pause clip');

  // Save as… downloads JSON that opens back into the same project.
  await click(p, 'Scene');
  await p.waitForTimeout(200);
  const inMemory = await editor(p, (e) => e.json());
  const [download] = await Promise.all([p.waitForEvent('download'), click(p, 'Save as…')]);
  const file = (await download.path())!;
  const saved = readFileSync(file, 'utf8');
  check('Save as… downloads the project as JSON', saved === inMemory, { name: download.suggestedFilename(), bytes: saved.length });
  const [chooser] = await Promise.all([p.waitForEvent('filechooser'), click(p, 'Open…')]);
  await chooser.setFiles(file);
  await p.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Opened'));
  check('Open… reads it back unchanged', (await editor(p, (e) => e.json())) === saved);

  // The browser storage keeps the work across reloads.
  await p.waitForTimeout(1200);
  await p.reload();
  await ready(p);
  const kept = await p.evaluate((id) => {
    const e = (window as unknown as Win).__editor;
    return { cells: e.countCells(id), cameras: e.c.project.scenes[0]!.cameras.length };
  }, modelId);
  check('reloading keeps the painted voxel and the camera', kept.cells === painted && kept.cameras === before + 1, kept);

  // Play opens the adventure on the same project.
  const [game] = await Promise.all([context.waitForEvent('page'), click(p, 'Play')]);
  watchErrors(game, errors);
  await game.setViewportSize({ width: 1280, height: 720 });
  const gameFailed = await ready(game);
  check('Play opens the adventure', !gameFailed, gameFailed);
  await game.waitForTimeout(400);
  await shot(game, 'adventure-start.png');
  let s = await adventure(game);
  const startPos = s.player.pos;
  const firstCamera = s.camera?.id;
  await game.keyboard.down('KeyW');
  await game.waitForTimeout(400);
  const walking = await adventure(game);
  await game.keyboard.up('KeyW');
  check('W walks forward with the walk clip', walking.player.clip === 'walk' && walking.player.pos[2] > startPos[2] + 0.2, walking.player);
  await game.waitForTimeout(150);
  check('standing still plays idle', (await adventure(game)).player.clip === 'idle');

  check('walks to the note', await walkTo(game, [1.15, 1.3]));
  await press(game, 'KeyE');
  s = await adventure(game);
  check('E reads the note', s.message.startsWith('This room was made by code'), s.message);
  await shot(game, 'adventure-note.png');

  check('walks to the door', (await walkTo(game, [3.5, 1.9])) && (await walkTo(game, [3.9, 3.6])));
  s = await adventure(game);
  check('the camera switches by zone', s.camera?.id !== firstCamera && s.camera?.id === 'cam_back', [firstCamera, s.camera]);
  await press(game, 'KeyE');
  s = await adventure(game);
  check('the door is locked without the key', s.message === 'It is locked. There must be a key somewhere.' && s.scene.id === 'study', s);
  await shot(game, 'adventure-door-locked.png');

  check('walks to the key', (await walkTo(game, [3.5, 1.9])) && (await walkTo(game, [2.0, 1.95])));
  await press(game, 'KeyE');
  s = await adventure(game);
  check('E picks up the key', s.inventory.includes('Small key'), s);
  await shot(game, 'adventure-key.png');

  check('walks back to the door', (await walkTo(game, [3.5, 1.9])) && (await walkTo(game, [3.9, 3.6])));
  await press(game, 'KeyE');
  s = await adventure(game);
  check('the door leads to the closet', s.scene.id === 'closet' && s.camera?.id === 'cam_closet', s);
  await game.waitForTimeout(300);
  await shot(game, 'adventure-closet.png');
  await press(game, 'KeyE');
  s = await adventure(game);
  check('and back to the study', s.scene.id === 'study' && Math.hypot(s.player.pos[0] - 4.1, s.player.pos[2] - 3.6) < 0.05, s);
  await context.close();

  if (args.legacy) {
    // A project in the old Spanish format: opens, renders, and plays with its own clip names.
    const legacy = JSON.parse(readFileSync(resolve(args.legacy), 'utf8')) as { nombre: string; modelos: unknown[] };
    const ctx = await newContext(browser);
    const q = await ctx.newPage();
    watchErrors(q, errors);
    await q.goto(`${base}editor/`);
    await ready(q);
    const [opener] = await Promise.all([q.waitForEvent('filechooser'), click(q, 'Open…')]);
    await opener.setFiles(resolve(args.legacy));
    await q.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Opened'), undefined, { timeout: 60000 });
    const opened = await editor(q, (e) => ({ name: e.c.project.name, models: e.c.project.models.length }));
    check('opens a legacy project', opened.name === legacy.nombre && opened.models === legacy.modelos.length, opened);
    await q.waitForTimeout(600);
    await shot(q, 'editor-legacy-scene.png');
    await click(q, 'Voxels');
    await q.waitForTimeout(600);
    await shot(q, 'editor-legacy-voxels.png');
    await click(q, 'Animation');
    await q.waitForTimeout(400);
    await shot(q, 'editor-legacy-animation.png');
    const [legacyGame] = await Promise.all([ctx.waitForEvent('page'), click(q, 'Play')]);
    watchErrors(legacyGame, errors);
    await legacyGame.setViewportSize({ width: 1280, height: 720 });
    const legacyFailed = await ready(legacyGame);
    check('the adventure plays the legacy project', !legacyFailed, legacyFailed);
    await legacyGame.waitForTimeout(300);
    await legacyGame.keyboard.down('KeyW');
    await legacyGame.waitForTimeout(400);
    const legacyWalk = await adventure(legacyGame);
    await legacyGame.keyboard.up('KeyW');
    check('legacy clips are used by their Spanish names', legacyWalk.player.clip === 'andar', legacyWalk.player);
    await shot(legacyGame, 'adventure-legacy.png');
    await ctx.close();
  }

  check('no errors in the pages', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failures` : '\nAll OK');
process.exit(failures ? 1 : 0);
