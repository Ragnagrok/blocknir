/**
 * Demo of `blocks-ui`: the block editor next to a tiny 2D preview. "Ejecutar" checks the program on
 * every case of the level, then plays one case (the first that fails, or the first one) step by
 * step, highlighting the running block, and shows the error bubble if the robot stops.
 */
import { check, runCase, type GridLevel, type GridRun, type GridState, type Level, type RealtimeLevel, type RealtimeRun, type RealtimeState } from '../../src/blocks/index.js';
import { BlockEditor } from '../../src/blocks-ui/index.js';

const BOLO = { blocks: { procedure: 'Enseñar a Bolo: {name}' } };

const levels: Level[] = [
  {
    id: 'demo-faroles',
    world: 'grid',
    title: 'Los cuatro faroles',
    board: {
      width: 5,
      height: 3,
      robot: { x: 0, y: 0, facing: 'E' },
      cells: [
        { x: 1, y: 0, items: { lamp: 1 } },
        { x: 3, y: 0, items: { lamp: 1 } },
        { x: 1, y: 2, items: { lamp: 1 } },
        { x: 3, y: 2, items: { lamp: 1 } },
      ],
    },
    goal: { type: 'noItem', item: 'lamp' },
    toolbox: { commands: ['move', 'lightLamp'], control: ['repeat'], procedures: true, choices: { directions: ['N', 'E', 'S', 'W'] }, par: 8 },
    labels: BOLO,
    meta: { goal: 'Encendé los cuatro faroles. Enseñale a Bolo a recorrer una fila.' },
  } satisfies GridLevel,
  {
    id: 'demo-muelle',
    world: 'grid',
    title: 'Hasta el muelle',
    board: { width: 7, height: 1, robot: { x: 0, y: 0, facing: 'E' }, cells: [{ x: -1, y: 0, items: { flag: 1 } }] },
    variants: [
      { name: 'corto', board: { width: 5, height: 1, robot: { x: 0, y: 0, facing: 'E' }, cells: [{ x: 1, y: 0, items: { lamp: 1 } }, { x: 3, y: 0, items: { lamp: 1 } }, { x: 4, y: 0, items: { flag: 1 } }] } },
      { name: 'largo', board: { width: 8, height: 1, robot: { x: 0, y: 0, facing: 'E' }, cells: [{ x: 2, y: 0, items: { lamp: 1 } }, { x: 3, y: 0, items: { lamp: 1 } }, { x: 6, y: 0, items: { lamp: 1 } }, { x: 7, y: 0, items: { flag: 1 } }] } },
    ],
    goal: { type: 'all', goals: [{ type: 'noItem', item: 'lamp' }, { type: 'robotAt', onItem: 'flag' }] },
    toolbox: {
      commands: [{ name: 'move', args: ['E'], label: 'Mover →' }, 'lightLamp'],
      sensors: [
        { name: 'itemHere', args: ['lamp'], label: '¿Hay farol?' },
        { name: 'itemHere', args: ['flag'], label: '¿Llegué al muelle?' },
      ],
      control: ['repeatUntil', 'if', 'ifElse'],
      operators: ['not'],
      par: 6,
    },
    labels: { ...BOLO, names: { flag: 'muelle' } },
    meta: { goal: 'Prendé todos los faroles y llegá al muelle. ¡Tiene que andar con muelles cortos y largos!' },
  } satisfies GridLevel,
  {
    id: 'demo-vereda',
    world: 'grid',
    title: 'La vereda de colores',
    board: { width: 7, height: 2, robot: { x: 0, y: 0, facing: 'E' }, cells: [] },
    goal: {
      type: 'colors',
      exact: true,
      cells: [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 0, color: x % 2 ? 'blue' : 'red' })),
    },
    toolbox: {
      commands: ['move', 'paint'],
      control: ['repeat'],
      operators: ['+', '*'],
      variables: true,
      choices: { directions: ['N', 'E', 'S', 'W'], names: ['red', 'blue', 'yellow', 'green'] },
      par: 5,
    },
    labels: BOLO,
    meta: { goal: 'Pintá la vereda de arriba: rojo, azul, rojo, azul, rojo, azul.' },
  } satisfies GridLevel,
  {
    id: 'demo-puente',
    world: 'realtime',
    title: 'El puente del cangrejo',
    arena: { width: 7, height: 3, tiles: [0, 1, 2, 3, 4, 5, 6].flatMap((x) => [{ x, y: 0, tile: 'water' }, { x, y: 2, tile: 'water' }]) },
    player: { x: 0, y: 1 },
    actors: [{ kind: 'crab', x: 3, y: 0, facing: 'S' }],
    kinds: {
      crab: {
        script: {
          main: [],
          handlers: [
            {
              id: 'c1',
              event: { type: 'tick' },
              body: [
                {
                  id: 'c2',
                  kind: 'if',
                  condition: { id: 'c3', kind: 'sensor', sensor: 'canMoveForward', args: [] },
                  then: [{ id: 'c4', kind: 'command', command: 'forward', args: [] }],
                  else: [{ id: 'c5', kind: 'command', command: 'turnAround', args: [] }],
                },
              ],
            },
          ],
        },
      },
    },
    keys: ['left', 'right'],
    win: { type: 'reach', edge: 'E' },
    lose: { type: 'touch', kind: 'crab' },
    maxTicks: 40,
    trials: [
      { name: 'cruzar enseguida', hold: ['right'], expect: 'win' },
      { name: 'quedarse quieto', expect: 'timeout' },
    ],
    toolbox: { commands: ['move'], events: ['key'], choices: { keys: ['left', 'right'] } },
    labels: { names: { crab: 'cangrejo' } },
    meta: { goal: 'Cuando aprieten →, Bolo cruza el puente sin que lo toque el cangrejo.' },
  } satisfies RealtimeLevel,
];

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const host = $<HTMLDivElement>('#editor');
const select = $<HTMLSelectElement>('#level');
const runBtn = $<HTMLButtonElement>('#run');
const msg = $<HTMLParagraphElement>('#msg');
const goalText = $<HTMLParagraphElement>('#goal');
const canvas = $<HTMLCanvasElement>('#view');
const ctx = canvas.getContext('2d')!;

