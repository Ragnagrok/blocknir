/**
 * The block worlds in 3D: a few sample levels with fixed programs, played with `BoardView`.
 * Grid lamps, a grid with an error, a "scene" level made of custom actions, a turtle polygon and a
 * realtime dodge game (arrow keys or the on-screen buttons).
 */
import {
  blocks,
  boardFromRows,
  check,
  createTurtleState,
  describeValue,
  labelsFor,
  RealtimeGame,
  runCase,
  type GridLevel,
  type Labels,
  type Level,
  type Program,
  type RealtimeLevel,
  type Statement,
  type TraceStep,
  type TurtleLevel,
} from '../../src/blocks/index.js';
import { BoardView, presentation, type Speed } from '../../src/blocks-3d/index.js';

const b = blocks();

// ---------------------------------------------------------------------------------------------
// Levels and their programs
// ---------------------------------------------------------------------------------------------

const lamps: GridLevel = {
  id: 'faroles',
  world: 'grid',
  title: 'Faroles hasta la bandera',
  board: boardFromRows(
    [
      'ff~~~ff', //
      'R=L=L=F',
      'gg~a~gs',
      'ggsscgs',
    ],
    {
      f: { terrain: 'flowers' },
      '~': { terrain: 'water', wall: true },
      R: { terrain: 'start', robot: 'E' },
      '=': { terrain: 'path' },
      L: { terrain: 'path', items: { lamp: 1 } },
      F: { terrain: 'goal', items: { flag: 1 } },
      g: { terrain: 'grass' },
      a: { terrain: 'grass', items: { apple: 3 } },
      s: { terrain: 'sand', items: {} },
      c: { terrain: 'sand', items: { star: 2, shell: 1 }, color: 'pink' },
    },
    { walls: [{ x: 5, y: 1, side: 'S' }] },
  ),
  goal: { type: 'all', goals: [{ type: 'noItem', item: 'lamp' }, { type: 'robotAt', onItem: 'flag' }] },
  toolbox: { commands: [{ name: 'move', args: ['E'], label: 'Mover →' }, 'lightLamp', 'say'], sensors: [{ name: 'itemHere', args: ['lamp'], label: '¿Hay farol?' }], control: ['repeat', 'if'] },
};
const lampsProgram = b.program([b.repeat(6, b.cmd('move', 'E'), b.if(b.sensor('itemHere', 'lamp'), b.cmd('lightLamp'))), b.cmd('say', '¡Llegué!')]);

const apples: GridLevel = {
  id: 'manzanas',
  world: 'grid',
  title: 'Manzanas (con un error)',
  board: boardFromRows(['A.b..', '.~~..', 'R..A~'], {
    A: { items: { apple: 2 } },
    b: { items: { banana: 1, orange: 1 } },
    '~': { terrain: 'water', wall: true },
    R: { robot: 'N', terrain: 'start' },
    '.': {},
  }),
  goal: { type: 'inventory', items: { apple: 4 } },
  toolbox: { commands: ['move', 'pick', 'paint', 'forward', 'turnRight'], control: ['repeat'] },
};
const applesProgram = b.program([
  b.repeat(2, b.cmd('forward')),
  b.cmd('pick', 'apple'),
  b.cmd('pick', 'apple'),
  b.cmd('turnRight'),
  b.cmd('forward'),
  b.cmd('paint', 'yellow'),
  b.cmd('move', 'E'),
  b.cmd('pick', 'banana'),
  b.cmd('move', 'E'),
  b.cmd('move', 'S'),
  b.cmd('move', 'S'),
  b.cmd('pick', 'apple'),
  b.cmd('move', 'E'),
]);

