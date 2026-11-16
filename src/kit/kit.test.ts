import { describe, expect, it } from 'vitest';
import type { Project } from '../core/index.js';
import { createHumanoid } from '../paint/index.js';
import { Actor } from './actor.js';
import { Dialogue, type DialogueElements } from './dialogue.js';
import { Director } from './director.js';
import { stickVector } from './joystick.js';
import { SaveSlot } from './save.js';

/** Just enough of an element for the dialogue box and the director. */
function fakeElement(): HTMLElement {
  const classes = new Set<string>();
  const classList = {
    add: (...c: string[]) => c.forEach((x) => classes.add(x)),
    remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
    toggle: (c: string, on?: boolean) => {
      const want = on ?? !classes.has(c);
      if (want) classes.add(c);
      else classes.delete(c);
      return want;
    },
    contains: (c: string) => classes.has(c),
  };
  return { classList, textContent: '', style: {} } as unknown as HTMLElement;
}

function dialogueBox(): DialogueElements {
  return { box: fakeElement(), speaker: fakeElement(), text: fakeElement() };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('stickVector', () => {
  it('reads zero inside the dead zone and full at the edge', () => {
    expect(stickVector(5, 0, 52, 0.15)).toMatchObject({ x: 0, y: 0 });
    expect(stickVector(0, 0, 52, 0.15)).toMatchObject({ x: 0, y: 0 });
    const v = stickVector(52, 0, 52, 0.15);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('clamps the knob to the radius and keeps the direction', () => {
    const v = stickVector(300, 400, 50, 0.1);
    expect(Math.hypot(v.knobX, v.knobY)).toBeCloseTo(50);
    expect(v.x).toBeCloseTo(0.6);
    expect(v.y).toBeCloseTo(0.8);
  });

  it('rescales past the dead zone', () => {
    const v = stickVector(0, -26, 52, 0);
    expect(v.y).toBeCloseTo(-0.5);
    expect(stickVector(0, 26, 52, 0.5).y).toBeCloseTo(0);
  });
});

describe('Dialogue', () => {
  it('keeps a game line type and lets present() decide label and style', () => {
    interface MyLine { text: string; who: 'narrator' | 'npc'; name?: string }
    const el = dialogueBox();
    const d = new Dialogue<MyLine>(el, {
      present: (l) => (l.who === 'narrator' ? { speaker: 'Narrator', style: 'narration' } : { speaker: l.name ?? '' }),
    });
    const seen: MyLine['who'][] = [];
    d.onLine = (l) => seen.push(l.who);
    d.say([{ text: 'Once.', who: 'narrator' }, { text: 'Hi.', who: 'npc', name: 'Bo' }]);
    expect(el.speaker.textContent).toBe('Narrator');
    expect(el.box.classList.contains('narration')).toBe(true);
    d.advance();
    d.advance();
    expect(el.speaker.textContent).toBe('Bo');
    expect(el.box.classList.contains('narration')).toBe(false);
    expect(seen).toEqual(['narrator', 'npc']);
  });

  it('types lines out, advances, applies speaker and style, and calls back at the end', () => {
    const el = dialogueBox();
    const d = new Dialogue(el, { charsPerSecond: 10 });
    const started: string[] = [];
    let chars = 0;
    let done = 0;
    d.onLine = (l) => started.push(l.text);
    d.onChar = () => chars++;
    d.say([{ text: 'Hello there', speaker: 'Ann', style: 'narrator' }, { text: 'Bye' }], () => done++);

    expect(d.active).toBe(true);
    expect(el.box.classList.contains('open')).toBe(true);
    expect(el.box.classList.contains('narrator')).toBe(true);
    expect(el.speaker.textContent).toBe('Ann');
    d.update(0.5);
    expect(el.text.textContent).toBe('Hello');
    expect(chars).toBe(1);
    expect(el.box.classList.contains('complete')).toBe(false);

    d.advance();
    expect(el.text.textContent).toBe('Hello there');
    expect(el.box.classList.contains('complete')).toBe(true);
    d.advance();
    expect(el.speaker.textContent).toBe('');
    expect(el.box.classList.contains('narrator')).toBe(false);
    expect(el.text.textContent).toBe('');
    expect(done).toBe(0);

    d.update(10);
    expect(el.text.textContent).toBe('Bye');
    d.advance();
    expect(d.active).toBe(false);
    expect(done).toBe(1);
    expect(started).toEqual(['Hello there', 'Bye']);
    expect(el.box.classList.contains('open')).toBe(false);
  });

  it('blips at most once per frame, only on letters at even positions', () => {
    const d = new Dialogue(dialogueBox(), { charsPerSecond: 100 });
    const got: string[] = [];
    d.onChar = (_l, c) => got.push(c);
    d.say([{ text: 'a b c d' }]);
    d.update(1);
    expect(got).toEqual(['d']);
  });
});

describe('Director', () => {
  it('waits in game time and is active while a script runs', async () => {
    const root = fakeElement();
    const dir = new Director({ root });
    const log: string[] = [];
    const done = dir.run(async () => {
      log.push('start');
      await dir.wait(1);
      log.push('after 1s');
    });
    expect(dir.active).toBe(true);
    expect(root.classList.contains('cutscene')).toBe(true);
    dir.update(0.6);
    await tick();
    expect(log).toEqual(['start']);
    dir.update(0.6);
    await done;
    expect(log).toEqual(['start', 'after 1s']);
    expect(dir.active).toBe(false);
    expect(root.classList.contains('cutscene')).toBe(false);
  });

  it('says lines through the dialogue, fades and shows captions', async () => {
    const dialogue = new Dialogue(dialogueBox());
    const fade = fakeElement();
    const caption = fakeElement();
    const dir = new Director({ dialogue, fade, caption, root: null });
    dir.hurry = true;
    const captions: string[] = [];
    dir.onCaption = (t) => captions.push(t);
    let finished = false;
    void dir.run(async () => {
      await dir.fade(true);
      expect(fade.classList.contains('black')).toBe(true);
      expect(fade.style.transitionDuration).toBe('0s');
      await dir.caption('Later');
      await dir.say([{ text: 'Hi' }]);
      await dir.fade(false);
      finished = true;
    });
    await tick();
    expect(captions).toEqual(['Later']);
    expect(caption.textContent).toBe('Later');
    expect(caption.classList.contains('visible')).toBe(false);
    expect(dialogue.active).toBe(true);
    dialogue.advance();
    dialogue.advance();
    await tick();
    expect(finished).toBe(true);
    expect(fade.classList.contains('black')).toBe(false);
  });

  it('works without elements, and say without a dialogue rejects', async () => {
    const dir = new Director({ root: null });
    const p = dir.fade(true, 0.5);
    dir.update(0.5);
    await p;
    await expect(dir.say([{ text: 'x' }])).rejects.toThrow(/needs a dialogue/);
  });
});

describe('SaveSlot', () => {
  const memory = (): Storage => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      get length() {
        return m.size;
      },
    };
  };

  it('round-trips a value and clears it', () => {
    const st = memory();
    const slot = new SaveSlot<{ level: number }>('game.v1', () => st);
    expect(slot.read()).toBeNull();
    expect(slot.write({ level: 3 })).toBe(true);
    expect(slot.read()).toEqual({ level: 3 });
    expect(new SaveSlot('other', () => st).read()).toBeNull();
    slot.clear();
    expect(slot.read()).toBeNull();
  });

  it('is safe without storage, with throwing storage and with bad JSON', () => {
    const none = new SaveSlot<number>('k', () => undefined);
    expect(none.read()).toBeNull();
    expect(none.write(1)).toBe(false);
    none.clear();
    const throwing = new SaveSlot<number>('k', () => {
      throw new Error('SecurityError');
    });
    expect(throwing.read()).toBeNull();
    expect(throwing.write(1)).toBe(false);
    throwing.clear();
    const st = memory();
    st.setItem('k', '{nope');
    expect(new SaveSlot<number>('k', () => st).read()).toBeNull();
    // Node has no localStorage: the default storage must not throw either.
    expect(new SaveSlot<number>('k').read()).toBeNull();
  });
});

describe('Actor', () => {
  const project = (): Project => {
    const h = createHumanoid({ id: 'h' });
    return { version: 1, name: 'T', startScene: 's', models: h.models, figures: [h.figure], scenes: [] };
  };

  it('walks to a point, steps along the way and resolves on arrival', async () => {
    const a = new Actor(project(), 'h', { floorY: 0.5, height: 0.9 });
    let steps = 0;
    a.onStep = () => steps++;
    a.place(0, 0, 0);
    let arrived = false;
    void a.walkTo(2, 0, 1).then(() => (arrived = true));
    expect(a.walking).toBe(true);
    for (let i = 0; i < 300 && a.walking; i++) a.update(1 / 60);
    await tick();
    expect(arrived).toBe(true);
    expect(a.pos.x).toBeCloseTo(2);
    expect(a.pos.y).toBeCloseTo(0);
    // Two seconds of walking, a footfall every 0.4 s.
    expect(steps).toBeGreaterThanOrEqual(4);
    expect(steps).toBeLessThanOrEqual(5);
    expect(a.heading).toBeCloseTo(Math.PI / 2, 1);
    a.draw();
    expect(a.figure.position.toArray()).toEqual([2, 0.5, 0]);
    expect(a.figure.scale.x).toBeCloseTo(0.9);
  });

  it('turns to look at a point and place resolves pending walks', async () => {
    const a = new Actor(project(), 'h');
    a.place(0, 0, 0);
    a.lookAt(-1, 0);
    for (let i = 0; i < 120; i++) a.update(1 / 60);
    // It eases in and stops within 0.01 rad.
    expect(Math.abs(a.heading + Math.PI / 2)).toBeLessThan(0.011);
    let resolved = false;
    void a.walkTo(10, 10).then(() => (resolved = true));
    a.place(3, 3);
    await tick();
    expect(resolved).toBe(true);
    expect(a.walking).toBe(false);
  });

  it('fails clearly for a missing figure', () => {
    expect(() => new Actor(project(), 'nobody')).toThrow(/Figure "nobody" does not exist/);
  });
});