let level: Level = levels[0]!;
let editor: BlockEditor;
let running: { stop: boolean } | null = null;
let theme: 'light' | 'dark' | 'auto' = 'auto';

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: progress is not kept */
    }
  },
};

levels.forEach((l, i) => select.append(new Option(`${i + 1}. ${l.title ?? l.id}`, String(i))));

function open(i: number): void {
  stop();
  level = levels[i]!;
  select.value = String(i);
  editor?.destroy();
  editor = new BlockEditor(host, {
    level,
    theme,
    onChange: () => {
      store.set(`rbk-demo:${level.id}`, editor.serialize());
      say('', null);
    },
  });
  const saved = store.get(`rbk-demo:${level.id}`);
  if (saved) editor.deserialize(saved, { history: false });
  goalText.textContent = String(level.meta?.goal ?? '');
  say(String(level.meta?.goal ?? ''), null);
  drawInitial();
}

function say(text: string, state: 'pass' | 'fail' | null): void {
  msg.textContent = text;
  if (state) msg.setAttribute('data-state', state);
  else msg.removeAttribute('data-state');
}

function stop(): void {
  if (running) running.stop = true;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function run(): Promise<void> {
  if (running) {
    stop();
    return;
  }
  const program = editor.getProgram();
  editor.clearMarks();
  const result = check(level, program);
  const failing = result.cases.findIndex((c) => !c.passed);
  const index = failing >= 0 ? failing : 0;
  const shown = runCase(level, program, index, { snapshots: true });
  const token = { stop: false };
  running = token;
  runBtn.setAttribute('aria-pressed', 'true');
  runBtn.textContent = '■ Detener';
  editor.setReadOnly(true);
  say(result.cases.length > 1 ? `Prueba ${index + 1}…` : 'Ejecutando…', null);
  try {
    if (level.world === 'grid') {
      const r = shown.run as GridRun;
      drawGrid(r.initial);
      await sleep(250);
      for (let i = 0; i < r.steps.length && !token.stop; i++) {
        const step = r.steps[i]!;
        editor.highlight(step.node, step.stack);
        drawGrid(r.snapshots?.[i] ?? r.final);
        await sleep(step.events.length ? 420 : 260);
      }
    } else if (level.world === 'realtime') {
      const r = shown.run as RealtimeRun;
      const actors = new Map(r.initial.actors.map((a) => [a.id, { ...a }]));
      drawArena(level, r.initial, actors);
      await sleep(250);
      for (const t of r.ticks) {
        if (token.stop) break;
        const mine = t.steps.filter((s) => s.actor === 'player');
        const last = mine[mine.length - 1];
        editor.highlight(last ? last.node : null, last?.stack ?? []);
        for (const e of t.events) {
          if (e.type === 'moved') {
            const a = actors.get(e.actor);
            if (a) Object.assign(a, { x: e.to[0], y: e.to[1] });
          } else if (e.type === 'spawned') actors.set(e.actor, { id: e.actor, kind: e.kind, x: e.x, y: e.y, facing: e.facing, look: null, vars: {}, said: null, inbox: {} });
          else if (e.type === 'vanished') actors.delete(e.actor);
        }
        drawArena(level, r.initial, actors);
        await sleep(260);
      }
    }
  } finally {
    editor.highlight(null);
    editor.setReadOnly(false);
    running = null;
    runBtn.setAttribute('aria-pressed', 'false');
    runBtn.textContent = '▶ Ejecutar';
  }
  if (token.stop) {
    say('Detenido.', null);
    return;
  }
  if (shown.error) editor.markError(shown.error.nodeId, shown.error.message);
  say(result.message, result.passed ? 'pass' : 'fail');
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

function colors(): Record<string, string> {
  const dark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  return dark
    ? { bg: '#121722', cell: '#1d2433', line: '#2e3a50', wall: '#46516a', water: '#1d4f86', robot: '#f2b134', eye: '#111', text: '#e9ecf1' }
    : { bg: '#e6ecf1', cell: '#ffffff', line: '#c9d2dc', wall: '#5a6474', water: '#7fb3e6', robot: '#e08a00', eye: '#111', text: '#1b1f27' };
}

const PAINT: Record<string, string> = { red: '#d32f2f', blue: '#1e63c6', green: '#2e8b3a', yellow: '#f4c20d', black: '#1b1b1b', white: '#fafafa' };

function layout(w: number, h: number): { size: number; ox: number; oy: number } {
  // The backing store follows the canvas's CSS box; the board is centered in it.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.round(canvas.clientWidth * dpr) || 720;
  const ch = Math.round(canvas.clientHeight * dpr) || 432;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const size = Math.floor(Math.min(canvas.width / w, canvas.height / h));
  return { size, ox: Math.floor((canvas.width - size * w) / 2), oy: Math.floor((canvas.height - size * h) / 2) };
}

function robot(x: number, y: number, size: number, facing: string, c: Record<string, string>): void {
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = size * 0.34;
  ctx.fillStyle = c.robot!;
  ctx.beginPath();
  ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.45);
  ctx.fill();
  const d: Record<string, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const [dx, dy] = d[facing] ?? [1, 0];
  ctx.fillStyle = c.eye!;
  ctx.beginPath();
  ctx.arc(cx + dx * r * 0.5, cy + dy * r * 0.5, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrid(s: GridState): void {
  const c = colors();
  const { size, ox, oy } = layout(s.width, s.height);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      const cell = s.cells[x + y * s.width]!;
      const px = ox + x * size;
      const py = oy + y * size;
      ctx.fillStyle = cell.wall ? (cell.terrain === 'water' ? c.water! : c.wall!) : cell.color ? (PAINT[cell.color] ?? cell.color) : c.cell!;
      ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
      const items = cell.items;
      const m = size / 2;
      if (items.lamp || items.lampOn) {
        ctx.fillStyle = items.lampOn ? '#ffd54a' : '#7d8794';
        if (items.lampOn) {
          ctx.shadowColor = '#ffd54a';
          ctx.shadowBlur = size * 0.4;
        }
        ctx.beginPath();
        ctx.arc(px + m, py + m * 0.8, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#4a5260';
        ctx.fillRect(px + m - size * 0.04, py + m * 0.95, size * 0.08, size * 0.32);
      }
      if (items.flag) {
        ctx.fillStyle = '#4a5260';
        ctx.fillRect(px + size * 0.3, py + size * 0.18, size * 0.05, size * 0.64);
        ctx.fillStyle = '#d32f2f';
        ctx.beginPath();
        ctx.moveTo(px + size * 0.35, py + size * 0.18);
        ctx.lineTo(px + size * 0.75, py + size * 0.3);
        ctx.lineTo(px + size * 0.35, py + size * 0.42);
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = c.line!;
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oy + 0.5, size * s.width - 1, size * s.height - 1);
  robot(ox + s.robot.x * size, oy + s.robot.y * size, size, s.robot.facing, c);
}

function drawArena(l: RealtimeLevel, s: RealtimeState, actors: Map<string, { kind: string; x: number; y: number; facing: string }>): void {
  const c = colors();
  const { size, ox, oy } = layout(l.arena.width, l.arena.height);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const tiles = new Map((l.arena.tiles ?? []).map((t) => [`${t.x},${t.y}`, t.tile]));
  for (let y = 0; y < l.arena.height; y++) {
    for (let x = 0; x < l.arena.width; x++) {
      const t = tiles.get(`${x},${y}`);
      ctx.fillStyle = t === 'water' ? c.water! : c.cell!;
      ctx.fillRect(ox + x * size + 1, oy + y * size + 1, size - 2, size - 2);
    }
  }
  void s;
  for (const a of actors.values()) {
    if (a.kind === 'player') robot(ox + a.x * size, oy + a.y * size, size, a.facing, c);
    else {
      ctx.fillStyle = '#e4572e';
      ctx.beginPath();
      ctx.ellipse(ox + a.x * size + size / 2, oy + a.y * size + size / 2, size * 0.32, size * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawInitial(): void {
  const r = runCase(level, { main: [] }, 0);
  if (level.world === 'grid') drawGrid((r.run as GridRun).initial);
  else if (level.world === 'realtime') {
    const rt = r.run as RealtimeRun;
    drawArena(level, rt.initial, new Map(rt.initial.actors.map((a) => [a.id, a])));
  }
}

select.addEventListener('change', () => open(Number(select.value)));
runBtn.addEventListener('click', () => void run());
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  theme = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  editor.setTheme(theme);
  drawInitial();
});

open(0);

// For tests and curious readers.
(window as unknown as { demo: unknown }).demo = { get editor() { return editor; }, levels, open, run };
