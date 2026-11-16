import { describe, expect, it } from 'vitest';
import type { Program } from './ast.js';
import { blocks } from './build.js';
import { check, labelsFor, type RealtimeLevel } from './level.js';
import { RealtimeGame, runRealtime, type RealtimeEvent, type RealtimeSetup } from './realtime.js';

const b = blocks();
const arena = (width: number, height: number): RealtimeSetup['arena'] => ({ width, height });
const events = (game: RealtimeGame, keys: string[] = []): RealtimeEvent[] => game.step(keys).events;

describe('scheduling', () => {
  it('runs main on the first tick and a key handler when its key is pressed', () => {
    const p = b.program([b.cmd('say', 'hola')], [], [b.on({ type: 'key', key: 'right' }, b.cmd('move', 'E'))]);
    const g = new RealtimeGame({ arena: arena(5, 1), player: { x: 0, y: 0 } }, p);
    expect(events(g)).toEqual([{ type: 'said', actor: 'player', value: 'hola' }]);
    expect(events(g, ['right'])).toEqual([{ type: 'moved', actor: 'player', from: [0, 0], to: [1, 0] }]);
    expect(events(g)).toEqual([]);
  });

  it('every loop round takes a tick, and a busy handler is not started twice', () => {
    const p = b.program([], [], [b.on({ type: 'key', key: 'right' }, b.repeat(3, b.cmd('move', 'E')))]);
    const g = new RealtimeGame({ arena: arena(9, 1), player: { x: 0, y: 0 } }, p);
    for (let i = 0; i < 3; i++) g.step(['right']);
    expect(g.actor('player')!.x).toBe(3);
    // The handler still owns tick 4 (its last round ends there), so that press is ignored.
    g.step(['right']);
    expect(g.actor('player')!.x).toBe(3);
    g.step(['right']);
    expect(g.actor('player')!.x).toBe(4);
  });

  it('waits a number of ticks', () => {
    const p = b.program([b.wait(3), b.cmd('say', 1)]);
    const g = new RealtimeGame({ arena: arena(1, 1), player: { x: 0, y: 0 } }, p);
    const said = [1, 2, 3, 4, 5].map(() => g.step().events.length);
    expect(said).toEqual([0, 0, 0, 1, 0]);
  });

  it('periodic tick handlers', () => {
    const p = b.program([], [], [b.on({ type: 'tick', every: 3 }, b.change('n', 1))]);
    const r = runRealtime({ arena: arena(1, 1), player: { x: 0, y: 0 }, maxTicks: 10 }, p);
    expect(r.final.actors[0]!.vars.n).toBe(3);
    expect(r.status).toBe('timeout');
  });

  it('bumps into walls and edges without failing', () => {
    const p = b.program([b.cmd('move', 'W'), b.cmd('move', 'E')]);
    const r = runRealtime({ arena: { width: 2, height: 1, walls: [[1, 0]] }, player: { x: 0, y: 0 }, maxTicks: 1 }, p);
    expect(r.ticks[0]!.events.map((e) => e.type)).toEqual(['turned', 'bumped', 'turned', 'bumped', 'ended']);
    expect(r.error).toBeNull();
  });

  it('a script that never pauses hits the per-tick step limit', () => {
    const p = b.program([b.call('f')], [b.proc('f', [], b.change('n', 1), b.call('f'))]);
    const r = runRealtime({ arena: arena(1, 1), player: { x: 0, y: 0 } }, p, {}, { stepLimit: 200 });
    expect(r.status).toBe('error');
    expect(r.error!.code).toMatch(/stepLimit|recursionDepth/);
  });
});

