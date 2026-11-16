import { describe, expect, it } from 'vitest';
import { blocks } from './build.js';
import { labelsFor, check, type TurtleLevel } from './level.js';
import { applyTurtleEvent, createTurtleState, normalizeSegments, polygonSegments, runTurtle, sameDrawing, type Segment } from './turtle.js';

const b = blocks();
const square = (side: number, turn: 'turnLeft' | 'turnRight' = 'turnRight') => b.program([b.repeat(4, b.cmd('forward', side), b.cmd(turn, 90))]);

describe('turtle world', () => {
  it('uses screen axes: starts facing →, turning right (↻) goes down', () => {
    const r = runTurtle({}, b.program([b.cmd('forward', 10), b.cmd('turnRight', 90), b.cmd('forward', 5)]));
    expect(r.final).toMatchObject({ x: 10, y: 5, heading: 90 });
    expect(r.final.segments).toEqual([
      { from: [0, 0], to: [10, 0], color: 'black' },
      { from: [10, 0], to: [10, 5], color: 'black' },
    ]);
  });

  it('draws only with the pen down, in the pen color', () => {
    const r = runTurtle({}, b.program([b.cmd('penUp'), b.cmd('forward', 10), b.cmd('penDown'), b.cmd('penColor', 'red'), b.cmd('back', 5)]));
    expect(r.final.segments).toEqual([{ from: [10, 0], to: [5, 0], color: 'red' }]);
  });

  it('replays events to the same state', () => {
    const r = runTurtle({ x: 3, heading: 45 }, square(7));
    const s = createTurtleState({ x: 3, heading: 45 });
    for (const step of r.steps) for (const e of step.events) applyTurtleEvent(s, e);
    expect(s).toEqual(r.final);
  });

  it('stops at the edge of the drawing area', () => {
    const labels = labelsFor({ id: 't', world: 'turtle', goal: { type: 'shape', target: { segments: [] } }, toolbox: { commands: [] } });
    const r = runTurtle({ x: 350, y: 50, area: { width: 400, height: 400 } }, square(100), { labels });
    expect(r.error!.code).toBe('outOfArea');
    expect(r.error!.message).toBe('¡Me salgo del patio! Me quedo acá.');
    expect(r.final.segments).toEqual([]);
  });
});

describe('comparing drawings', () => {
  const target = polygonSegments(4, 100);

  it('ignores order, direction and how lines were split', () => {
    const drawn: Segment[] = [
      { from: [100, 100], to: [100, 0], color: 'black' },
      { from: [0, 0], to: [50, 0], color: 'black' },
      { from: [50, 0], to: [100, 0], color: 'black' },
      { from: [0, 100], to: [0, 0], color: 'black' },
      { from: [100, 100], to: [0, 100], color: 'black' },
    ];
    expect(normalizeSegments(drawn)).toHaveLength(4);
    expect(sameDrawing(drawn, target, { match: 'exact' })).toBe(true);
  });

  it('exact, translate and rigid matching', () => {
    const moved = runTurtle({ x: 30, y: 40 }, square(100)).final.segments;
    expect(sameDrawing(moved, target, { match: 'exact' })).toBe(false);
    expect(sameDrawing(moved, target, { match: 'translate' })).toBe(true);
    const tilted = runTurtle({ heading: 30 }, square(100, 'turnLeft')).final.segments;
    expect(sameDrawing(tilted, target, { match: 'translate' })).toBe(false);
    expect(sameDrawing(tilted, target)).toBe(true);
    expect(sameDrawing(runTurtle({}, square(90)).final.segments, target)).toBe(false);
  });

  it('a five-pointed star', () => {
    const star = b.program([b.repeat(5, b.cmd('forward', 80), b.cmd('turnRight', 144))]);
    const drawn = runTurtle({ heading: 17 }, star).final.segments;
    expect(sameDrawing(drawn, polygonSegments(5, 80, 2))).toBe(true);
    expect(sameDrawing(drawn, polygonSegments(5, 80, 1))).toBe(false);
  });

  it('colors count only when asked', () => {
    const red = runTurtle({ color: 'red' }, square(100)).final.segments;
    expect(sameDrawing(red, target)).toBe(true);
    expect(sameDrawing(red, target, { colors: true })).toBe(false);
  });
});

describe('turtle levels', () => {
  const level: TurtleLevel = {
    id: 'square',
    world: 'turtle',
    start: { x: 100, y: 100, area: { width: 400, height: 400 } },
    goal: { type: 'shape', target: { polygon: { sides: 4, side: 100, start: [100, 100] } }, match: 'exact', tolerance: 1, returnHome: true },
    toolbox: { commands: ['forward', 'turnRight'], control: ['repeat'] },
  };

  it('a square of 100 that ends where it started', () => {
    expect(check(level, square(100)).passed).toBe(true);
    const r = check(level, b.program([b.repeat(4, b.cmd('forward', 100), b.cmd('turnRight', 90)), b.cmd('turnRight', 90)]));
    expect(r.passed).toBe(true);
    const away = check(level, b.program([...square(100).main, b.cmd('penUp'), b.cmd('forward', 30)]));
    expect(away.passed).toBe(false);
    expect(away.message).toBe('Hay bloques que no se pueden usar acá.');
  });

  it('home is checked separately from the shape', () => {
    const lenient = { ...level, toolbox: { commands: ['forward', 'turnRight', 'penUp'], control: ['repeat' as const] } };
    const r = check(lenient, b.program([...square(100).main, b.cmd('penUp'), b.cmd('forward', 30)]));
    expect(r.cases[0]!.reason).toBe('El dibujo está bien, pero había que terminar donde se empezó.');
  });

  it('any of several targets: squares apart or touching', () => {
    const row = (gap: number) => ({
      segments: [0, 1, 2].flatMap((i) => polygonSegments(4, 50, 1, [i * (50 + gap), 0])),
    });
    const anyRow: TurtleLevel = {
      id: 'row',
      world: 'turtle',
      goal: { type: 'any', goals: [{ type: 'shape', target: row(0), match: 'translate' }, { type: 'shape', target: row(20), match: 'translate' }] },
      toolbox: { commands: ['forward', 'turnRight', 'penUp', 'penDown'], control: ['repeat'], procedures: true },
    };
    const sq = b.proc('sq', [], b.repeat(4, b.cmd('forward', 50), b.cmd('turnRight', 90)));
    const touching = b.program([b.repeat(3, b.call('sq'), b.cmd('penUp'), b.cmd('forward', 50), b.cmd('penDown'))], [sq]);
    const apart = b.program([b.repeat(3, b.call('sq'), b.cmd('penUp'), b.cmd('forward', 70), b.cmd('penDown'))], [sq]);
    const odd = b.program([b.repeat(3, b.call('sq'), b.cmd('penUp'), b.cmd('forward', 60), b.cmd('penDown'))], [sq]);
    expect(check(anyRow, touching).passed).toBe(true);
    expect(check(anyRow, apart).passed).toBe(true);
    expect(check(anyRow, odd).passed).toBe(false);
  });
});
