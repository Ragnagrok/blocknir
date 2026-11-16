import * as THREE from 'three';
import {
  cellIndex,
  getCell,
  gridOf,
  inBounds,
  lostCells,
  MAX_CELLS,
  MAX_SIDE,
  modelOf,
  newId,
  newModel,
  offsetFor,
  raycast,
  resizeModel,
  setGrid,
  type Anchor,
  type Grid,
  type Hit,
  type Model,
  type V3,
} from '../src/core/index.js';
import { forgetMesh, VoxelMesh } from '../src/render/index.js';
import type { EditorContext, Tab } from './context.js';
import { button, checkbox, colorField, fromHex, h, heading, numberField, row, selectField, slider, textField, toHex } from './ui.js';

type Tool = 'add' | 'erase' | 'paint' | 'pick';

const TOOLS: [Tool, string, string][] = [
  ['add', 'Add', 'B'],
  ['erase', 'Erase', 'E'],
  ['paint', 'Paint', 'P'],
  ['pick', 'Eyedropper', 'I'],
];

const TOOL_KEYS: Record<string, Tool> = { b: 'add', e: 'erase', p: 'paint', i: 'pick' };

/** Paints and edits the voxels of one model at a time. */
export class VoxelsTab implements Tab {
  readonly hint = 'Left click: tool · Right drag: orbit · Middle drag: pan · Wheel: zoom · B E P I: tools · Ctrl+Z / Ctrl+Y';
  modelId: string;
  private tool: Tool = 'add';
  private box = false;
  private mirror = false;
  private color = 1;
  private cutY: number | null = null;

  private root = new THREE.Group();
  private mesh: VoxelMesh | null = null;
  private cursor: THREE.LineSegments;
  private boxSelection: THREE.LineSegments;
  private lights: THREE.Light[];
  /** Cells changed by the stroke in progress, by cell index. */
  private stroke: Map<number, { before: number; after: number; cell: V3 }> | null = null;
  private start: Hit | null = null;
  /** While dragging, painting stays on the layer where the stroke began. */
  private layer: { axis: number; value: number } | null = null;
  private pendingSize: { key: string; size: V3; anchors: [Anchor, Anchor, Anchor] } | null = null;

