# Ragnagrok Engine

Public, MIT-licensed voxel engine for the web, extracted from two games of the user (casa-voxel and
Nullgard). Code, comments and identifiers in English; README in English and Spanish (`README.md`,
`README.es.md`).

    src/core/    pure: project format, voxel grids, animation, collision and pathfinding. No DOM, no three.js
    src/render/  three.js: voxel meshing, scenes, rigged figures, the view with postprocessing
    src/audio/   Web Audio: synth engine, instruments, music theory helpers, step sequencer, ambience
    src/kit/     game helpers: touch joystick, dialogue box, cutscene director, actor, save slots
    src/paint/   procedural voxel painting (shapes, noise) that produces Models
    src/blocks/  pure: kids' block language, interpreter, grid/turtle/realtime worlds, levels and check()
    editor/      the browser editor (models, figures and animation, scenes)
    examples/    small original demos

- Everything here is generic and original. No game content (stories, characters, maps, music) from
  Nullgard or casa-voxel, and nothing from other games.
- `GLOSSARY.md` maps the old Spanish names to the new ones; keep it in sync when renaming.
- Simulation helpers are deterministic: no `Math.random()` or clocks in `src/core` or `src/blocks`.

Before saying something works: `npm test`, `npm run typecheck`, `npm run build`, and look at the
screenshots from `tools/` when the editor or rendering changed. In WSL, headless Chromium uses the
real GPU with `--use-angle=gl-egl`.

Commits in Spanish, imperative, no agent co-authorship unless asked (the user's convention).
