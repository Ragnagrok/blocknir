import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { figureOf, modelOf, newId, poseOf, type Camera, type Entity, type EntityKind, type Instance, type Light, type Scene, type V3 } from '../src/core/index.js';
import { buildScene, Figure3D, placeModel } from '../src/render/index.js';
import type { EditorContext, Tab } from './context.js';
import { button, checkbox, colorField, h, heading, numberField, row, selectField, textArea, textField, vectorField } from './ui.js';

type Kind = 'instance' | 'camera' | 'light' | 'entity';
interface Selection {
  kind: Kind;
  id: string;
}

const ENTITY_COLOR: Record<EntityKind, number> = {
  player: 0x57d38c,
  creature: 0xe0544e,
  item: 0xf0d264,
  note: 0xcfc6ae,
  door: 0x62a8f0,
};

const ENTITY_KINDS: [EntityKind, string][] = [
  ['player', 'Player start'],
  ['creature', 'Creature'],
  ['item', 'Item'],
  ['note', 'Note'],
  ['door', 'Door'],
];

/** Clip names each kind of character is expected to have. */
const CLIP_HELP: Partial<Record<EntityKind, string>> = {
  player: 'The player plays the clips idle, walk and (optionally) run.',
  creature: 'Creatures play the clips idle, walk and attack.',
};

/** Places furniture, lights, fixed cameras and entities in a scene. */
export class SceneTab implements Tab {
  readonly hint = 'Click: select · Drag the arrows: move · Delete: remove · Right drag: orbit · Middle drag: pan · Wheel: zoom';
  sceneId: string;
  private selection: Selection | null = null;
  private root = new THREE.Group();
  private helpers = new THREE.Group();
  private objects = new Map<string, THREE.Object3D>();
  private gizmo: TransformControls;
  private workLight = new THREE.AmbientLight(0xffffff, 2.2);
  private work = true;
  private dragging = false;
  private newObject: string;
  private newEntityKind: EntityKind = 'item';

  constructor(private c: EditorContext) {
    this.sceneId = c.project.scenes[0]?.id ?? '';
    this.newObject = c.project.models.find((m) => !m.closed)?.id ?? '';
    this.gizmo = new TransformControls(c.camera, c.canvas);
    this.gizmo.setTranslationSnap(0.02);
    this.gizmo.addEventListener('dragging-changed', (ev) => {
      this.c.orbit.enabled = !ev.value;
      this.dragging = Boolean(ev.value);
      if (!ev.value) this.endDrag();
    });
  }

  /** The project was replaced: start over with its first scene. */
  reset(): void {
    this.sceneId = this.c.project.startScene || this.c.project.scenes[0]?.id || '';
    if (!this.c.project.scenes.some((s) => s.id === this.sceneId)) this.sceneId = this.c.project.scenes[0]?.id ?? '';
    this.newObject = this.c.project.models.find((m) => !m.closed)?.id ?? '';
    this.selection = null;
  }

  private get scene(): Scene | null {
    return this.c.project.scenes.find((s) => s.id === this.sceneId) ?? null;
  }

  private keyOf(s: Selection): string {
    return `${s.kind}:${s.id}`;
  }

  private dataOf(s: Selection | null): Instance | Camera | Light | Entity | null {
    const sc = this.scene;
    if (!s || !sc) return null;
    const list: (Instance | Camera | Light | Entity)[] =
      s.kind === 'instance' ? sc.instances : s.kind === 'camera' ? sc.cameras : s.kind === 'light' ? sc.lights : sc.entities;
    return list.find((x) => x.id === s.id) ?? null;
  }

  private tag(o: THREE.Object3D, s: Selection): THREE.Object3D {
    o.userData.selection = s;
    this.objects.set(this.keyOf(s), o);
    return o;
  }