describe('actors, touches and signals', () => {
  it('directionTo points down to something below (y grows down)', () => {
    const p = b.program([b.cmd('move', b.sensor('directionTo', 'key'))]);
    const g = new RealtimeGame({ arena: arena(3, 4), player: { x: 1, y: 0 }, actors: [{ kind: 'key', x: 1, y: 3 }] }, p);
    g.step();
    expect(g.actor('player')!.y).toBe(1);
  });

  const patrol = (): Program => {
    const c = blocks('c');
    return c.program([], [], [c.on({ type: 'tick' }, c.ifElse(c.sensor('canMoveForward'), [c.cmd('forward')], [c.cmd('turnAround')]))]);
  };

  it('detects actors crossing each other between cells', () => {
    const setup: RealtimeSetup = {
      arena: arena(4, 1),
      player: { x: 0, y: 0 },
      actors: [{ kind: 'crab', x: 1, y: 0, facing: 'W', id: 'crab' }],
      kinds: { crab: { script: patrol() } },
      lose: { type: 'touch', kind: 'crab' },
    };
    const p = b.program([], [], [b.on({ type: 'key', key: 'right' }, b.cmd('move', 'E'))]);
    const g = new RealtimeGame(setup, p);
    const t = g.step(['right']);
    expect(t.events).toContainEqual({ type: 'touched', a: 'player', b: 'crab' });
    expect(t.status).toBe('lost');
    expect(t.events[t.events.length - 1]).toEqual({ type: 'ended', status: 'lost' });
  });

  it('touch handlers on both sides, and touched() says yes once per contact', () => {
    const k = blocks('k');
    const setup: RealtimeSetup = {
      arena: arena(5, 1),
      player: { x: 0, y: 0 },
      actors: [{ kind: 'flower', x: 2, y: 0 }],
      kinds: { flower: { script: k.program([], [], [k.on({ type: 'touch', what: 'player' }, k.cmd('look', 'open'))]) } },
      variables: { points: 0 },
    };
    const p = b.program([b.until(b.bool(false), b.if(b.sensor('touched', 'flower'), b.change('points', 1)))], [], [b.on({ type: 'key', key: 'right' }, b.cmd('move', 'E'))]);
    const g = new RealtimeGame(setup, p);
    g.step(['right']);
    g.step(['right']);
    for (let i = 0; i < 5; i++) g.step();
    expect(g.state.variables.points).toBe(1);
    expect(g.state.actors.find((a) => a.kind === 'flower')!.look).toBe('open');
  });

  it('touching() is not used up: it says yes on every tick while the cell is shared', () => {
    const setup: RealtimeSetup = { arena: arena(5, 1), player: { x: 0, y: 0 }, actors: [{ kind: 'flower', x: 2, y: 0 }], variables: { points: 0, once: 0 } };
    const p = b.program(
      [b.until(b.bool(false), b.if(b.sensor('touching', 'flower'), b.change('points', 1)), b.if(b.sensor('touched', 'flower'), b.change('once', 1)))],
      [],
      [b.on({ type: 'key', key: 'right' }, b.cmd('move', 'E'))],
    );
    const g = new RealtimeGame(setup, p);
    g.step(['right']);
    g.step(['right']);
    for (let i = 0; i < 4; i++) g.step();
    expect(g.state.variables.points).toBeGreaterThanOrEqual(4);
    expect(g.state.variables.once).toBe(1);
  });

  it('tiles wake touch handlers when an actor steps on them', () => {
    const setup: RealtimeSetup = { arena: { width: 3, height: 1, tiles: [{ x: 2, y: 0, tile: 'water' }] }, player: { x: 0, y: 0 } };
    const p = b.program([], [], [b.on({ type: 'key', key: 'right' }, b.cmd('move', 'E')), b.on({ type: 'touch', what: 'water' }, b.cmd('lose'))]);
    const r = runRealtime(setup, p, { hold: ['right'] });
    expect(r.status).toBe('lost');
    expect(r.ticks.length).toBe(2);
  });

  it('things that fall from a spawner at random columns, the same for the same seed', () => {
    const s = blocks('s');
    const setup: RealtimeSetup = {
      arena: arena(6, 5),
      player: { x: 0, y: 4 },
      actors: [{ kind: 'cloud', x: 0, y: 0, facing: 'S', id: 'cloud' }],
      kinds: {
        cloud: { script: s.program([], [], [s.on({ type: 'tick', every: 2 }, s.cmd('goTo', s.sensor('random', 0, 5), 0), s.cmd('spawn', 'drop'))]) },
        drop: { script: s.program([], [], [s.on({ type: 'tick' }, s.ifElse(s.sensor('atEdge', 'S'), [s.cmd('vanish')], [s.cmd('forward')]))]) },
      },
      maxTicks: 30,
    };
    const empty = b.program([]);
    const one = runRealtime(setup, empty, {}, { seed: 5 });
    const again = runRealtime(setup, empty, {}, { seed: 5 });
    const other = runRealtime(setup, empty, {}, { seed: 6 });
    expect(JSON.stringify(one)).toBe(JSON.stringify(again));
    expect(JSON.stringify(one)).not.toBe(JSON.stringify(other));
    const spawned = one.ticks.flatMap((t) => t.events).filter((e) => e.type === 'spawned');
    expect(spawned.length).toBe(15);
    expect(new Set(spawned.map((e) => (e.type === 'spawned' ? e.x : -1))).size).toBeGreaterThan(2);
    expect(one.ticks.flatMap((t) => t.events).some((e) => e.type === 'vanished')).toBe(true);
  });
});

