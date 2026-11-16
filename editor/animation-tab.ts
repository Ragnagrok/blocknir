import * as THREE from 'three';
import { newId, poseFromClip, type Clip, type Figure, type Keyframe, type Part, type V3 } from '../src/core/index.js';
import { Figure3D } from '../src/render/index.js';
import type { EditorContext, Tab } from './context.js';
import { button, checkbox, h, heading, numberField, round, row, selectField, slider, textField, vectorField } from './ui.js';

const DEGREES = 180 / Math.PI;

/** Builds figures out of jointed parts and animates them with keyframe clips. */
export class AnimationTab implements Tab {
  readonly hint = 'Click a part: select it · Right drag: orbit · Middle drag: pan · Wheel: zoom · Space: play / pause';
  private figureId: string;
  private clipName = '';
  private partId = '';
  private keyIndex = 0;
  /** Playback time, in seconds. */
  time = 0;
  playing = false;
  private root = new THREE.Group();
  private model3d: Figure3D | null = null;

  constructor(private c: EditorContext) {
    this.figureId = c.project.figures[0]?.id ?? '';
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 2, 2);
    this.root.add(new THREE.AmbientLight(0xffffff, 1.6), sun, new THREE.GridHelper(4, 20, 0x565d6b, 0x343943));
  }

  /** The project was replaced: start over with its first figure. */
  reset(): void {
    this.figureId = this.c.project.figures[0]?.id ?? '';
    this.clipName = '';
    this.partId = '';
    this.keyIndex = 0;
    this.time = 0;
    this.playing = false;
  }

  private get figure(): Figure | null {
    return this.c.project.figures.find((f) => f.id === this.figureId) ?? null;
  }

  private get clip(): Clip | null {
    const f = this.figure;
    return f?.clips.find((x) => x.name === this.clipName) ?? f?.clips[0] ?? null;
  }

  private get keyframe(): Keyframe | null {
    return this.clip?.keys[this.keyIndex] ?? null;
  }

  private mount(): void {
    if (this.model3d) this.root.remove(this.model3d);
    this.model3d = null;
    const f = this.figure;
    if (!f) return;
    try {
      this.model3d = new Figure3D(this.c.project, f, { light: false });
      this.root.add(this.model3d);
    } catch (e) {
      alert(String(e));
    }
    this.pose();
  }

  private pose(): void {
    const k = this.clip;
    this.model3d?.applyPose(k ? poseFromClip(k, this.time) : {});
  }

  private sortKeys(k: Clip): void {
    k.keys.sort((a, b) => a.t - b.t);
  }

  enter(): void {
    this.c.scene.add(this.root);
    this.c.scene.fog = null;
    this.c.camera.near = 0.05;
    this.c.camera.far = 80;
    this.c.camera.fov = 40;
    this.c.camera.updateProjectionMatrix();
    this.c.orbit.target.set(0, 0.95, 0);
    this.c.camera.position.set(1.8, 1.7, 3.2);
    this.c.orbit.update();
    this.clipName = this.clip?.name ?? '';
    if (!this.figure?.parts.some((x) => x.id === this.partId)) this.partId = this.figure?.parts[0]?.id ?? '';
    this.mount();
  }

  exit(): void {
    this.playing = false;
    this.c.scene.remove(this.root);
  }

  refresh(): void {
    if (!this.figure) this.figureId = this.c.project.figures[0]?.id ?? '';
    this.keyIndex = Math.min(this.keyIndex, Math.max(0, (this.clip?.keys.length ?? 1) - 1));
    this.mount();
  }

  frame(dt: number): void {
    const k = this.clip;
    if (!this.playing || !k) return;
    this.time += dt;
    if (this.time > k.duration) {
      if (k.loop) this.time %= k.duration;
      else {
        this.time = k.duration;
        this.playing = false;
        this.c.repaint();
      }
    }
    this.pose();
  }

  pointer(kind: 'down' | 'move' | 'up', ev: PointerEvent, r: THREE.Raycaster): void {
    if (kind !== 'down' || ev.button !== 0 || !this.model3d) return;
    const i = r.intersectObject(this.model3d, true)[0];
    if (!i) return;
    let o: THREE.Object3D | null = i.object;
    while (o && !this.model3d.joints.has(o.name)) o = o.parent;
    if (o) {
      this.partId = o.name;
      this.c.repaint();
    }
  }

  key(ev: KeyboardEvent): boolean {
    if (ev.key === ' ') {
      this.playing = !this.playing;
      this.c.repaint();
      return true;
    }
    return false;
  }

  private edit(change: () => void, rebuild = false): void {
    this.c.commit(change);
    if (rebuild) this.mount();
    else this.pose();
    this.c.repaint();
  }

  private createFigure(): void {
    const p = this.c.project;
    const m = p.models.find((x) => !x.closed);
    if (!m) {
      alert('First create a model in the Voxels tab.');
      return;
    }
    this.c.commit(() => {
      const id = newId('figure', p.figures.map((f) => f.id));
      p.figures.push({
        id,
        name: `Figure ${p.figures.length + 1}`,
        parts: [{ id: 'root', model: m.id, parent: null, pivot: [0, 0.9, 0], origin: [m.size[0] / 2, 0, m.size[2] / 2] }],
        clips: [{ name: 'idle', duration: 1, loop: true, keys: [{ t: 0, rot: {} }] }],
      });
      this.figureId = id;
      this.clipName = 'idle';
      this.partId = 'root';
    });
    this.mount();
    this.c.repaint();
  }

  private addPart(f: Figure): void {
    const m = this.c.project.models.find((x) => !x.closed);
    if (!m) return;
    const id = newId('part', f.parts.map((x) => x.id));
    this.edit(() => {
      f.parts.push({ id, model: m.id, parent: this.partId || null, pivot: [0, 0, 0], origin: [m.size[0] / 2, 0, m.size[2] / 2] });
      this.partId = id;
    }, true);
  }

  private removePart(f: Figure, x: Part): void {
    if (f.parts.some((o) => o.parent === x.id)) {
      alert('Other parts hang from this one. Delete those first.');
      return;
    }
    this.edit(() => {
      f.parts = f.parts.filter((o) => o !== x);
      for (const k of f.clips) for (const key of k.keys) delete key.rot[x.id];
      this.partId = f.parts[0]?.id ?? '';
    }, true);
  }

  private addKey(k: Clip): void {
    const t = round(this.time);
    if (k.keys.some((key) => Math.abs(key.t - t) < 0.001)) return;
    const rot = poseFromClip(k, t);
    this.edit(() => {
      k.keys.push({ t, rot });
      this.sortKeys(k);
      this.keyIndex = k.keys.findIndex((key) => key.t === t);
    });
  }

  private createClip(f: Figure): void {
    const used = new Set(f.clips.map((k) => k.name));
    const name = used.has('clip') ? newId('clip', used) : 'clip';
    this.edit(() => {
      f.clips.push({ name, duration: 1, loop: true, keys: [{ t: 0, rot: {} }] });
      this.clipName = name;
      this.keyIndex = 0;
      this.time = 0;
    });
  }

  panels(left: HTMLElement, right: HTMLElement): void {
    const p = this.c.project;
    left.append(
      heading('Figure'),
      selectField('Editing', p.figures.map((f) => [f.id, f.name]), this.figureId, (v) => {
        this.figureId = v;
        this.clipName = this.figure?.clips[0]?.name ?? '';
        this.partId = this.figure?.parts[0]?.id ?? '';
        this.keyIndex = 0;
        this.time = 0;
        this.mount();
        this.c.repaint();
      }),
      row(button('New figure', () => this.createFigure())),
    );
    const f = this.figure;
    if (!f) return;
    left.append(
      textField('Name', f.name, (v) => this.edit(() => (f.name = v))),
      heading('Parts'),
      h(
        'div',
        { class: 'list' },
        ...f.parts.map((x) =>
          button(x.id, () => {
            this.partId = x.id;
            this.c.repaint();
          }, x.id === this.partId),
        ),
      ),
      row(button('+ Part attached to the selected one', () => this.addPart(f))),
    );
    const part = f.parts.find((x) => x.id === this.partId);
    if (part) {
      left.append(
        heading('Selected part'),
        selectField('Model', p.models.filter((m) => !m.closed).map((m) => [m.id, m.name]), part.model, (v) => this.edit(() => (part.model = v), true)),
        selectField('Hangs from', [['', '(root)'], ...f.parts.filter((x) => x !== part).map((x): [string, string] => [x.id, x.id])], part.parent ?? '', (v) =>
          this.edit(() => (part.parent = v || null), true),
        ),
        vectorField('Pivot (m)', part.pivot, (v) => this.edit(() => (part.pivot = v), true), 0.01),
        vectorField('Origin (vox)', part.origin, (v) => this.edit(() => (part.origin = v), true), 0.5),
        row(button('Delete part', () => this.removePart(f, part))),
      );
    }

    right.append(
      heading('Clip'),
      selectField('Clip', f.clips.map((k): [string, string] => [k.name, k.name]), this.clip?.name ?? '', (v) => {
        this.clipName = v;
        this.keyIndex = 0;
        this.time = 0;
        this.pose();
        this.c.repaint();
      }),
      row(button('New clip', () => this.createClip(f))),
      h(
        'p',
        { class: 'dim' },
        'The adventure player plays the clips named idle, walk and run (also the older reposo, andar, correr); creatures use idle, walk and attack. A missing clip falls back to the first one.',
      ),
    );
    const k = this.clip;
    if (!k) return;
    right.append(
      textField('Clip name', k.name, (v) => {
        if (!v || f.clips.some((o) => o !== k && o.name === v)) return;
        this.edit(() => (k.name = v));
        this.clipName = v;
      }),
      numberField('Duration (s)', k.duration, (v) => this.edit(() => (k.duration = Math.max(0.05, v))), 0.05),
      checkbox('Loop', k.loop, (v) => this.edit(() => (k.loop = v))),
      row(
        button(this.playing ? 'Pause clip' : 'Play clip', () => {
          this.playing = !this.playing;
          this.c.repaint();
        }, false, 'Space'),
      ),
      slider('Time', 0, k.duration, 0.01, this.time, (v) => {
        this.time = v;
        this.playing = false;
        this.pose();
      }),
      heading('Keyframes'),
      h(
        'div',
        { class: 'list' },
        ...k.keys.map((key, i) =>
          button(`${round(key.t)} s`, () => {
            this.keyIndex = i;
            this.time = key.t;
            this.playing = false;
            this.pose();
            this.c.repaint();
          }, i === this.keyIndex),
        ),
      ),
      row(
        button('+ Keyframe at this time', () => this.addKey(k)),
        button('Delete keyframe', () => {
          if (k.keys.length <= 1) return;
          this.edit(() => {
            k.keys.splice(this.keyIndex, 1);
            this.keyIndex = Math.min(this.keyIndex, k.keys.length - 1);
          });
        }),
      ),
    );
    const key = this.keyframe;
    if (key && this.partId) {
      const current: V3 = key.rot[this.partId] ?? [0, 0, 0];
      right.append(heading(`Rotation of ${this.partId} at this keyframe`));
      (['X', 'Y', 'Z'] as const).forEach((axis, i) => {
        right.append(
          slider(axis, -180, 180, 1, Math.round(current[i]! * DEGREES), (v, final) => {
            const next: V3 = [...(key.rot[this.partId] ?? [0, 0, 0])];
            next[i] = v / DEGREES;
            if (final) {
              this.edit(() => (key.rot[this.partId] = next));
            } else {
              // Preview while dragging, without touching the history.
              const earlier = key.rot[this.partId];
              key.rot[this.partId] = next;
              this.time = key.t;
              this.pose();
              if (earlier) key.rot[this.partId] = earlier;
              else delete key.rot[this.partId];
            }
          }),
        );
      });
    }
  }
}
