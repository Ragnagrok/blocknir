import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrateLegacyProject } from './migrate.js';
import { gridOf, validate } from './project.js';
import { createGrid, encodeGrid, setCell } from './voxel.js';

/** A real project from the editor, before the translation. Private, so only present on its author's machine. */
const LEGACY_FILE = process.env.LEGACY_PROJECT ?? fileURLToPath(new URL('../../../casa-voxel/proyecto/actual.json', import.meta.url));

function legacyFixture(): unknown {
  const room = createGrid(4, 2, 4);
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) setCell(room, x, 0, z, 1);
  const lamp = createGrid(1, 1, 1);
  setCell(lamp, 0, 0, 0, 2);
  return {
    version: 1,
    nombre: 'Fixture',
    escenaInicial: 'hall',
    modelos: [
      { id: 'room', nombre: 'Room', tam: [4, 2, 4], escala: 0.5, paleta: [0, 0x777777], emisivos: [], cerrado: true, datos: encodeGrid(room) },
      { id: 'lamp', nombre: 'Lamp', tam: [1, 1, 1], escala: 0.1, paleta: [0, 0, 0xffcc88], emisivos: [2], cerrado: false, datos: encodeGrid(lamp) },
    ],
    figuras: [
      {
        id: 'hero',
        nombre: 'Hero',
        partes: [
          { id: 'body', modelo: 'lamp', padre: null, pivote: [0, 1, 0], origen: [0, 0, 0] },
          { id: 'head', modelo: 'lamp', padre: 'body', pivote: [0, 0.5, 0], origen: [0, 0, 0] },
        ],
        clips: [{ nombre: 'idle', duracion: 1, bucle: true, claves: [{ t: 0, rot: { head: [0, 0.2, 0] } }] }],
        faro: { parte: 'head', pos: [0, 0.1, 0.2], color: 0xffaa55, intensidad: 2, alcance: 4 },
      },
    ],
    escenas: [
      {
        id: 'hall',
        nombre: 'Hall',
        sala: 'room',
        instancias: [{ id: 'i1', modelo: 'lamp', pos: [1, 0.5, 1], rot: 2, solido: false }],
        camaras: [{ id: 'c1', nombre: 'Main', pos: [0, 2, 0], mira: [1, 0, 1], fov: 50, zona: { min: [0, 0], max: [2, 2] } }],
        luces: [
          { id: 'l1', nombre: 'Bulb', tipo: 'punto', pos: [1, 1, 1], mira: [1, 0, 1], color: 0xffffff, intensidad: 3, alcance: 5, angulo: 0.5, sombra: true, parpadeo: 0.2 },
          { id: 'l2', nombre: 'Moon', tipo: 'foco', pos: [3, 3, 3], mira: [1, 0, 1], color: 0x8899ff, intensidad: 10, alcance: 9, angulo: 0.4, sombra: false, parpadeo: 0 },
        ],
        entidades: [
          { id: 'start', tipo: 'jugador', nombre: 'Hero', pos: [1, 0.5, 1], rumbo: 1.5, figura: 'hero' },
          { id: 'ghost', tipo: 'criatura', nombre: 'Ghost', pos: [1.5, 0.5, 1.5], rumbo: 0, figura: 'hero' },
          { id: 'key', tipo: 'item', nombre: 'Key', pos: [0.5, 0.5, 0.5], rumbo: 0, modelo: 'lamp' },
          { id: 'note', tipo: 'nota', nombre: 'Note', pos: [0.5, 0.5, 1.5], rumbo: 0, texto: 'Hello' },
          {
            id: 'door',
            tipo: 'puerta',
            nombre: 'Door',
            pos: [1.9, 0.5, 1],
            rumbo: 0,
            texto: 'It opens',
            requiere: 'Key',
            textoCerrado: 'Locked',
            destino: 'hall',
            entrada: 'start',
          },
        ],
        ambiente: { color: 0x223344, intensidad: 0.5 },
        niebla: { color: 0x050505, densidad: 0.04 },
      },
    ],
  };
}

describe('migrateLegacyProject', () => {
  it('renames every key and kind', () => {
    const p = migrateLegacyProject(legacyFixture());
    expect(validate(p)).toEqual([]);
    expect(p.name).toBe('Fixture');
    expect(p.startScene).toBe('hall');
    expect(p.models[1]).toMatchObject({ id: 'lamp', name: 'Lamp', size: [1, 1, 1], scale: 0.1, emissive: [2], closed: false });
    expect(gridOf(p.models[0]!).cells.filter((c) => c === 1).length).toBe(16);
    expect(p.figures[0]!.parts[1]).toEqual({ id: 'head', model: 'lamp', parent: 'body', pivot: [0, 0.5, 0], origin: [0, 0, 0] });
    expect(p.figures[0]!.clips[0]).toEqual({ name: 'idle', duration: 1, loop: true, keys: [{ t: 0, rot: { head: [0, 0.2, 0] } }] });
    expect(p.figures[0]!.lantern).toEqual({ part: 'head', pos: [0, 0.1, 0.2], color: 0xffaa55, intensity: 2, range: 4 });

    const s = p.scenes[0]!;
    expect(s.room).toBe('room');
    expect(s.instances[0]).toEqual({ id: 'i1', model: 'lamp', pos: [1, 0.5, 1], rot: 2, solid: false });
    expect(s.cameras[0]).toEqual({ id: 'c1', name: 'Main', pos: [0, 2, 0], target: [1, 0, 1], fov: 50, zone: { min: [0, 0], max: [2, 2] } });
    expect(s.lights.map((l) => l.kind)).toEqual(['point', 'spot']);
    expect(s.lights[0]).toMatchObject({ target: [1, 0, 1], intensity: 3, range: 5, angle: 0.5, shadow: true, flicker: 0.2 });
    expect(s.entities.map((e) => e.kind)).toEqual(['player', 'creature', 'item', 'note', 'door']);
    expect(s.entities[0]).toEqual({ id: 'start', kind: 'player', name: 'Hero', pos: [1, 0.5, 1], heading: 1.5, figure: 'hero' });
    expect(s.entities[4]).toMatchObject({ text: 'It opens', requires: 'Key', lockedText: 'Locked', destination: 'hall', entry: 'start' });
    expect(s.ambient).toEqual({ color: 0x223344, intensity: 0.5 });
    expect(s.fog).toEqual({ color: 0x050505, density: 0.04 });
  });

  it('rejects what is not a legacy project', () => {
    expect(() => migrateLegacyProject(null)).toThrow();
    expect(() => migrateLegacyProject({ models: [], figures: [], scenes: [] })).toThrow();
    const bad = legacyFixture() as { escenas: { entidades: { tipo: string }[] }[] };
    bad.escenas[0]!.entidades[0]!.tipo = 'dragon';
    expect(() => migrateLegacyProject(bad)).toThrow(/dragon/);
  });

  it.skipIf(!existsSync(LEGACY_FILE))('migrates a real editor project', () => {
    const json = JSON.parse(readFileSync(LEGACY_FILE, 'utf8')) as { modelos: unknown[]; figuras: unknown[]; escenas: unknown[] };
    const p = migrateLegacyProject(json);
    expect(validate(p)).toEqual([]);
    expect(p.models.length).toBe(json.modelos.length);
    expect(p.figures.length).toBe(json.figuras.length);
    expect(p.scenes.length).toBe(json.escenas.length);
    for (const m of p.models) expect(gridOf(m).cells.length).toBe(m.size[0] * m.size[1] * m.size[2]);
  });
});