const scene: GridLevel = {
  id: 'escena',
  world: 'grid',
  title: 'Un día en la playa',
  board: boardFromRows(['RCHB'], {
    R: { robot: 'E', terrain: 'path' },
    C: { terrain: 'wood', items: { pcOff: 1 } },
    H: { terrain: 'grass', items: { hammock: 1 } },
    B: { terrain: 'sand', items: { boat: 1 } },
  }),
  actions: [
    { name: 'goPc', label: 'Ir a la compu', goTo: { x: 1 } },
    { name: 'turnOnPc', label: 'Prender compu', consumeHere: { pcOff: 1 }, addHere: { pcOn: 1 }, failMessage: 'Acá no hay una compu apagada.' },
    { name: 'writeA', label: 'Escribir A', requireHere: { pcOn: 1 }, addHere: { textA: 1 } },
    { name: 'goHammock', label: 'Ir a la hamaca', goTo: { x: 2 } },
    { name: 'lieDown', label: 'Acostarse', requireHere: { hammock: 1 }, forbidInventory: ['lying'], addInventory: { lying: 1 }, say: '¡Qué lindo día!' },
  ],
  goal: { type: 'inventory', items: { lying: 1 } },
  toolbox: { commands: ['goPc', 'turnOnPc', 'writeA', 'goHammock', 'lieDown'] },
  meta: { view: 'scene', places: { '1,0': 'compu', '2,0': 'hamaca', '3,0': 'bote' } },
  labels: { names: { pcOff: 'compu', pcOn: 'compu', textA: 'A' } },
};
const sceneProgram = b.program([b.cmd('goPc'), b.cmd('turnOnPc'), b.cmd('writeA'), b.cmd('goHammock'), b.cmd('lieDown')]);

const polygon: TurtleLevel = {
  id: 'pentagono',
  world: 'turtle',
  title: 'Un pentágono',
  start: { x: 0, y: 0, heading: 0, color: 'blue' },
  goal: { type: 'shape', target: { polygon: { sides: 5, side: 100 } } },
  toolbox: { commands: ['forward', 'turnRight', 'penColor', 'penUp', 'penDown'], control: ['repeat'] },
};
const polygonProgram = b.program([
  b.repeat(5, b.cmd('forward', 100), b.cmd('turnRight', 72)),
  b.cmd('penUp'),
  b.cmd('turnRight', 54),
  b.cmd('forward', 40),
  b.cmd('penDown'),
  b.cmd('penColor', 'red'),
  b.repeat(5, b.cmd('forward', 30), b.cmd('turnRight', 144)),
]);

const k = blocks('k');
const dodge: RealtimeLevel = {
  id: 'cocos',
  world: 'realtime',
  title: 'Esquivá los cocos',
  arena: {
    width: 7,
    height: 6,
    tiles: [0, 1, 2, 3, 4, 5, 6].flatMap((x) => [{ x, y: 5, tile: 'sand' }, { x, y: 0, tile: 'water' }]),
  },
  player: { x: 3, y: 5, facing: 'N' },
  actors: [{ kind: 'cloud', x: 3, y: 0, facing: 'S', id: 'cloud' }],
  kinds: {
    cloud: { script: k.program([], [], [k.on({ type: 'tick', every: 3 }, k.cmd('goTo', k.sensor('random', 0, 6), 0), k.cmd('spawn', 'coconut'))]) },
    coconut: {
      script: k.program([], [], [
        k.on({ type: 'tick' }, k.ifElse(k.sensor('atEdge', 'S'), [k.cmd('signal', 'dodged'), k.cmd('vanish')], [k.cmd('forward')])),
        k.on({ type: 'touch', what: 'player' }, k.cmd('vanish')),
      ]),
    },
  },
  variables: { points: 0, lives: 3 },
  keys: ['left', 'right'],
  win: { type: 'var', name: 'points', op: '>=', value: 12 },
  lose: { type: 'var', name: 'lives', op: '<=', value: 0 },
  maxTicks: 600,
  toolbox: { commands: ['move', 'say'], sensors: ['received'], control: ['repeatUntil', 'if'], variables: true, events: ['key', 'touch', 'start'] },
};
const dodgeProgram: Program = b.program(
  [b.until(b.bool(false), b.if(b.sensor('received', 'dodged'), b.change('points', 1)))],
  [],
  [
    b.on({ type: 'key', key: 'left' }, b.cmd('move', 'W')),
    b.on({ type: 'key', key: 'right' }, b.cmd('move', 'E')),
    b.on({ type: 'touch', what: 'coconut' }, b.subtract('lives', 1), b.cmd('say', '¡Ay!')),
  ],
);