  private mount(): void {
    this.gizmo.detach();
    this.root.clear();
    this.helpers.clear();
    this.objects.clear();
    const sc = this.scene;
    if (!sc) return;
    const p = this.c.project;
    let built;
    try {
      built = buildScene(p, sc);
    } catch (e) {
      this.c.canvas.dataset.error = String(e);
      return;
    }
    this.root.add(built.group, this.helpers);
    if (this.work) this.root.add(this.workLight);
    this.c.scene.fog = this.work ? null : new THREE.FogExp2(sc.fog.color, sc.fog.density);

    // Instances become selectable through their holder (they come right after the room).
    const holders = built.group.children.slice(1, 1 + sc.instances.length);
    sc.instances.forEach((inst, i) => this.tag(holders[i]!, { kind: 'instance', id: inst.id }));

    const sphere = new THREE.SphereGeometry(0.1, 12, 10);
    for (const l of sc.lights) {
      const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: l.color }));
      m.position.set(...l.pos);
      this.helpers.add(this.tag(m, { kind: 'light', id: l.id }));
    }

    const body = new THREE.ConeGeometry(0.16, 0.3, 4);
    body.rotateX(-Math.PI / 2);
    for (const k of sc.cameras) {
      const m = new THREE.Mesh(body, new THREE.MeshBasicMaterial({ color: 0x7ac8ff }));
      m.position.set(...k.pos);
      m.lookAt(...k.target);
      this.helpers.add(this.tag(m, { kind: 'camera', id: k.id }));
      const selected = this.selection?.kind === 'camera' && this.selection.id === k.id;
      const [x0, z0] = k.zone.min;
      const [x1, z1] = k.zone.max;
      const y = 0.16;
      const zone = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x0, y, z0),
          new THREE.Vector3(x1, y, z0),
          new THREE.Vector3(x1, y, z1),
          new THREE.Vector3(x0, y, z1),
        ]),
        new THREE.LineBasicMaterial({ color: selected ? 0xffd27a : 0x3f6f96, depthTest: false }),
      );
      this.helpers.add(zone);
    }

    for (const x of sc.entities) this.helpers.add(this.tag(this.entityVisual(x), { kind: 'entity', id: x.id }));

    const selected = this.selection && this.objects.get(this.keyOf(this.selection));
    if (selected) this.gizmo.attach(selected);
    else this.selection = null;
  }

  private entityVisual(x: Entity): THREE.Object3D {
    const p = this.c.project;
    if (x.figure && p.figures.some((f) => f.id === x.figure)) {
      const figure = figureOf(p, x.figure);
      const f = new Figure3D(p, figure, { light: false });
      f.position.set(...x.pos);
      f.rotation.y = x.heading;
      const idle = figure.clips.find((k) => k.name === 'idle' || k.name === 'reposo')?.name ?? '';
      f.applyPose(poseOf(figure, idle, 0));
      return f;
    }
    if (x.model && p.models.some((m) => m.id === x.model)) {
      const o = placeModel(modelOf(p, x.model), x.pos, 0);
      o.rotation.y = x.heading;
      return o;
    }
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: ENTITY_COLOR[x.kind], wireframe: true }),
    );
    m.position.set(x.pos[0], x.pos[1] + 0.11, x.pos[2]);
    return m;
  }

  enter(): void {
    this.c.scene.add(this.root);
    this.c.scene.add(this.gizmo.getHelper());
    this.mount();
    const k = this.scene?.cameras[0];
    if (k) this.lookThrough(k);
  }

  exit(): void {
    this.gizmo.detach();
    this.c.scene.remove(this.gizmo.getHelper());
    this.c.scene.remove(this.root);
    this.c.scene.fog = null;
  }

  refresh(): void {
    if (!this.scene) this.sceneId = this.c.project.scenes[0]?.id ?? '';
    if (!this.dataOf(this.selection)) this.selection = null;
    this.mount();
  }

  private lookThrough(k: Camera): void {
    const { camera, orbit } = this.c;
    camera.near = 0.05;
    camera.far = 80;
    camera.fov = k.fov;
    camera.position.set(...k.pos);
    orbit.target.set(...k.target);
    camera.updateProjectionMatrix();
    orbit.update();
  }

  private endDrag(): void {
    const s = this.selection;
    const o = s && this.objects.get(this.keyOf(s));
    const d = this.dataOf(s);
    if (!s || !o || !d) return;
    const pos: V3 = [o.position.x, o.position.y, o.position.z];
    if (s.kind === 'entity' && !(d as Entity).figure && !(d as Entity).model) pos[1] -= 0.11;
    this.c.commit(() => {
      const current = this.dataOf(s) as { pos: V3 } | null;
      if (current) current.pos = pos;
    });
    this.mount();
    this.c.repaint();
  }

  private choose(s: Selection | null): void {
    this.selection = s;
    this.mount();
    this.c.repaint();
  }

  pointer(kind: 'down' | 'move' | 'up', ev: PointerEvent, r: THREE.Raycaster): void {
    if (kind !== 'down' || ev.button !== 0 || this.dragging || this.gizmo.axis) return;
    let found: Selection | null = null;
    for (const i of r.intersectObjects([...this.objects.values()], true)) {
      let o: THREE.Object3D | null = i.object;
      while (o && !o.userData.selection) o = o.parent;
      if (o) {
        found = o.userData.selection as Selection;
        break;
      }
    }
    this.choose(found);
  }

  key(ev: KeyboardEvent): boolean {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.selection) {
      this.remove(this.selection);
      return true;
    }
    return false;
  }

  private remove(s: Selection): void {
    const sc = this.scene;
    if (!sc) return;
    this.c.commit(() => {
      if (s.kind === 'instance') sc.instances = sc.instances.filter((x) => x.id !== s.id);
      if (s.kind === 'camera') sc.cameras = sc.cameras.filter((x) => x.id !== s.id);
      if (s.kind === 'light') sc.lights = sc.lights.filter((x) => x.id !== s.id);
      if (s.kind === 'entity') sc.entities = sc.entities.filter((x) => x.id !== s.id);
    });
    this.choose(null);
  }

  private edit(change: () => void): void {
    this.c.commit(change);
    this.mount();
    this.c.repaint();
  }

  private createScene(): void {
    const p = this.c.project;
    const room = p.models.find((m) => m.closed);
    if (!room) {
      alert('First create a model marked as a room, in the Voxels tab.');
      return;
    }
    this.c.commit(() => {
      const id = newId('scene', p.scenes.map((s) => s.id));
      p.scenes.push({
        id,
        name: `Scene ${p.scenes.length + 1}`,
        room: room.id,
        instances: [],
        cameras: [],
        lights: [],
        entities: [],
        ambient: { color: 0x46557a, intensity: 2.3 },
        fog: { color: 0x07080d, density: 0.045 },
      });
      this.sceneId = id;
    });
    this.selection = null;
    this.mount();
    this.c.repaint();
  }

  private defaultZone(sc: Scene): Camera['zone'] {
    const m = modelOf(this.c.project, sc.room);
    return { min: [0, 0], max: [m.size[0] * m.scale, m.size[2] * m.scale] };
  }

  private cameraFromView(sc: Scene): void {
    const { camera, orbit } = this.c;
    const id = newId('cam', sc.cameras.map((x) => x.id));
    this.c.commit(() =>
      sc.cameras.push({
        id,
        name: `Camera ${sc.cameras.length + 1}`,
        pos: camera.position.toArray() as V3,
        target: orbit.target.toArray() as V3,
        fov: camera.fov,
        zone: this.defaultZone(sc),
      }),
    );
    this.choose({ kind: 'camera', id });
  }

  private spawnPoint(): V3 {
    const t = this.c.target();
    return [t.x, Math.max(t.y, 0.12), t.z];
  }

  panels(left: HTMLElement, right: HTMLElement): void {
    const p = this.c.project;
    left.append(
      heading('Scene'),
      selectField('Editing', p.scenes.map((s) => [s.id, s.name]), this.sceneId, (v) => {
        this.sceneId = v;
        this.selection = null;
        this.mount();
        const k = this.scene?.cameras[0];
        if (k) this.lookThrough(k);
        this.c.repaint();
      }),
      row(button('New scene', () => this.createScene())),
      checkbox('Work light', this.work, (v) => {
        this.work = v;
        this.mount();
      }),
    );
    const sc = this.scene;
    if (!sc) return;

    left.append(
      heading('Add'),
      selectField('Object', p.models.filter((m) => !m.closed).map((m) => [m.id, m.name]), this.newObject, (v) => (this.newObject = v)),
      row(
        button('+ Object', () => {
          if (!this.newObject) return;
          const id = newId('obj', sc.instances.map((x) => x.id));
          this.c.commit(() => sc.instances.push({ id, model: this.newObject, pos: this.spawnPoint(), rot: 0, solid: true }));
          this.choose({ kind: 'instance', id });
        }),
      ),
      selectField('Entity', ENTITY_KINDS, this.newEntityKind, (v) => (this.newEntityKind = v as EntityKind)),
      row(
        button('+ Entity', () => {
          const kind = this.newEntityKind;
          const id = newId(kind, sc.entities.map((x) => x.id));
          const name = ENTITY_KINDS.find(([t]) => t === kind)![1];
          const e: Entity = { id, kind, name, pos: this.spawnPoint(), heading: 0 };
          const figure = kind === 'player' || kind === 'creature' ? p.figures[0]?.id : undefined;
          if (figure) e.figure = figure;
          this.c.commit(() => sc.entities.push(e));
          this.choose({ kind: 'entity', id });
        }),
        button('+ Light', () => {
          const id = newId('light', sc.lights.map((x) => x.id));
          this.c.commit(() =>
            sc.lights.push({
              id,
              name: `Light ${sc.lights.length + 1}`,
              kind: 'point',
              pos: this.spawnPoint(),
              target: this.spawnPoint(),
              color: 0xffc98a,
              intensity: 6,
              range: 8,
              angle: 0.5,
              shadow: false,
              flicker: 0,
            }),
          );
          this.choose({ kind: 'light', id });
        }),
        button('+ Camera from view', () => this.cameraFromView(sc)),
      ),
    );

    const group = (title: string, kind: Kind, items: { id: string; name: string }[]): void => {
      left.append(
        heading(title),
        h(
          'div',
          { class: 'list' },
          ...items.map((x) => button(x.name, () => this.choose({ kind, id: x.id }), this.selection?.kind === kind && this.selection.id === x.id)),
        ),
      );
    };
    group('Cameras', 'camera', sc.cameras);
    group('Lights', 'light', sc.lights);
    group('Entities', 'entity', sc.entities);
    group('Objects', 'instance', sc.instances.map((x) => ({ id: x.id, name: p.models.find((m) => m.id === x.model)?.name ?? x.id })));

    this.properties(right, sc);
  }

  private properties(right: HTMLElement, sc: Scene): void {
    const p = this.c.project;
    const s = this.selection;
    const d = this.dataOf(s);
    if (!s || !d) {
      const num = (t: string, v: number, f: (n: number) => void, step = 0.01): HTMLElement =>
        numberField(t, v, (n) => this.edit(() => f(n)), step);
      right.append(
        heading('Scene'),
        textField('Name', sc.name, (v) => this.edit(() => (sc.name = v))),
        selectField('Room', p.models.filter((x) => x.closed).map((x) => [x.id, x.name]), sc.room, (v) => this.edit(() => (sc.room = v))),
        checkbox('Start scene of the game', p.startScene === sc.id, (v) => {
          if (v) this.edit(() => (p.startScene = sc.id));
        }),
        heading('Atmosphere'),
        colorField('Ambient', sc.ambient.color, (v) => this.edit(() => (sc.ambient.color = v))),
        num('Intensity', sc.ambient.intensity, (n) => (sc.ambient.intensity = n), 0.05),
        colorField('Fog', sc.fog.color, (v) => this.edit(() => (sc.fog.color = v))),
        num('Density', sc.fog.density, (n) => (sc.fog.density = n), 0.005),
        h('p', { class: 'dim' }, 'Select something to see its properties. Uncheck “Work light” to preview the real lighting and fog.'),
      );
      return;
    }

    right.append(heading('Properties'));
    if (s.kind === 'instance') {
      const x = d as Instance;
      right.append(
        selectField('Model', p.models.filter((m) => !m.closed).map((m) => [m.id, m.name]), x.model, (v) => this.edit(() => (x.model = v))),
        vectorField('Position', x.pos, (v) => this.edit(() => (x.pos = v))),
        row(button('Rotate 90°', () => this.edit(() => (x.rot = (x.rot + 1) % 4)))),
        checkbox('Solid', x.solid, (v) => this.edit(() => (x.solid = v))),
      );
    } else if (s.kind === 'camera') {
      const x = d as Camera;
      right.append(
        textField('Name', x.name, (v) => this.edit(() => (x.name = v))),
        row(
          button('Look through this camera', () => this.lookThrough(x)),
          button('Use the current view', () => {
            const { camera, orbit } = this.c;
            this.edit(() => {
              x.pos = camera.position.toArray() as V3;
              x.target = orbit.target.toArray() as V3;
              x.fov = camera.fov;
            });
          }),
        ),
        vectorField('Position', x.pos, (v) => this.edit(() => (x.pos = v))),
        vectorField('Looks at', x.target, (v) => this.edit(() => (x.target = v))),
        numberField('Field of view', x.fov, (v) => this.edit(() => (x.fov = v)), 1),
        heading('Zone (while the player stands inside)'),
        numberField('X from', x.zone.min[0], (v) => this.edit(() => (x.zone.min[0] = v))),
        numberField('X to', x.zone.max[0], (v) => this.edit(() => (x.zone.max[0] = v))),
        numberField('Z from', x.zone.min[1], (v) => this.edit(() => (x.zone.min[1] = v))),
        numberField('Z to', x.zone.max[1], (v) => this.edit(() => (x.zone.max[1] = v))),
      );
    } else if (s.kind === 'light') {
      const x = d as Light;
      right.append(
        textField('Name', x.name, (v) => this.edit(() => (x.name = v))),
        selectField('Kind', [['point', 'Point'], ['spot', 'Spot']], x.kind, (v) => this.edit(() => (x.kind = v as Light['kind']))),
        vectorField('Position', x.pos, (v) => this.edit(() => (x.pos = v))),
        colorField('Color', x.color, (v) => this.edit(() => (x.color = v))),
        numberField('Intensity', x.intensity, (v) => this.edit(() => (x.intensity = v)), 0.5),
        numberField('Range', x.range, (v) => this.edit(() => (x.range = v)), 0.5),
        numberField('Flicker', x.flicker, (v) => this.edit(() => (x.flicker = v)), 0.1),
        checkbox('Casts shadows', x.shadow, (v) => this.edit(() => (x.shadow = v))),
      );
      if (x.kind === 'spot') {
        right.append(
          vectorField('Points at', x.target, (v) => this.edit(() => (x.target = v))),
          numberField('Cone (rad)', x.angle, (v) => this.edit(() => (x.angle = v))),
        );
      }
    } else {
      this.entityProperties(right, d as Entity);
    }
    right.append(row(button('Delete', () => this.remove(s))));
  }

  private entityProperties(right: HTMLElement, x: Entity): void {
    const p = this.c.project;
    const optional = (t: string, v: string | undefined, f: (s: string | undefined) => void): HTMLElement =>
      textField(t, v ?? '', (s) => this.edit(() => f(s || undefined)));
    right.append(
      h('div', { class: 'dim row' }, ENTITY_KINDS.find(([t]) => t === x.kind)![1]),
      textField('Name', x.name, (v) => this.edit(() => (x.name = v))),
      vectorField('Position', x.pos, (v) => this.edit(() => (x.pos = v))),
      numberField('Heading (rad)', x.heading, (v) => this.edit(() => (x.heading = v)), 0.1),
    );
    if (x.kind === 'player' || x.kind === 'creature') {
      right.append(
        selectField('Figure', p.figures.map((f) => [f.id, f.name]), x.figure ?? '', (v) => this.edit(() => (x.figure = v))),
        h('p', { class: 'dim' }, CLIP_HELP[x.kind]!),
      );
    } else {
      right.append(
        selectField('Model', [['', '(none)'], ...p.models.filter((m) => !m.closed).map((m): [string, string] => [m.id, m.name])], x.model ?? '', (v) =>
          this.edit(() => {
            if (v) x.model = v;
            else delete x.model;
          }),
        ),
      );
    }
    if (x.kind === 'item') right.append(h('p', { class: 'dim' }, 'Doors that require this item refer to it by its name.'));
    if (x.kind === 'note') {
      right.append(textArea('Text', x.text ?? '', (s) => this.edit(() => (s ? (x.text = s) : delete x.text))));
    }
    if (x.kind === 'door') {
      const destination = p.scenes.find((sc) => sc.id === x.destination);
      right.append(
        optional('Requires item', x.requires, (s) => (s ? (x.requires = s) : delete x.requires)),
        optional('When locked', x.lockedText, (s) => (s ? (x.lockedText = s) : delete x.lockedText)),
        optional('When opened', x.text, (s) => (s ? (x.text = s) : delete x.text)),
        selectField('Leads to', [['', '(nowhere)'], ...p.scenes.map((sc): [string, string] => [sc.id, sc.name])], x.destination ?? '', (v) =>
          this.edit(() => {
            if (v) x.destination = v;
            else delete x.destination;
            delete x.entry;
          }),
        ),
      );
      if (destination) {
        right.append(
          selectField('Arrives at', [['', '(choose)'], ...destination.entities.map((d): [string, string] => [d.id, d.name])], x.entry ?? '', (v) =>
            this.edit(() => {
              if (v) x.entry = v;
              else delete x.entry;
            }),
          ),
        );
      }
    }
  }
}
