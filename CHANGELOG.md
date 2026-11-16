# Changelog

## 0.3.0

Three new modules for a kids' programming book built on the engine, and the hooks it asked for.

- **blocks** (new, `ragnagrok-engine/blocks`): a block language for kids, pure TypeScript. Programs
  are JSON trees (repeat, repeat until, if / else, procedures with parameters, variables,
  arithmetic, comparisons, events) run by a step interpreter that reports a trace and Spanish
  error messages. Three worlds: a grid (robot, items, lamps, paint, arrows, walls, custom level
  actions), a drawing turtle and a tick-based realtime arena with scripted actors. Levels are JSON
  with toolboxes, block budgets, variants, seeded random boards, goals and requirements, checked by
  `check()`; `palette()` lists the blocks an editor offers. See `src/blocks/README.md`.
- **blocks-ui** (new): `BlockEditor`, a touch-friendly DOM editor for that language (drag, tap or
  keyboard), with live block count, run highlighting, error bubbles, undo and themes.
- **blocks-3d** (new): `BoardView`, which renders and animates grid, turtle and realtime worlds in
  voxels from traces, with skins (`defaultSkin`, `extendSkin`) for each game's look.
- **kit**: `Director<L>` is generic over the line type, like `Dialogue<L>`.
- **audio**: `GameAudio` takes `storedNames`, to keep the sound level under the game's own words
  in `localStorage`.
- **blocks**: fixed `directionTo`: something below is `S` (y grows down).
- **blocks**: preset blocks with open slots. A toolbox argument `null` leaves that slot open, and
  `operators` take presets: `{ "op": "/", "args": [360, null] }` is a ready-made `360 ÷ ( )` whose
  360 is fixed. Presets without a `label` write their fixed values into the block's label
  (`Mover →`, `360 ÷ {1}`). New exports: `OperatorEntry`, `PresetArg`, `operatorName`,
  `matchesPreset`, `presetLabel`; `PaletteEntry.args` may hold `null`.
- **blocks-ui**: operator and command presets with fixed and open slots: the fixed part shows as
  text and the model refuses to edit it (`Refusal` `'fixed'`); open slots start as holes.
  `Schema.labelOf()` also returns `fixed`; new `Schema.presetOf()` and `Schema.isFixed()`.
- **blocks**: documented that `touching(kind)` is the "am I touching it now" question (never used
  up) and `touched(kind)` the once-per-contact one.
- **blocks-3d**: follow camera for long boards. `CameraMode` `'auto' | 'follow' | 'frame'` from
  `ResetOptions.camera`, `level.meta.camera` (or the Spanish `meta.camara: 'sigue' | 'fija'`,
  read by `cameraModeOf`) or `BoardViewOptions.camera`. `auto` (the default) follows when the
  whole board would show cells under `followBelowPx` (28 CSS px). The view shows the whole board
  at reset and at the end, and eases to a closer view (`followCellPx`) that pans with the
  character, clamped to the board, while a run plays or a realtime game runs. `BoardView`
  `cameraMode`, `follows`, `shot` and `showShot()`; framing helpers `followBox`,
  `pixelsPerMeter`, `distanceForPixels`. Fog now follows the camera distance, so big boards are
  no longer washed out.
- **blocks-3d**: level actions pose their own clips: `CharacterVisual.pose(clip, t, info)` gets
  `info.action` (and `args`) with the `action` clip, so a skin plays `eat`, `sing` or `kick`
  (`PoseInfo`). `figureCharacter` and `FigureSpec` take `actions: { eatApple: 'chew' }` and also
  use a clip named like the action; otherwise `action`, as before.
- **blocks-3d**: `extendSkin` removes entries set to `null` and drops whole default tables with
  `replace: ['items', …]` (also in `mergeSkin`; `SkinTable`). The order of `Environment.decor`
  is documented: entries 0 and 1 go only behind the board, 2 and 3 all around it.
- **blocks-3d**: `BoardView.setEnvironment(env)` changes sky, sea, sand, light and decor live, and
  the `environment` getter reads them. The `decor: false` option now works.
- **blocks-3d**: `Environment.backdrop(board)`: one-off scenery (a moon and its path on the sea,
  star glints) built once per environment and board size, placed with its origin at the middle of
  the board's far edge at sea level, replaced by `setEnvironment` (`BackdropContext`).
- **render**, **blocks-3d**: `View.dispose()` and `BoardView.destroy()` release the WebGL context
  (`forceContextLoss`), so hosts can create and destroy many views; pass
  `{ loseContext: false }` to keep a canvas usable.

## 0.2.0

Hooks that games asked for while moving onto the engine (Nullgard and casa-voxel).

- **audio**: `Sfx` can be extended. `engine`, `ctx`, `output()` and `send()` are now `protected`, so
  a subclass builds its own sounds with the same routing (bus, pan, reverb and echo sends) as the
  built-in effects.
- **audio**: `GameAudio<S>` takes an `sfx` factory to use your own `Sfx` subclass (returned by
  `play()` and the new `sfx` getter), `addScheduler()` to run extra sound sources (for example a
  second `Playback` on a filtered bus) in its loop, and a `state` getter with the context state.
- **kit**: `Dialogue<L>` is generic over the line type, and the new `present` option derives each
  line's speaker label and style, so a game can keep its own line shape.
- **render**: `buildScene` also returns `room` and `instances` (one holder per instance, in order).
  The editor uses them instead of relying on the order of `group.children`.
- **render**: `VoxelMesh` takes `{ cutY }` in its constructor, so a cut mesh is built once.
- **editor**: `/editor/?play=<url>` opens your own game from Play; the editor no longer asks for the
  dev disk API on the published site.

## 0.1.0

First public release: core, render, audio, kit, paint, the editor and the examples.
