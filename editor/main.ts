import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gridOf, validate, type Project } from '../src/core/index.js';
import { AnimationTab } from './animation-tab.js';
import { EditorContext, type Tab } from './context.js';
import { SceneTab } from './scene-tab.js';
import { starterProject } from './starter.js';
import {
  loadCurrentProject,
  openProjectFile,
  projectJson,
  saveCurrentProject,
  saveProjectFile,
  saveToBrowser,
  type Store,
} from './storage.js';
import { button, h } from './ui.js';
import { VoxelsTab } from './voxels-tab.js';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
type TabName = 'voxels' | 'scene' | 'animation';

/** Browser storage is written this long after the last change. */
const AUTOSAVE_DELAY = 800;

async function main(): Promise<void> {
  const loaded = await loadCurrentProject();
  const store: Store = loaded.store;
  const project = loaded.project ?? starterProject();

  const canvas = $('viewport') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1c21);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
  const orbit = new OrbitControls(camera, canvas);
  orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  orbit.enableDamping = false;

  const c = new EditorContext(project, scene, camera, orbit, canvas, renderer);
  const voxels = new VoxelsTab(c);
  const sceneTab = new SceneTab(c);
  const animation = new AnimationTab(c);
  const tabs: Record<TabName, Tab> = { voxels, scene: sceneTab, animation };
  let current: TabName = 'scene';
  let status = loaded.project ? '' : 'Started a new project';
  const setStatus = (t: string): void => {
    status = t;
    const el = document.getElementById('status');
    if (el) el.textContent = t;
  };
  const storeLabel = store === 'disk' ? 'to disk' : 'in this browser';

  const save = async (): Promise<boolean> => {
    const errors = validate(c.project);
    try {
      await saveCurrentProject(c.project, store);
    } catch (e) {
      setStatus(`Could not save: ${String(e)}`);
      return false;
    }
    c.unsaved = false;
    setStatus(errors.length ? `Saved ${storeLabel}, with warnings: ${errors.join(' · ')}` : `Saved ${storeLabel} at ${new Date().toLocaleTimeString()}`);
    return true;
  };

  // Browser storage saves itself; the disk is written only when asked (each write keeps a backup).
  let autosave = 0;
  c.changed = () => {
    if (store === 'disk') {
      setStatus('Unsaved changes (Ctrl+S saves to disk)');
      return;
    }
    clearTimeout(autosave);
    autosave = window.setTimeout(() => void save(), AUTOSAVE_DELAY);
  };

  const replaceProject = (p: Project, message: string): void => {
    tabs[current].exit();
    c.project = p;
    c.resetHistory();
    voxels.reset();
    sceneTab.reset();
    animation.reset();
    orbit.enabled = true;
    tabs[current].enter();
    repaint();
    if (store === 'browser') {
      void saveToBrowser(p).then(
        () => setStatus(`${message} · saved in this browser`),
        (e: unknown) => setStatus(`${message} · could not save: ${String(e)}`),
      );
    } else {
      c.unsaved = true;
      setStatus(`${message} · Ctrl+S saves it to disk`);
    }
  };

  const confirmDiscard = (): boolean => store === 'browser' || !c.unsaved || confirm('There are unsaved changes. Discard them?');

  const newProject = (): void => {
    if (!confirm('Replace the current project with a new starter project?')) return;
    replaceProject(starterProject(), 'New project');
  };

  const open = async (): Promise<void> => {
    if (!confirmDiscard()) return;
    try {
      const picked = await openProjectFile();
      if (!picked) return;
      const errors = validate(picked.project);
      if (errors.length && !confirm(`The file has problems:\n${errors.join('\n')}\n\nOpen it anyway?`)) return;
      replaceProject(picked.project, `Opened ${picked.file}`);
    } catch (e) {
      setStatus(`That file is not a valid project: ${String(e)}`);
    }
  };

  const saveAs = async (): Promise<void> => {
    try {
      const result = await saveProjectFile(c.project);
      if (result !== 'cancelled') setStatus(result === 'saved' ? 'Saved a copy as a file' : 'Downloaded a copy of the project');
    } catch (e) {
      setStatus(`Could not save the file: ${String(e)}`);
    }
  };

  const play = async (): Promise<void> => {
    clearTimeout(autosave);
    // `?play=<url>` lets a game point Play at its own runtime (for example, its dev server).
    const target = new URLSearchParams(location.search).get('play') ?? '../examples/adventure/';
    if (await save()) window.open(new URL(target, location.href).href, 'ragnagrok-play');
  };

  const repaint = (): void => {
    $('toolbar').replaceChildren(
      button('New project', newProject),
      button('Open…', () => void open(), false, 'Ctrl+O · .json files, also in the legacy Spanish format'),
      button('Save', () => void save(), false, `Ctrl+S · ${store === 'disk' ? 'writes the project file' : 'browser storage (also autosaved)'}`),
      button('Save as…', () => void saveAs(), false, 'Ctrl+Shift+S · download a .json copy'),
      button('Play', () => void play(), false, new URLSearchParams(location.search).has('play') ? 'Saves and opens the project in your game' : 'Saves and opens the project in the adventure player'),
      h('span', { class: 'gap' }),
      button('Voxels', () => switchTab('voxels'), current === 'voxels'),
      button('Scene', () => switchTab('scene'), current === 'scene'),
      button('Animation', () => switchTab('animation'), current === 'animation'),
      h('span', { class: 'gap' }),
      button('Undo', () => c.undo(), false, 'Ctrl+Z'),
      button('Redo', () => c.redo(), false, 'Ctrl+Y or Ctrl+Shift+Z'),
      h('span', { id: 'status' }, status),
    );
    const left = $('left');
    const right = $('right');
    left.replaceChildren();
    right.replaceChildren();
    tabs[current].panels(left, right);
    $('hint').textContent = tabs[current].hint;
  };

  const switchTab = (t: TabName): void => {
    tabs[current].exit();
    current = t;
    orbit.enabled = true;
    tabs[current].enter();
    repaint();
  };

  c.repaint = repaint;
  c.refreshTab = () => tabs[current].refresh();

  const resize = (): void => {
    const box = $('center').getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(Math.max(1, box.width), Math.max(1, box.height), false);
    camera.aspect = box.width / Math.max(1, box.height);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe($('center'));
  resize();

  const ray = new THREE.Raycaster();
  const cast = (ev: PointerEvent): THREE.Raycaster => {
    const box = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(((ev.clientX - box.left) / box.width) * 2 - 1, -((ev.clientY - box.top) / box.height) * 2 + 1),
      camera,
    );
    return ray;
  };
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.focus();
    canvas.setPointerCapture(ev.pointerId);
    tabs[current].pointer?.('down', ev, cast(ev));
  });
  canvas.addEventListener('pointermove', (ev) => tabs[current].pointer?.('move', ev, cast(ev)));
  canvas.addEventListener('pointerup', (ev) => tabs[current].pointer?.('up', ev, cast(ev)));
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  window.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA';
    const ctrl = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (ctrl && key === 's') {
      ev.preventDefault();
      if (ev.shiftKey) void saveAs();
      else void save();
    } else if (ctrl && key === 'o') {
      ev.preventDefault();
      void open();
    } else if (typing) {
      return;
    } else if (ctrl && key === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) c.redo();
      else c.undo();
    } else if (ctrl && key === 'y') {
      ev.preventDefault();
      c.redo();
    } else if (!ctrl && !ev.altKey && tabs[current].key?.(ev)) {
      ev.preventDefault();
    }
  });
  window.addEventListener('beforeunload', (ev) => {
    if (store === 'disk' && c.unsaved) ev.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && store === 'browser' && c.unsaved) {
      clearTimeout(autosave);
      void save();
    }
  });

  tabs[current].enter();
  repaint();
  if (!loaded.project && store === 'browser') void save().then(() => setStatus('Started a new project'));

  let previous = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    tabs[current].frame?.(dt);
    renderer.render(scene, camera);
  });

  if (import.meta.env.DEV) {
    Object.assign(window, {
      __editor: {
        c,
        tabs,
        store,
        switchTab,
        save,
        json: () => projectJson(c.project),
        countCells: (id: string) => {
          const m = c.project.models.find((x) => x.id === id);
          return m ? gridOf(m).cells.reduce((n, v) => n + (v ? 1 : 0), 0) : -1;
        },
      },
    });
  }
  document.body.dataset.ready = '1';
}

main().catch((e: unknown) => {
  const el = $('error');
  el.style.display = 'grid';
  el.textContent = `The editor could not start.\n\n${String(e)}`;
});