describe('book-style games: a main loop that reads buttons', () => {
  const gull = (): Program => {
    const g = blocks('g');
    return g.program([], [], [g.on({ type: 'tick', every: 2 }, g.ifElse(g.sensor('canMoveForward'), [g.cmd('forward')], [g.cmd('turnAround')]))]);
  };
  const bridge: RealtimeLevel = {
    id: 'bridge',
    world: 'realtime',
    arena: { width: 8, height: 3, tiles: [{ x: 7, y: 1, tile: 'exit' }] },
    player: { x: 0, y: 1 },
    actors: [{ kind: 'gull', x: 4, y: 0, facing: 'S' }],
    kinds: { gull: { script: gull() } },
    keys: ['up', 'down', 'left', 'right', 'action'],
    win: { type: 'reach', tile: 'exit' },
    endWhenMainEnds: true,
    maxTicks: 60,
    trials: [
      { name: 'cross', hold: ['right'], expect: 'win' },
      { name: 'wait and walk into the gull', inputs: [[], [], [], [], ...Array.from({ length: 8 }, () => ['right'])], expect: 'lose' },
    ],
    toolbox: {
      commands: ['move', 'say'],
      sensors: [{ name: 'keyPressed', args: ['right'], label: '¿Botón → apretado?' }, { name: 'tileHere', args: ['exit'], label: '¿Llegué a la salida?' }, { name: 'touched', args: ['gull'], label: '¿Me tocó una gaviota?' }],
      control: ['repeatUntil', 'if', 'ifElse'],
      operators: ['or'],
      events: ['start'],
    },
  };
  const program = b.program([
    b.until(b.or(b.sensor('tileHere', 'exit'), b.sensor('touched', 'gull')), b.if(b.sensor('keyPressed', 'right'), b.cmd('move', 'E'))),
    b.ifElse(b.sensor('tileHere', 'exit'), [b.cmd('say', '¡Gané!')], [b.cmd('say', '¡Uy, me picotearon!')]),
  ]);

  it('wins by holding →, loses walking into the gull, and says so after the loop', () => {
    const r = check(bridge, program);
    expect(r.issues).toEqual([]);
    expect(r.cases.map((c) => c.passed)).toEqual([true, true]);
    const said = r.cases.map((c) => ('ticks' in c.run ? c.run.final.actors.find((a) => a.id === 'player')!.said : null));
    expect(said).toEqual(['¡Gané!', '¡Uy, me picotearon!']);
  });

  it('a stuck program times out and the trial says why', () => {
    const r = check(bridge, b.program([b.until(b.sensor('tileHere', 'exit'))]));
    expect(r.cases[0]!.passed).toBe(false);
    expect(r.cases[0]!.reason).toBe('había que ganar, pero se terminó el tiempo.');
  });

  it('lighthouse defense: shots, clouds, points and lives with once-per-event signals', () => {
    const k = blocks('k');
    const level: RealtimeLevel = {
      id: 'defense',
      world: 'realtime',
      arena: arena(9, 8),
      player: { x: 4, y: 7, facing: 'N' },
      actors: [{ kind: 'nest', x: 4, y: 0, facing: 'S', id: 'nest' }],
      kinds: {
        nest: { script: k.program([], [], [k.on({ type: 'tick', every: 4 }, k.cmd('spawn', 'cloud'))]) },
        cloud: {
          script: k.program([], [], [
            k.on({ type: 'tick', every: 2 }, k.ifElse(k.sensor('atEdge', 'S'), [k.cmd('signal', 'cloudArrived'), k.cmd('vanish')], [k.cmd('forward')])),
            k.on({ type: 'touch', what: 'light' }, k.cmd('vanish')),
          ]),
        },
        light: {
          script: k.program([], [], [
            k.on({ type: 'tick' }, k.ifElse(k.sensor('atEdge', 'N'), [k.cmd('vanish')], [k.cmd('forward')])),
            k.on({ type: 'touch', what: 'cloud' }, k.cmd('signal', 'hit'), k.cmd('vanish')),
          ]),
        },
      },
      variables: { points: 0, lives: 3 },
      keys: ['left', 'right', 'action'],
      win: { type: 'var', name: 'points', op: '>=', value: 3 },
      endWhenMainEnds: true,
      maxTicks: 300,
      trials: [
        { name: 'shoot all the time', hold: ['action'], expect: 'win' },
        { name: 'do nothing', expect: 'lose' },
      ],
      toolbox: { commands: ['spawn', 'say'], sensors: ['keyPressed', 'received'], control: ['repeatUntil', 'if', 'ifElse'], operators: ['or', '='], variables: true, events: ['start'] },
    };
    const p = b.program([
      b.set('points', 0),
      b.set('lives', 3),
      b.until(
        b.or(b.cmp('=', b.v('points'), 3), b.cmp('=', b.v('lives'), 0)),
        b.if(b.sensor('keyPressed', 'action'), b.cmd('spawn', 'light')),
        b.if(b.sensor('received', 'hit'), b.change('points', 1)),
        b.if(b.sensor('received', 'cloudArrived'), b.subtract('lives', 1)),
      ),
      b.ifElse(b.cmp('=', b.v('points'), 3), [b.cmd('say', '¡Gané!')], [b.cmd('say', 'Perdí')]),
    ]);
    const r = check(level, p);
    expect(r.cases.map((c) => [c.passed, c.reason])).toEqual([
      [true, null],
      [true, null],
    ]);
    const lose = r.cases[1]!.run;
    expect('ticks' in lose && lose.final.variables).toEqual({ points: 0, lives: 0 });
  });

  it('uses the book vocabulary for blocks', () => {
    const labels = labelsFor(bridge);
    expect(labels.blocks.keyPressed).toBe('¿Botón {0} apretado?');
    expect(labels.blocks.main).toBe('Al tocar Ejecutar');
    expect(labels.blocks.or).toBe('{0} o {1}');
    expect(labels.blocks.set).toBe('Fijar {var} en {0}');
    expect(labels.blocks.subtract).toBe('Restar {0} a {var}');
  });
});
