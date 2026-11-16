import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Figure, Model, Project, Scene } from '../src/core/index.js';
import { forgetMesh } from '../src/render/index.js';

/** One editor tab (Voxels, Scene, Animation). */
export interface Tab {
  enter(): void;
  exit(): void;
  /** Redraws the side panels. */
  panels(left: HTMLElement, right: HTMLElement): void;
  /** After undo or redo. */
  refresh(): void;
  pointer?(kind: 'down' | 'move' | 'up', ev: PointerEvent, ray: THREE.Raycaster): void;
  key?(ev: KeyboardEvent): boolean;
  frame?(dt: number): void;
  /** One line of help shown over the viewport. */
  hint: string;
}

export interface Action {
  undo(): void;
  redo(): void;
}

/** Everything but voxel cells: those are big, so painting records only the cells it changed. */
interface StructureSnapshot {
  models: Model[];
  meta: Map<Model, Pick<Model, 'name' | 'palette' | 'emissive'>>;
  figures: Figure[];
  scenes: Scene[];
  startScene: string;
  name: string;
}

const HISTORY_LIMIT = 200;

/** What the tabs share: the project, the viewport and the undo history. */
export class EditorContext {
  private past: Action[] = [];
  private future: Action[] = [];
  repaint: () => void = () => {};
  refreshTab: () => void = () => {};
  /** Called after every change (including undo and redo), for autosave. */
  changed: () => void = () => {};
  unsaved = false;

  constructor(
    public project: Project,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
    readonly orbit: OrbitControls,
    readonly canvas: HTMLCanvasElement,
    readonly renderer: THREE.WebGLRenderer,
  ) {}

  /** Forgets the history, for when another project is opened. */
  resetHistory(): void {
    this.past = [];
    this.future = [];
    this.unsaved = false;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  addAction(a: Action): void {
    this.past.push(a);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.markChanged();
  }

  undo(): void {
    const a = this.past.pop();
    if (!a) return;
    a.undo();
    this.future.push(a);
    this.markChanged();
    this.refreshTab();
    this.repaint();
  }

  redo(): void {
    const a = this.future.pop();
    if (!a) return;
    a.redo();
    this.past.push(a);
    this.markChanged();
    this.refreshTab();
    this.repaint();
  }

  private markChanged(): void {
    this.unsaved = true;
    this.changed();
  }

  private snapshot(): StructureSnapshot {
    const p = this.project;
    return {
      models: [...p.models],
      meta: new Map(p.models.map((m) => [m, { name: m.name, palette: [...m.palette], emissive: [...m.emissive] }])),
      figures: structuredClone(p.figures),
      scenes: structuredClone(p.scenes),
      startScene: p.startScene,
      name: p.name,
    };
  }

  private restore(s: StructureSnapshot): void {
    const p = this.project;
    p.models = [...s.models];
    for (const [m, meta] of s.meta) {
      m.name = meta.name;
      m.palette = [...meta.palette];
      m.emissive = [...meta.emissive];
      forgetMesh(m);
    }
    p.figures = structuredClone(s.figures);
    p.scenes = structuredClone(s.scenes);
    p.startScene = s.startScene;
    p.name = s.name;
  }

  /**
   * Applies a structural change (anything but painting voxels) and makes it undoable.
   * `extra` runs after restoring, for state outside the snapshot (such as a resized grid).
   */
  commit(change: () => void, extra?: { before(): void; after(): void }): void {
    const before = this.snapshot();
    change();
    const after = this.snapshot();
    this.addAction({
      undo: () => {
        this.restore(before);
        extra?.before();
      },
      redo: () => {
        this.restore(after);
        extra?.after();
      },
    });
  }

  /** Point the viewport orbits around. */
  target(): THREE.Vector3 {
    return this.orbit.target.clone();
  }
}
