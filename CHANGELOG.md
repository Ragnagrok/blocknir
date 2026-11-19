# Changelog

## Unreleased

- **blocks-ui**: three ways for stacked blocks to join (`Joints`): `stack` (the default), a compact
  pile with no tabs; `thread`, blocks apart on a line with a dot each, which shows the order;
  `link`, blocks apart joined by a dark connector. `BlockEditorOptions.joints`,
  `editor.joints`/`setJoints()`, `StaticBlocksOptions.joints`, and `jointsPicker: true` adds a
  button to the bar to choose (event `joints`; texts `jointsMenu`, `jointsTitle`, `joints`).
  Each one keeps a single spacing: above, between and below the blocks inside a C as between
  blocks.
- **blocks-ui**: while a Si or a Repetir hasta que asks its question, the question lights up, not
  the whole block (a question's slot glows around its shape).

## 0.3.7

Back to the blocks of 0.3.4.

- **blocks-ui**: back to the 0.3.4 look: stacked blocks with a little space between them and no
  notches. The fitted look (0.3.5, 0.3.6) read worse.

## 0.3.6

Cleaner joints between blocks.

- **blocks-ui**: smoother joints. The tab covers the block's darker bottom edge where it starts and
  carries that edge itself, so block and tab read as one piece; a block's paint reaches 1px under
  the block above, so no hairline of background shows between blocks on half pixels; the hat's
  bottom corners match the blocks under it.
- **blocks-ui**: fixed: the "next block" caret inside a C block overlapped the C's foot.

## 0.3.5

Blocks that fit together.

- **blocks-ui**: blocks fit together. Stacked blocks touch, with a tab under each one that sits in
  the notch on top of the next (also in the palette and in `renderProgram`); a C block's arm, top
  and foot hug the blocks inside, with their own tab and notches. The notch is cut from a paint
  layer under the block, so the running, selected and error outlines keep their shape. CSS
  variables `--rbk-tab-x`, `--rbk-tab-w`, `--rbk-tab-h`, `--rbk-tab-in`, `--rbk-arm`,
  `--rbk-corner`.

## 0.3.4

Variables that say what they hold.

- **blocks**: typed variables. `Program.variableTypes` (optional) says what each variable holds (a
  number, a word: `name`, or true or false); a `set` with a value of another type stops with
  `varType` (`'varType:name'` reads "guarda una palabra"). Programs without it work as before.
- **blocks-ui**: creating a variable asks what it holds (`variableTypeTitle`, `variableTypes`);
  the variable picker shows each one's type (`puntos · número`) and can change it
  (`variableTypeMenu`, `EditorModel.setVariableType`, refused with `counted` while blocks add to
  it). `set` offers values of the variable's type, the reporter fits only where its type goes and
  `change` / `subtract` only use numbers. `addVariable(name, type?)`, `Schema.variableType`,
  `variableTypes`, `setValue`, `countable`.

## 0.3.3

Realtime games make room for their characters too.

- **blocks-3d**: realtime games make room too. Items standing on arena tiles slide to a corner of
  their cell while a walking actor (the player or another, not a flying one or a shot) goes
  through, and slide back after it. `roomFor(dx, dz, away?)` is the rule both boards share; it is
  exported now, with `asideSlots` and `Room` (named in 0.3.2 but missing from the index).

## 0.3.2

Objects that make room for the robot, and procedures whose parameters say what goes in them.

- **blocks-3d**: items make room for the grid character. While it stands on a cell (or walks in),
  the standing items slide to the cell's corners, away from the side it came in from, and a bit
  smaller, so a tall lamp no longer stands inside the robot; they slide back when it leaves. Picks
  and drops fly from and to where the item really stands. `ItemDef.stay` keeps an item in place
  (a hammock the character lies in). `layoutCell(entries, maxCopies, room)`, `asideSlots`, `Room`.
- **blocks**: typed procedure parameters. `Procedure.types` (optional, parallel to `params`) says
  what each one takes, like a command's slots (`{ type: 'direction' }`, `{ type: 'name', name:
  'item' }`). A call with a value of another type stops with `argType`.
- **blocks-ui**: adding a parameter asks what goes in it, among the types the level's blocks use
  (`Schema.paramTypes()`: a number, a direction, an item, a color…, true or false when there are
  conditions); its menu can change it (`EditorModel.setParamType`). The call's slot starts with a
  value of that type and offers that type's values; the parameter fits only where that type goes,
  and its chip shows the type (`hacia · dirección`). `addParam(id, name, type?)`, `paramSpecOf`,
  `paramTypeName`, `Schema.program`, `Schema.callArg`; texts `paramTypeMenu`, `paramTypeTitle`,
  `paramTypes`. Programs without `types` work as before.

## 0.3.1

What the kids' book asked for on phones, in quizzes and in playback.

- **blocks-ui**: on narrow screens the palette shows one group at a time: the category chips work
  as tabs (and wrap), and the group's blocks wrap to the next line. No block is cut at the edge of
  a sideways strip any more. A palette block follows the finger at once (`touch-action: none`);
  the palette takes at most about a third of the editor (`--rbk-pal-max`).
- **blocks-ui**: `renderProgram(level, program)` and `renderStatement(level, statement)` draw
  programs as read-only pictures that look like the editor's blocks, without palette or bar, for
  quizzes and printouts (`size: 'small'`, `hat: false`).
- **blocks-3d**: lasting poses. `PoseInfo.inventory` carries what the grid robot holds on every
  clip, and `figureCharacter(…, { rest: { lying: 'lieDown' } })` keeps a clip for `idle` while the
  robot holds that item: a character lying in a hammock no longer stands up between two actions.
  `Mover.rest` holds what lasts between clips.
- **blocks-3d**: tiny boards (2 × 1, 4 × 1) are framed closer (`minExtent` 1.5 m instead of 3).
- **blocks-ui**: a terrain slot (`terrainIs`) offers the terrains on the board when the toolbox gives
  no `choices.names`.
- **blocks-3d**: smoother playback, no odd frames.
  - `Mover` blends each new clip in from the pose on screen (`blend`, 0.14 s; `cut()` skips it on
    a reset), so going from walk to idle to light no longer snaps the limbs in one frame.
  - A level action that moves the robot (`goTo`, jumps) no longer shows it at the target cell for
    a few frames before the jump starts from the old one.
  - The robot turns toward where it walks smoothly, with no snap at the end of the turn.
  - `cheer` keeps a lasting pose too: a character that wins asleep in the hammock stays lying.
  - Realtime games: a character walking on from tick to tick keeps its pace and its walk clip,
    instead of stopping and flashing idle at every cell.

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