interface Sample {
  name: string;
  level: Level;
  program: Program;
}
const SAMPLES: Sample[] = [
  { name: 'Faroles', level: lamps, program: lampsProgram },
  { name: 'Manzanas', level: apples, program: applesProgram },
  { name: 'Escena', level: scene, program: sceneProgram },
  { name: 'Tortuga', level: polygon, program: polygonProgram },
  { name: 'Cocos', level: dodge, program: dodgeProgram },
];

// ---------------------------------------------------------------------------------------------
// The program listing (a stand-in for the block editor: it shows which block runs)
// ---------------------------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const listing = $('program');

function listProgram(level: Level, p: Program): void {
  const labels = labelsFor(level);
  const lines: string[] = [];
  const text = (s: Statement): string => {
    const fill = (template: string, args: unknown[]): string => template.replace(/\{(\d+)\}/g, (_, i: string) => argText(args[Number(i)], labels));
    switch (s.kind) {
      case 'command':
        return fill(labels.blocks[s.command] ?? s.command, s.args);
      case 'repeat':
        return fill(labels.blocks.repeat ?? 'Repetir {0} veces', [s.times]);
      case 'repeatUntil':
        return fill(labels.blocks.repeatUntil ?? 'Repetir hasta que {0}', [s.until]);
      case 'if':
        return fill(labels.blocks[s.else ? 'ifElse' : 'if'] ?? 'Si {0}', [s.condition]);
      case 'change':
        return `${s.op === '-' ? 'Restar' : 'Sumar'} ${argText(s.by, labels)} a ${s.variable}`;
      default:
        return s.kind;
    }
  };
  const walk = (list: Statement[], depth: number): void => {
    for (const s of list) {
      lines.push(`<div data-id="${s.id}">${'  '.repeat(depth)}${escape(text(s))}</div>`);
      if (s.kind === 'repeat' || s.kind === 'repeatUntil') walk(s.body, depth + 1);
      if (s.kind === 'if') {
        walk(s.then, depth + 1);
        if (s.else) walk(s.else, depth + 1);
      }
    }
  };
  lines.push(`<div>${escape(labels.blocks.main ?? 'Al tocar Ejecutar')}</div>`);
  walk(p.main, 1);
  for (const h of p.handlers ?? []) {
    const e = h.event;
    const head = e.type === 'key' ? `Al apretar ${e.key}` : e.type === 'touch' ? `Al tocar ${e.what}` : e.type === 'tick' ? 'En cada tic' : 'Al empezar';
    lines.push(`<div data-id="${h.id}">${escape(head)}</div>`);
    walk(h.body, 1);
  }
  listing.innerHTML = lines.join('');
}

function argText(e: unknown, labels: Labels): string {
  const x = e as { kind?: string; value?: unknown; sensor?: string; args?: unknown[]; name?: string };
  if (!x || typeof x !== 'object') return '?';
  if (x.kind === 'number' || x.kind === 'boolean' || x.kind === 'direction' || x.kind === 'name') return describeValue(x.value as string, labels);
  if (x.kind === 'sensor') return (labels.blocks[x.sensor!] ?? x.sensor!).replace(/\{(\d+)\}/g, (_, i: string) => argText(x.args?.[Number(i)], labels));
  if (x.kind === 'var') return x.name ?? '?';
  return '…';
}

const escape = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

let lit: HTMLElement | null = null;
function highlight(id: string | null): void {
  lit?.classList.remove('on');
  lit = id ? listing.querySelector<HTMLElement>(`[data-id="${id}"]`) : null;
  lit?.classList.add('on');
}

// ---------------------------------------------------------------------------------------------
// The view and the controls
// ---------------------------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
const status = $('status');
const view = new BoardView($('view') as HTMLCanvasElement, {
  preserveDrawingBuffer: params.has('test'),
  onStep: (s: TraceStep<unknown>) => {
    if (!s.actor || s.actor === 'player') highlight(s.node);
  },
  onDone: ({ error, status: st }) => {
    if (st) status.textContent = st === 'won' ? '¡Ganaste!' : st === 'lost' ? 'Perdiste' : st;
    else if (error) status.textContent = 'Se detuvo';
    else {
      const sample = SAMPLES[current]!;
      const ok = sample.level.world !== 'realtime' && check(sample.level, sample.program).passed;
      status.textContent = ok ? '¡Funciona!' : 'Terminó';
      if (ok) view.celebrate();
    }
  },
  onTick: (hud) => {
    $('score').textContent = `Puntos ${hud.score ?? 0}`;
    $('lives').textContent = `Vidas ${hud.lives ?? 0}`;
  },
});

