import { flushGrids, migrateLegacyProject, type Project } from '../src/core/index.js';

/**
 * Where projects live, with no backend required:
 *
 * - `disk`: the dev server's `/api/project` (only when `npm run dev` runs with `PROJECT=<file.json>`,
 *   see vite.config.ts). Saved by hand (Ctrl+S), with rotating backups on disk.
 * - `browser`: IndexedDB in this browser, autosaved after every change. Falls back to localStorage
 *   when IndexedDB is unavailable (private windows in some browsers).
 *
 * The adventure example reads from the same place, so "Play" shows what the editor is working on.
 */
export type Store = 'disk' | 'browser';

const API = '/api/project';
const DB_NAME = 'ragnagrok-engine';
const DB_STORE = 'projects';
const DB_KEY = 'current';
const LOCAL_KEY = 'ragnagrok-engine:project';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Accepts a project in the current format or in the legacy Spanish one (`modelos`, `escenas`...). */
export function parseProject(json: unknown): Project {
  if (!isObject(json)) throw new Error('A project must be a JSON object');
  if ('modelos' in json || 'escenas' in json) return migrateLegacyProject(json);
  for (const key of ['models', 'figures', 'scenes']) {
    if (!Array.isArray(json[key])) throw new Error(`Not a project: "${key}" must be an array`);
  }
  if (typeof json.startScene !== 'string') throw new Error('Not a project: "startScene" must be a string');
  return { ...(json as unknown as Project), version: 1, name: typeof json.name === 'string' ? json.name : 'Untitled' };
}

/** The savable text of a project (writes in-memory voxel edits back first). */
export function projectJson(p: Project): string {
  flushGrids(p);
  return JSON.stringify(p);
}

/**
 * Asks the dev server for the project. `undefined`: there is no project API (static hosting, or the
 * dev server without `PROJECT`). `null`: the API is there but its file does not exist yet.
 */
export async function loadFromDisk(): Promise<Project | null | undefined> {
  let r: Response;
  try {
    r = await fetch(API, { cache: 'no-store' });
  } catch {
    return undefined;
  }
  if (r.status === 204) return null;
  // Static hosts and Vite's SPA fallback answer unknown paths with HTML: that is not the API.
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return undefined;
  // The API is there: a broken file is an error to show, not a reason to quietly use another store.
  try {
    return parseProject(await r.json());
  } catch (e) {
    throw new Error(`The project file served by /api/project could not be read: ${String(e)}`);
  }
}

export async function saveToDisk(p: Project): Promise<void> {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: projectJson(p) });
  if (!r.ok) throw new Error(await r.text());
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed to open'));
  });
}

async function dbRequest<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = run(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/** The project saved in this browser, or null when there is none. */
export async function loadFromBrowser(): Promise<Project | null> {
  let text: unknown = null;
  try {
    text = await dbRequest('readonly', (s) => s.get(DB_KEY));
  } catch {
    // No IndexedDB: try localStorage below.
  }
  if (typeof text !== 'string') {
    try {
      text = localStorage.getItem(LOCAL_KEY);
    } catch {
      text = null;
    }
  }
  return typeof text === 'string' ? parseProject(JSON.parse(text)) : null;
}

export async function saveToBrowser(p: Project): Promise<void> {
  const text = projectJson(p);
  try {
    await dbRequest('readwrite', (s) => s.put(text, DB_KEY));
    try {
      localStorage.removeItem(LOCAL_KEY);
    } catch {
      // Nothing to clean up.
    }
    return;
  } catch {
    // Fall back to localStorage (a few MB at most: big projects may not fit).
  }
  try {
    localStorage.setItem(LOCAL_KEY, text);
  } catch (e) {
    throw new Error(`This browser could not store the project (${String(e)}). Use “Save as…” to keep a copy.`);
  }
}

/** The project the editor is working on, wherever it is. Null when there is none yet. */
export async function loadCurrentProject(): Promise<{ project: Project | null; store: Store }> {
  const disk = await loadFromDisk();
  if (disk !== undefined) return { project: disk, store: 'disk' };
  return { project: await loadFromBrowser(), store: 'browser' };
}

export async function saveCurrentProject(p: Project, store: Store): Promise<void> {
  if (store === 'disk') await saveToDisk(p);
  else await saveToBrowser(p);
}

/** Lets the user pick a .json file and returns the project in it (null if cancelled). */
export function openProjectFile(): Promise<{ project: Project; file: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => resolve({ project: parseProject(JSON.parse(text)), file: file.name }))
        .catch(reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

interface SaveFilePicker {
  showSaveFilePicker?(options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

/** Saves a copy as a .json file: a native "Save as" dialog where supported, a download elsewhere. */
export async function saveProjectFile(p: Project): Promise<'saved' | 'downloaded' | 'cancelled'> {
  const blob = new Blob([projectJson(p)], { type: 'application/json' });
  const name = `${(p.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'}.json`;
  const picker = (window as unknown as SaveFilePicker).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: name,
        types: [{ description: 'Ragnagrok Engine project', accept: { 'application/json': ['.json'] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return 'saved';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // Not allowed here (an iframe, for instance): download instead.
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}