  constructor(private c: EditorContext) {
    this.modelId = c.project.models[0]?.id ?? '';
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.cursor = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffd27a, depthTest: false }));
    this.cursor.renderOrder = 10;
    this.boxSelection = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x7ac8ff, depthTest: false }));
    this.boxSelection.renderOrder = 10;
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(0.5, 1, 0.7);
    this.lights = [new THREE.AmbientLight(0xffffff, 1.5), sun];
  }

  /** The project was replaced: start over with its first model. */
  reset(): void {
    this.modelId = this.c.project.models[0]?.id ?? '';
    this.color = 1;
    this.cutY = null;
  }

  private get model(): Model | null {
    return this.c.project.models.find((m) => m.id === this.modelId) ?? null;
  }

  private mount(frame = true): void {
    this.root.clear();
    this.mesh = null;
    const m = this.model;
    if (!m) return;
    this.mesh = new VoxelMesh(m);
    this.mesh.cutY = this.cutY ?? undefined;
    this.mesh.rebuild();
    this.root.add(this.mesh);
    const s = m.scale;
    const outline = new THREE.Box3Helper(
      new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(m.size[0] * s, m.size[1] * s, m.size[2] * s)),
      new THREE.Color(0x565d6b),
    );
    this.root.add(outline, ...this.lights, this.cursor, this.boxSelection);
    this.cursor.visible = false;
    this.boxSelection.visible = false;
    if (frame) this.frameModel(m);
  }

  private frameModel(m: Model): void {
    const s = m.scale;
    const center = new THREE.Vector3((m.size[0] * s) / 2, (m.size[1] * s) / 3, (m.size[2] * s) / 2);
    const radius = Math.hypot(m.size[0], m.size[1], m.size[2]) * s;
    this.c.orbit.target.copy(center);
    this.c.camera.position.copy(center).add(new THREE.Vector3(0.75, 0.75, 1).multiplyScalar(radius * 0.95));
    this.c.camera.near = radius / 200;
    this.c.camera.far = radius * 12;
    this.c.camera.updateProjectionMatrix();
    this.c.orbit.update();
  }

  enter(): void {
    this.c.scene.add(this.root);
    this.c.scene.fog = null;
    this.mount();
  }

  exit(): void {
    this.c.scene.remove(this.root);
    const m = this.model;
    if (m) forgetMesh(m);
  }

  refresh(): void {
    if (!this.model) this.modelId = this.c.project.models[0]?.id ?? '';
    const m = this.model;
    if (!m || this.mesh?.model !== m || this.mesh.grid !== gridOf(m)) this.mount(false);
    else this.mesh.rebuild();
  }

  private hit(r: THREE.Raycaster, g: Grid, m: Model): Hit | null {
    const o = r.ray.origin.clone().divideScalar(m.scale);
    const d = r.ray.direction;
    const cut = this.cutY;
    const hit = raycast(g, [o.x, o.y, o.z], [d.x, d.y, d.z], {
      skipExterior: m.closed,
      ignore: cut === null ? undefined : (_x, y) => y >= cut,
    });
    if (hit) return hit;
    // Nothing to touch: build on the model's base.
    if (d.y >= 0) return null;
    const t = -o.y / d.y;
    const x = Math.floor(o.x + d.x * t);
    const z = Math.floor(o.z + d.z * t);
    if (x < 0 || z < 0 || x >= g.x || z >= g.z) return null;
    return { cell: [x, -1, z], previous: [x, 0, z], normal: [0, 1, 0] };
  }

  /** The cell the tool acts on. */
  private targetOf(i: Hit): V3 {
    return this.tool === 'add' ? i.previous : i.cell;
  }

  private placeCursor(obj: THREE.Object3D, a: V3, b: V3, s: number): void {
    const min = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])] as const;
    const max = [Math.max(a[0], b[0]) + 1, Math.max(a[1], b[1]) + 1, Math.max(a[2], b[2]) + 1] as const;
    obj.position.set(((min[0] + max[0]) / 2) * s, ((min[1] + max[1]) / 2) * s, ((min[2] + max[2]) / 2) * s);
    obj.scale.set((max[0] - min[0]) * s, (max[1] - min[1]) * s, (max[2] - min[2]) * s);
    obj.visible = true;
  }

  private applyCell(g: Grid, x: number, y: number, z: number): void {
    if (!inBounds(g, x, y, z) || !this.stroke) return;
    const i = cellIndex(g, x, y, z);
    const current = g.cells[i]!;
    let next = current;
    if (this.tool === 'add') next = this.color;
    else if (this.tool === 'erase') next = 0;
    else if (this.tool === 'paint' && current !== 0) next = this.color;
    if (next === current) return;
    const earlier = this.stroke.get(i);
    this.stroke.set(i, { before: earlier?.before ?? current, after: next, cell: [x, y, z] });
    g.cells[i] = next;
    this.mesh?.touch(x, y, z);
  }

  private applyAt(g: Grid, c: V3): void {
    this.applyCell(g, c[0], c[1], c[2]);
    if (this.mirror) this.applyCell(g, g.x - 1 - c[0], c[1], c[2]);
  }

  private endStroke(m: Model, g: Grid): void {
    const stroke = this.stroke;
    this.stroke = null;
    this.mesh?.apply();
    if (!stroke || stroke.size === 0) return;
    const changes = [...stroke.entries()];
    const write = (which: 'before' | 'after'): void => {
      for (const [i, change] of changes) {
        g.cells[i] = change[which];
        if (this.mesh?.model === m) this.mesh.touch(...change.cell);
      }
      if (this.mesh?.model === m) this.mesh.apply();
      forgetMesh(m);
    };
    forgetMesh(m);
    this.c.addAction({ undo: () => write('before'), redo: () => write('after') });
    this.c.repaint();
  }

  pointer(kind: 'down' | 'move' | 'up', ev: PointerEvent, r: THREE.Raycaster): void {
    const m = this.model;
    if (!m || !this.mesh) return;
    const g = gridOf(m);
    const i = this.hit(r, g, m);

    if (kind === 'up') {
      if (this.stroke && this.box && this.start && i) {
        const a = this.targetOf(this.start);
        const b = this.targetOf(i);
        for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) {
          for (let z = Math.min(a[2], b[2]); z <= Math.max(a[2], b[2]); z++) {
            for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) this.applyAt(g, [x, y, z]);
          }
        }
      }
      this.boxSelection.visible = false;
      this.start = null;
      this.layer = null;
      this.endStroke(m, g);
      return;
    }

    this.cursor.visible = false;
    if (!i) return;
    if (this.tool !== 'add' && i.cell[1] < 0) return;
    const c = this.targetOf(i);
    this.placeCursor(this.cursor, c, c, m.scale);

    if (kind === 'down' && ev.button === 0) {
      if (this.tool === 'pick') {
        const v = getCell(g, c[0], c[1], c[2]);
        if (v) {
          this.color = v;
          this.c.repaint();
        }
        return;
      }
      this.stroke = new Map();
      this.start = i;
      if (!this.box) {
        const axis = i.normal.findIndex((n) => n !== 0);
        this.layer = axis >= 0 ? { axis, value: c[axis]! } : null;
        this.applyAt(g, c);
        this.mesh.apply();
      }
      return;
    }

    if (kind === 'move' && this.stroke) {
      if (this.box && this.start) {
        this.placeCursor(this.boxSelection, this.targetOf(this.start), c, m.scale);
      } else if (!this.layer || c[this.layer.axis] === this.layer.value) {
        // Dragging paints over the same layer; otherwise it would build toward the camera.
        this.applyAt(g, c);
        this.mesh.apply();
      }
    }
  }

  key(ev: KeyboardEvent): boolean {
    const tool = TOOL_KEYS[ev.key.toLowerCase()];
    if (tool) {
      this.tool = tool;
      this.c.repaint();
      return true;
    }
    return false;
  }

  private remesh(): void {
    if (this.mesh) {
      this.mesh.cutY = this.cutY ?? undefined;
      this.mesh.rebuild();
    }
    const m = this.model;
    if (m) forgetMesh(m);
  }

  private createModel(fields: { name: string; x: number; y: number; z: number; scale: number; room: boolean }): void {
    const p = this.c.project;
    const size: V3 = [Math.max(1, fields.x | 0), Math.max(1, fields.y | 0), Math.max(1, fields.z | 0)];
    if (size.some((n) => n > MAX_SIDE) || size[0] * size[1] * size[2] > MAX_CELLS) {
      alert(`Each side can be at most ${MAX_SIDE} voxels, and ${MAX_CELLS.toLocaleString()} cells in total.`);
      return;
    }
    this.c.commit(() => {
      const id = newId('model', p.models.map((m) => m.id));
      const m = newModel(id, fields.name || id, size, fields.scale, fields.room, [0x9a9a9a, 0x5c3a1f, 0x264238, 0xb49a55]);
      p.models.push(m);
      this.modelId = id;
    });
    this.mount();
    this.c.repaint();
  }

  panels(left: HTMLElement, right: HTMLElement): void {
    const p = this.c.project;
    const m = this.model;
    const fresh = { name: 'New model', x: 32, y: 32, z: 32, scale: 0.04, room: false };

    left.append(
      heading('Model'),
      selectField('Editing', p.models.map((x) => [x.id, x.name]), this.modelId, (v) => {
        this.modelId = v;
        this.color = 1;
        this.cutY = null;
        this.mount();
        this.c.repaint();
      }),
    );
    if (m) {
      left.append(
        textField('Name', m.name, (v) => {
          this.c.commit(() => (m.name = v));
          this.c.repaint();
        }),
        h('div', { class: 'dim row' }, `${m.size.join(' × ')} voxels · ${m.scale} m per voxel${m.closed ? ' · room' : ''}`),
        row(
          button('Duplicate', () => {
            this.c.commit(() => {
              const id = newId(m.id, p.models.map((x) => x.id));
              const copy: Model = { ...structuredClone(m), id, name: `${m.name} (copy)` };
              gridOf(copy).cells.set(gridOf(m).cells);
              p.models.push(copy);
              this.modelId = id;
            });
            this.mount();
            this.c.repaint();
          }),
          button('Delete model', () => {
            if (this.inUse(m)) {
              alert('This model is used by a scene or a figure. Remove it from there before deleting it.');
              return;
            }
            this.c.commit(() => {
              p.models = p.models.filter((x) => x !== m);
              this.modelId = p.models[0]?.id ?? '';
            });
            this.mount();
            this.c.repaint();
          }),
        ),
      );
      this.sizePanel(left, m);
    }

    left.append(
      heading('New model'),
      textField('Name', fresh.name, (v) => (fresh.name = v)),
      numberField('Width X', fresh.x, (v) => (fresh.x = v), 1),
      numberField('Height Y', fresh.y, (v) => (fresh.y = v), 1),
      numberField('Depth Z', fresh.z, (v) => (fresh.z = v), 1),
      numberField('Meters/voxel', fresh.scale, (v) => (fresh.scale = v), 0.005),
      checkbox('It is a room (seen from inside)', false, (v) => (fresh.room = v)),
      button('Create', () => this.createModel(fresh)),
    );

    right.append(
      heading('Tool'),
      row(
        ...TOOLS.map(([id, label, k]) =>
          button(label, () => {
            this.tool = id;
            this.c.repaint();
          }, this.tool === id, `Key ${k}`),
        ),
      ),
      checkbox('Box (drag from corner to corner)', this.box, (v) => (this.box = v)),
      checkbox('Mirror on X', this.mirror, (v) => (this.mirror = v)),
    );

    if (!m) return;
    right.append(heading('Palette'), this.palette(m));
    right.append(
      colorField('Color', m.palette[this.color] ?? 0, (v) => {
        this.c.commit(() => (m.palette[this.color] = v));
        this.remesh();
      }),
      checkbox('Emits light', m.emissive.includes(this.color), (v) => {
        this.c.commit(() => {
          m.emissive = m.emissive.filter((x) => x !== this.color);
          if (v) m.emissive.push(this.color);
        });
        this.remesh();
      }),
      row(
        h('input', { type: 'color', value: toHex(0xb0b0b0), 'aria-label': 'Color to add', id: 'new-color' }),
        button('Add color', () => {
          if (m.palette.length > 255) {
            alert('A palette holds up to 255 colors per model.');
            return;
          }
          const input = document.getElementById('new-color') as HTMLInputElement;
          this.c.commit(() => m.palette.push(fromHex(input.value)));
          this.color = m.palette.length - 1;
          this.c.repaint();
        }),
      ),
      heading('View'),
      slider('Cut at Y', 1, m.size[1], 1, this.cutY ?? m.size[1], (v, final) => {
        this.cutY = v >= m.size[1] ? null : v;
        if (final) this.remesh();
      }),
    );
  }

  private sizePanel(left: HTMLElement, m: Model): void {
    const key = `${m.id}:${m.size.join('x')}`;
    if (this.pendingSize?.key !== key) this.pendingSize = { key, size: [...m.size], anchors: ['center', 'start', 'center'] };
    const pending = this.pendingSize;
    const axes: [string, string, [string, string][]][] = [
      ['width', 'Grow on X', [['center', 'Both sides'], ['start', 'Toward +X'], ['end', 'Toward −X']]],
      ['height', 'Grow on Y', [['start', 'Upward'], ['center', 'Both sides'], ['end', 'Downward']]],
      ['depth', 'Grow on Z', [['center', 'Both sides'], ['start', 'Toward +Z'], ['end', 'Toward −Z']]],
    ];
    left.append(heading('Resize'));
    axes.forEach(([name, label, options], i) => {
      left.append(
        numberField(`New ${name}`, pending.size[i]!, (v) => (pending.size[i] = v), 1),
        selectField(label, options, pending.anchors[i]!, (v) => (pending.anchors[i] = v as Anchor)),
      );
    });
    left.append(row(button('Apply size', () => this.applySize(m, pending.size, pending.anchors))));
  }

  private applySize(m: Model, requested: V3, anchors: [Anchor, Anchor, Anchor]): void {
    const size: V3 = [requested[0], requested[1], requested[2]];
    if (size.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_SIDE) || size[0] * size[1] * size[2] > MAX_CELLS) {
      alert(`Sizes must be whole numbers from 1 to ${MAX_SIDE}, and up to ${MAX_CELLS.toLocaleString()} cells in total.`);
      return;
    }
    if (size.every((n, i) => n === m.size[i])) return;
    const original = gridOf(m);
    const lost = lostCells(original, size, offsetFor(m.size, size, anchors));
    if (lost > 0 && !confirm(`This change deletes ${lost.toLocaleString()} voxels. Continue?`)) return;
    let resized = original;
    this.c.commit(
      () => {
        resized = resizeModel(this.c.project, m, size, anchors).after;
      },
      { before: () => setGrid(m, original), after: () => setGrid(m, resized) },
    );
    forgetMesh(m);
    if (this.cutY !== null && this.cutY >= size[1]) this.cutY = null;
    this.mount(false);
    this.c.repaint();
  }

  private inUse(m: Model): boolean {
    const p = this.c.project;
    return (
      p.figures.some((f) => f.parts.some((x) => x.model === m.id)) ||
      p.scenes.some((s) => s.room === m.id || s.instances.some((i) => i.model === m.id) || s.entities.some((x) => x.model === m.id))
    );
  }

  private palette(m: Model): HTMLElement {
    const el = h('div', { class: 'palette' });
    m.palette.forEach((color, i) => {
      if (i === 0) return;
      const b = button('', () => {
        this.color = i;
        this.c.repaint();
      }, this.color === i, `${toHex(color)}${m.emissive.includes(i) ? ' (emissive)' : ''}`);
      b.style.background = toHex(color);
      if (m.emissive.includes(i)) b.classList.add('glow');
      b.setAttribute('aria-label', `Color ${i} ${toHex(color)}`);
      el.append(b);
    });
    return el;
  }

  /** To switch to this tab with a given model (checks that it exists). */
  use(id: string): void {
    modelOf(this.c.project, id);
    this.modelId = id;
  }
}