const SPEEDS: Speed[] = [0.5, 1, 2, 4, 'instant'];
const speedInput = $('speed') as HTMLInputElement;
const showSpeed = (): void => {
  const s = SPEEDS[Number(speedInput.value)]!;
  view.speed = s;
  $('speedText').textContent = s === 'instant' ? 'al toque' : `×${s}`;
};
speedInput.addEventListener('input', showSpeed);
showSpeed();

let current = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const held = new Set<string>();

function select(i: number): void {
  current = i;
  stopGame();
  const s = SAMPLES[i]!;
  document.querySelectorAll<HTMLButtonElement>('#levels button').forEach((btn, j) => btn.setAttribute('aria-pressed', String(i === j)));
  listProgram(s.level, s.program);
  highlight(null);
  status.textContent = '';
  const realtime = s.level.world === 'realtime';
  $('hud').style.display = realtime ? 'flex' : 'none';
  $('pad').style.display = realtime ? 'flex' : 'none';
  $('step').style.display = realtime ? 'none' : '';
  if (realtime) {
    const game = new RealtimeGame(s.level as RealtimeLevel, s.program, { labels: labelsFor(s.level) });
    view.reset(game, presentation(s.level));
    $('score').textContent = 'Puntos 0';
    $('lives').textContent = `Vidas ${game.state.variables.lives}`;
  } else if (s.level.world === 'turtle') {
    view.reset(createTurtleState((s.level as TurtleLevel).start), presentation(s.level));
  } else {
    view.reset(runCase(s.level, s.program, 0).run.initial as never, presentation(s.level));
  }
}

function stopGame(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Runs the selected sample: a trace for step worlds, a live game at 6 ticks a second for realtime. */
function run(): Promise<void> {
  const s = SAMPLES[current]!;
  status.textContent = '';
  if (s.level.world === 'realtime') {
    select(current);
    timer = setInterval(() => {
      const r = view.step([...held]);
      if (!r || r.status !== 'running') stopGame();
    }, 1000 / 6);
    return Promise.resolve();
  }
  const result = runCase(s.level, s.program, 0);
  return view.play(result.run);
}

const levels = $('levels');
SAMPLES.forEach((s, i) => {
  const btn = document.createElement('button');
  btn.textContent = s.name;
  btn.addEventListener('click', () => select(i));
  levels.append(btn);
});
$('run').addEventListener('click', () => void run());
$('step').addEventListener('click', () => {
  const s = SAMPLES[current]!;
  if (view.index < 0 && !view.playing) {
    view.load(runCase(s.level, s.program, 0).run);
  }
  view.step();
});
$('pause').addEventListener('click', () => {
  if (timer) stopGame();
  else view.pause();
});
$('reset').addEventListener('click', () => select(current));

const KEYS: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', a: 'left', d: 'right' };
addEventListener('keydown', (e) => {
  const key = KEYS[e.key];
  if (key) {
    held.add(key);
    e.preventDefault();
  }
});
addEventListener('keyup', (e) => {
  const key = KEYS[e.key];
  if (key) held.delete(key);
});
document.querySelectorAll<HTMLButtonElement>('#pad button').forEach((btn) => {
  const key = btn.dataset.key!;
  btn.addEventListener('pointerdown', (e) => {
    held.add(key);
    btn.setPointerCapture(e.pointerId);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, () => held.delete(key));
});

select(Math.max(0, SAMPLES.findIndex((s) => s.level.id === params.get('level'))));

// Test hooks (Playwright): pick a sample, run it, hold keys.
Object.assign(window, {
  __board: {
    view,
    samples: SAMPLES.map((s) => s.level.id),
    select: (id: string) => select(Math.max(0, SAMPLES.findIndex((s) => s.level.id === id))),
    run,
    hold: (keys: string[]) => {
      held.clear();
      for (const k2 of keys) held.add(k2);
    },
    stop: stopGame,
  },
});
