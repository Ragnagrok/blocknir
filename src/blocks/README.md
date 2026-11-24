# blocknir/blocks

A block-based programming language for kids, its interpreter, and the worlds programs run in.
Pure TypeScript: no DOM, no three.js, no clocks, no `Math.random()` (randomness comes from seeds).
Programs, levels, traces and states are plain JSON.

```ts
import { blocks, check, runCase, palette, type GridLevel } from 'blocknir/blocks';
```

Three kinds of code use this module:

- an **editor** builds `Program` trees, offers the blocks from `palette(level)`, and highlights the
  block that runs or fails (`TraceStep.node`, `RunError.nodeId`);
- a **renderer** animates a run from its trace (`TraceStep.events`) or from per-step snapshots;
- **level authors** write `Level` JSON: a world, a toolbox, boards or trials, and a goal.

## Contents

- [Coordinates and values](#coordinates-and-values)
- [Programs (the AST)](#programs-the-ast)
- [Toolboxes, block keys and counting](#toolboxes-block-keys-and-counting)
- [Labels](#labels)
- [Running and the trace](#running-and-the-trace)
- [Grid world](#grid-world)
- [Turtle world](#turtle-world)
- [Realtime world](#realtime-world)
- [Levels and check()](#levels-and-check)
- [For editors](#for-editors) · [For renderers](#for-renderers) · [Limits and decisions](#limits-and-decisions)

## Coordinates and values

- Grid and realtime boards are **screen-like**: `x` grows to the right, `y` grows **down**, `(0, 0)`
  is the top-left cell. Directions are `'N' | 'E' | 'S' | 'W'` = up, right, down, left (labels show
  them as `↑ → ↓ ←`).
- In board specs, a **negative coordinate counts from the far side**: `x: -1` is the last column,
  `y: -1` the bottom row. That keeps levels valid when the board size varies.
- The turtle uses the same axes; headings are degrees **clockwise from east** (0 →, 90 ↓, 180 ←,
  270 ↑), so `turnRight` (`Girar ↻`) adds degrees.
- A `Value` is `number | boolean | string`. Directions are the strings above; any other string is a
  *name* (item, color, key, sound, look, text).

## Programs (the AST)

Every node has a stable `id` (unique in the program). Keep ids across edits; the interpreter reports
them for highlighting and errors. `ensureIds(program)` fills missing or repeated ids in imported JSON.

```jsonc
{
  "main": [                                   // the stack under "Al tocar Ejecutar"
    { "id": "1", "kind": "repeat", "times": { "id": "2", "kind": "number", "value": 3 }, "body": [
      { "id": "3", "kind": "call", "procedure": "step", "args": [] }
    ]}
  ],
  "procedures": [                             // "Enseñar …" definitions
    { "id": "4", "name": "step", "params": [], "body": [
      { "id": "5", "kind": "command", "command": "move", "args": [{ "id": "6", "kind": "direction", "value": "E" }] },
      { "id": "7", "kind": "if",
        "condition": { "id": "8", "kind": "sensor", "sensor": "itemHere", "args": [{ "id": "9", "kind": "name", "value": "lamp" }] },
        "then": [{ "id": "10", "kind": "command", "command": "lightLamp", "args": [] }] }
    ]}
  ],
  "handlers": []                              // realtime worlds only
}
```

Statements (`Statement`):

| kind | fields | block |
|---|---|---|
| `command` | `command`, `args: Expr[]` | a world command or level action |
| `call` | `procedure` (name), `args` | a user procedure |
| `repeat` | `times: Expr`, `body` | Repetir ( ) veces |
| `repeatUntil` | `until: Expr`, `body` | Repetir hasta que … (checked before each round) |
| `if` | `condition`, `then`, `else?` | Si … / Si … Si no … (`else` present = if/else block) |
| `set` | `variable`, `value` | Fijar … en ( ) |
| `change` | `variable`, `by`, `op?: '+' \| '-'` | Sumar ( ) a … / Restar ( ) a … |
| `wait` | `ticks` | Esperar ( ) (realtime pause; a visible no-op in step worlds) |

Expressions (`Expr`): literals `number`, `boolean`, `direction`, `name` (slot values, not blocks);
`param` (a procedure parameter), `var`, `sensor` (`sensor`, `args`), `arith` (`+ - * / %`),
`compare` (`= != < <= > >=`), `and`, `or`, `not`, `dirOp` (`opposite`, `left`, `right`).

`Procedure { id, name, params: string[], types?, body }`. Procedures may call each other and recurse.
`types` (optional, parallel to `params`) says what each parameter takes, like a command's slots:
`[{ type: 'direction' }, { type: 'name', name: 'item' }]`. Editors offer values of that type in
the call's slots (`blocks-ui`: `Schema.paramTypes()` lists the ones a level's blocks use, and
`EditorModel.addParam(id, name, type)` / `setParamType`); a call that passes a value of another
type stops with `argType`. Without `types`, parameters take anything.
`Handler { id, event, body }` with `event` one of `{type:'start'}`, `{type:'key', key}`,
`{type:'tick', every?}`, `{type:'touch', what}` (an actor kind or a tile name).

Semantics worth knowing:

- Variables are global to a program (step worlds) or per actor (realtime, except the level's shared
  `variables` such as `points`, `lives`). `change` on a missing variable starts it at 0; reading a
  variable never set is an error.
- `Program.variableTypes` (optional) says what each variable holds: `{ points: 'number', greeting:
  'name', done: 'boolean' }` (`name` is a word). A `set` with a value of another type stops with
  `varType`; variables without a type hold anything. In `blocks-ui`, `EditorModel.addVariable(name,
  type)` and `setVariableType`; `Schema.variableType(name)` (a realtime level's shared numbers count
  as numbers), `Schema.variableTypes()`, and `change` only uses numbers.
- `=` compares any values (numbers with a 1e-9 tolerance); `<` and friends need numbers. `/` is
  real division (`360 / 7` works); `%` is always non-negative.
- In code, `blocks()` builds nodes with sequential ids:
  `b.program([b.repeat(3, b.cmd('move', 'E'))], [b.proc('p', ['n'], ...)])`. Strings `'N' 'E' 'S' 'W'`
  become directions; use `b.name('E')` for a letter E.

## Toolboxes, block keys and counting

A **block key** names a kind of block (`blockKey(node)`): a command or sensor name, `call`,
`procedure`, `repeat`, `repeatUntil`, `if`, `ifElse`, `set`, `change`, `subtract`, `wait`, `var`,
`param`, an operator (`+`, `=`, `and`, `or`, `not`, `opposite`…), or `event.start|key|tick|touch`.
Toolboxes and label tables use these keys.

```jsonc
"toolbox": {
  "commands": [
    { "name": "move", "args": ["N"], "label": "Mover ↑" },   // a preset: fixed arguments, own label
    { "name": "move", "args": ["E"], "label": "Mover →" },
    "lightLamp"                                              // a name: any arguments
  ],
  "sensors": [{ "name": "itemHere", "args": ["lamp"], "label": "¿Hay farol?" }],
  "control": ["repeat", "repeatUntil", "if", "ifElse", "wait"],
  "operators": ["or", "=", { "op": "/", "args": [360, null] }],     // `360 ÷ ( )`: 360 fixed, one hole
  "procedures": true, "parameters": true, "variables": true,
  "events": ["start"],
  "choices": { "directions": ["N", "E", "S", "W"], "names": ["red", "blue"], "keys": ["left", "right"] },
  "par": 8, "parScope": "main", "strictPar": false
}
```

- Presets are how the book's one-purpose blocks (`¿Hay manzana?`, `Mover ↑`, `Pintar`) are made:
  a program may only use that command with exactly those literal arguments.
- An argument `null` leaves that slot **open**: the preset fixes the other arguments and the child
  fills the hole. Operators take presets too, as `{ "op", "args", "label" }`: `{ "op": "/", "args":
  [360, null] }` is a ready-made `360 ÷ ( )` reporter (the `360` is fixed and not editable; the
  divisor is a hole for, say, the `lados` parameter). A program may then divide only 360 by
  something, unless the plain `"/"` is offered too (then the editor shows an ordinary `÷` block).
  Works for any operator: `{ "op": "=", "args": [null, 3] }`, `{ "op": "not" }`.
- A preset's `label` shows only the open slots (`"360 ÷ {1}"`: slot numbers are the operator's,
  `{0}` left, `{1}` right). Without a label, the block's label is used with each fixed value written
  in: `{ "name": "move", "args": ["E"] }` is `Mover →`, `{ "op": "/", "args": [360, null] }` is
  `360 ÷ {1}`. A label without `{1}` for an open slot still gets the slot, at the end.
- `countBlocks(program, scope)`: every statement and reporter counts 1, literals count 0 (a
  `Repetir 30 veces` with one block inside is 2). `parScope: 'main'` (the default) counts only the
  main stack and handler bodies, not procedure definitions; `'all'` counts everything, each
  definition and handler hat as 1.
- `analyze(program, catalog, toolbox)` finds blocks outside the toolbox, unknown names, wrong slot
  counts, repeated ids and procedure names, without running anything.

## Labels

All text shown to children is data (`Labels`): block templates (`labels.blocks[key]`, with `{0}`,
`{1}` slots and `{var}` / `{name}`), direction and name tables, error messages
(`labels.errors[code]`, with an optional `code:key` override such as `wall:water` or
`actionFailed:openChest`), goal reasons (`labels.goals`), and `check()` messages.

`DEFAULT_LABELS` plus `GRID_LABELS`, `TURTLE_LABELS`, `REALTIME_LABELS`, `GRID_GOAL_LABELS` and
`REQUIREMENT_LABELS` give a Spanish (Río de la Plata) default that follows the book's vocabulary
(`Mover {0}`, `Encender farol`, `Repetir {0} veces`, `Avanzar {0} pasos`, `Girar ↻ {0} grados`,
`Levantar tiza`, `¿Botón {0} apretado?`, `Fijar {var} en {0}`…). `labelsFor(level)` merges
everything with the level's `labels` overrides; a level sets, for example,
`{ "blocks": { "procedure": "Enseñar a Tito: {name}" }, "names": { "lamp": "farol" } }`.

## Running and the trace

`Runner` drives any `World` step by step; each world also has a one-call runner (`runGrid`,
`runTurtle`, `runRealtime`) and levels have `runCase(level, program, index)`.

```ts
const runner = new Runner(program, new GridWorld(board), { labels, stepLimit: 10000 });
let step;
while ((step = runner.next())) animate(step);   // or runner.run()
runner.status; // 'done' | 'error'
runner.error;  // RunError | null
```

A `TraceStep<E>`:

| field | meaning |
|---|---|
| `index` | position in the trace |
| `node` | the block that ran: highlight it |
| `kind` | `command`, `call`, `repeat` (`value` = N), `condition` (if / repeat until; `value` = the answer), `set` / `change` (`variable`, `value`), `wait` |
| `stack` | ids of the call blocks being executed, outermost first (highlight the chain) |
| `events` | what the world did (empty for control steps) |
| `actor` | realtime: whose script ran it |

Errors stop the run (the character "stops and shows why"): `RunError { code, nodeId, params, message }`,
with `message` already in Spanish. Codes: world errors `wall`, `outOfBoard`, `outOfArea`, `noItem`,
`notCarrying`, `inventoryFull`, `noLamp`, `noArrow`, `actionFailed`; program errors `stepLimit`
(infinite loop guard: one unit per statement and per loop round, default 10000), `recursionDepth`
(default 100 nested calls), `paramCount`, `argType`, `notBoolean`, `notNumber`, `badCount`,
`divisionByZero`, `unknownProcedure`, `unknownCommand`, `unknownSensor`, `unknownParam`,
`unknownVariable`, `unknownBlock`, `duplicateProcedure`.

## Grid world

```jsonc
"board": {
  "width": 5, "height": 3,
  "robot": { "x": 0, "y": 1, "facing": "E" },
  "cells": [
    { "x": 3, "y": 1, "items": { "lamp": 1 } },
    { "x": 2, "y": 0, "wall": true, "terrain": "water" },
    { "x": -1, "y": 1, "items": { "flag": 1 }, "arrow": "S", "color": "blue", "hidden": { "crumbs": 1 } }
  ],
  "walls": [{ "x": 1, "y": 1, "side": "S" }],     // a wall between (1,1) and (1,2)
  "inventory": { "key": 1 },
  "capacity": 1                                   // carry at most one thing
}
```

- Items are names with counts. Lamps are the items `lamp` (off) and `lampOn`.
- `wall: true` cells block movement; `terrain` (`water`, `rock`, `grass`, `start`…) is for the
  renderer, the `terrainIs` sensor and messages (`wall:water` → "¡Hay agua!…").
- `hidden` items are invisible to sensors until an action with `reveal` uncovers them.
- `boardFromRows(['R..L', '~~~L'], legend)` writes boards as text, top row first.

**Commands**: `move(dir)`, `forward()`, `turnLeft()`, `turnRight()`, `paint(color)`, `lightLamp()`,
`toggleLamp()`, `pick(item)`, `drop(item)`, `say(value)`.

**Sensors**: `itemHere(item)`, `countHere(item)`, `canMove(dir)`, `canMoveForward()`, `atEdge(dir)`,
`hasArrow()`, `arrowHere()` (a direction), `arrowIs(dir)`, `colorHere()` (`'none'` if unpainted),
`colorIs(color)`, `hasItem(item)`, `inventoryCount(item)`, `facing()`, `posX()`, `posY()`,
`boardWidth()`, `boardHeight()`, `distanceToEdge(dir)`, `freeCells(dir)` (cells until a wall, water
or the edge: "the length of this row"), `stepsTo(item, dir)` (-1 if none), `terrainIs(name)`.

**Level actions** (`CustomAction`, in `level.actions`) make scene puzzles without code. Requirements
are checked first; failing one stops the robot with `actionFailed` and the action's `failMessage`.
Effects then apply on the starting cell, in order: consume, add, `dropAll`, `cycle`, `reveal`,
`paint`, `say`, and finally the robot moves (`move`, then `goTo`). Item names may use `{0}` for the
action's arguments.

```jsonc
"actions": [
  { "name": "jumpStone", "label": "Saltar piedra", "move": "E" },
  { "name": "backToEdge", "label": "Volver al borde", "goTo": { "x": 0 } },
  { "name": "turnOnPc", "label": "Prender compu", "consumeHere": { "pcOff": 1 }, "addHere": { "pcOn": 1 },
    "failMessage": "Acá no hay una compu apagada." },
  { "name": "writeA", "label": "Escribir A", "requireHere": { "pcOn": 1 }, "addHere": { "textA": 1 } },
  { "name": "openChest", "label": "Abrir cofre", "requireHere": { "chest": 1 }, "consumeInventory": { "key": 1 },
    "addInventory": { "lens": 1 }, "failMessage": "Para abrir el cofre hace falta la llave." },
  { "name": "leaveInBoat", "label": "Dejar en el bote", "requireHere": { "boat": 1 }, "dropAll": true },
  { "name": "countApple", "label": "Contar manzana", "requireHere": { "apple": 1 }, "addInventory": { "apples": 1 } },
  { "name": "changeColor", "label": "Cambiar color", "cycle": ["lamp0", "lamp1", "…", "lamp15"] },
  { "name": "lieDown", "label": "Acostarse", "requireHere": { "hammock": 1 }, "forbidInventory": ["lying"],
    "addInventory": { "lying": 1 } }
]
```

Fields: `requireHere`, `requireInventory`, `forbidHere`, `forbidInventory`, `consumeHere`,
`consumeInventory`, `addHere`, `addInventory`, `dropAll`, `cycle`, `reveal`, `paint`, `say`, `move`,
`goTo`, `params`, `label`, `failMessage`. Inventory items double as state flags (`lying`, `asleep`)
and counters (`apples`), so "scene" puzzles with named places are grid levels: put each place on a
cell, move with `goTo` actions, and tell the renderer with `level.meta` (for example
`{ "view": "scene", "places": { "1,0": "hammock" } }`).

**Events** (`GridEvent`): `moved {from, to, dir}`, `turned {from, to}`, `painted {x, y, color,
previous}`, `lit {x, y, on, changes}`, `picked` / `dropped {x, y, item, changes}`, `action {action,
args, x, y, changes, painted?, said?, moved?}`, `said {value}`. `changes` are `ItemChange`s
(`where: 'cell' | 'hidden' | 'inventory'`, `item`, `before`, `after`). `applyGridEvent(state, e)`
replays them exactly.

## Turtle world

```jsonc
"start": { "x": 100, "y": 100, "heading": 0, "pen": true, "color": "black", "area": { "width": 400, "height": 400 } }
```

**Commands**: `forward(n)`, `back(n)`, `turnLeft(deg)`, `turnRight(deg)`, `penUp()`, `penDown()`,
`penColor(color)`. **Sensors**: `heading()`, `posX()`, `posY()`, `penIsDown()`. Walking out of `area`
stops with `outOfArea`. **Events**: `moved {from, to, drew, color}`, `turned {from, to, by}`,
`pen {down}`, `color {color}`; `applyTurtleEvent` replays them. The state keeps `segments`.

Goal: `{ "type": "shape", "target": …, "match": "rigid", "tolerance": 0.5, "colors": false, "returnHome": false }`
or `{ "type": "any", "goals": [...] }`. Targets are `{ "segments": [{ "from": [0,0], "to": [100,0] }, …] }`
or `{ "polygon": { "sides": 5, "side": 80, "step": 2, "start": [0,0], "heading": 0 } }` (step 2 = a
five-pointed star). Drawings are compared as segment sets: order, direction and splitting do not
matter (two `forward 50` equal one `forward 100`; overlapping lines merge). `match`: `exact` (same
place), `translate` (anywhere), `rigid` (default: anywhere, any rotation).

## Realtime world

A tick-based grid arena. The child's program drives the **player** actor; every other actor runs a
built-in script written in the same AST. `new RealtimeGame(setup, program, { seed })` and
`game.step(keys)` advance one tick; `runRealtime(setup, program, { inputs, hold, ticks })` plays a
scripted game.

```jsonc
{
  "arena": { "width": 12, "height": 3, "tiles": [{ "x": 11, "y": 1, "tile": "exit" }], "walls": [[5, 0]] },
  "player": { "x": 0, "y": 1, "facing": "E" },
  "actors": [{ "kind": "gull", "x": 3, "y": 0, "facing": "S" }],
  "kinds": { "gull": { "script": { "main": [], "handlers": [ /* every 2 ticks: forward or turn around */ ] }, "solid": false } },
  "variables": { "points": 0, "lives": 3 },          // shared by all scripts
  "keys": ["up", "down", "left", "right", "action"],
  "win": { "type": "reach", "tile": "exit" },
  "lose": { "type": "touch", "kind": "gull" },
  "endWhenMainEnds": true,
  "maxTicks": 600,
  "seed": 1
}
```

**Each tick**: (1) handlers wake: `start` and `main` on tick 1, `key` for each pressed key, `tick`
handlers whose `every` divides the tick; a handler still running is not started again. (2) Every
due script runs, player first, then actors in creation order, until it ends or pauses: **each loop
round and each `wait` ends that script's turn for the tick** (like Scratch), so a polling main loop
reads the buttons once per tick. (3) Actors that start sharing a cell, or swap cells, touch: their
`touch` handlers run right away; actors entering a tile wake `touch <tile>`. (4) `lose`, then
`win`, then `maxTicks` (`timeout`). With `endWhenMainEnds`, win and lose are only judged when the
player's `main` finishes (so the child's program can "Decir ¡Gané!" after its loop).

**Commands**: `move(dir)` (also faces that way; walls, edges and solid actors make it `bumped`, not
an error), `forward()`, `turnLeft()`, `turnRight()`, `turnAround()`, `face(dir)`, `goTo(x, y)`,
`spawn(kind)` (a new actor on this cell, facing the same way: shots, falling things), `vanish()`,
`say(value)`, `play(sound)`, `look(name)` (for renderers: costumes, poses), `signal(name)`, `win()`,
`lose()`.

**Sensors**: `canMove(dir)`, `canMoveForward()`, `atEdge(dir)`, `posX()`, `posY()`, `facing()`,
`touching(kind)` ("am I touching one **now**?": true while sharing a cell, every time it is asked,
never used up), `touched(kind)` (yes **once per new contact**: the first question uses it up, so a
loop that adds points counts each touch once; it also catches actors that swapped cells), `received(signal)` (yes
once per signal sent by any actor: "the light hit a cloud"), `tileHere(tile)`, `heard()` /
`heardSound(name)` (sounds of this tick and the previous one), `random(min, max)` (seeded),
`directionTo(kind)`, `distanceTo(kind)` (-1 if none), `count(kind)`, `keyPressed(key)`, `tick()`.

**Conditions**: `all`, `any`, `not`, `var {name, op, value}`, `reach {x?, y?, edge?, tile?}`,
`touch {kind}`, `none {kind}` (all caught), `tick {atLeast}` (survive), `look {look, kind?}`,
`said {value}`.

**Tick results** (`TickResult`): `tick`, `inputs`, `steps` (with `actor`), `events`, `status`
(`running | won | lost | timeout | error`), `error`. Events: `moved`, `bumped`, `turned`,
`spawned`, `vanished`, `said`, `sound`, `look`, `signal`, `variable {actor | null, name, value}`,
`touched {a, b}`, `entered {actor, tile}`, `ended {status}`. `game.snapshot()` is the serializable
state (actors with positions, looks, variables; shared variables; RNG state).

## Levels and check()

```jsonc
{
  "id": "c4-muelle-1",
  "world": "grid",
  "title": "Faroles hasta el muelle",
  "board": { "width": 5, "height": 1, "robot": { "x": 0, "y": 0 }, "cells": [{ "x": -1, "y": 0, "items": { "flag": 1 } }] },
  "generate": {
    "seed": 11, "count": 5,
    "rules": [
      { "type": "size", "width": [3, 12] },
      { "type": "fill", "region": { "x0": 0, "y0": 0, "x1": -2, "y1": 0 }, "content": { "items": { "lamp": 1 } } }
    ]
  },
  "goal": { "type": "all", "goals": [{ "type": "noItem", "item": "lamp" }, { "type": "robotAt", "onItem": "flag" }] },
  "toolbox": {
    "commands": [{ "name": "move", "args": ["E"], "label": "Mover →" }, "lightLamp"],
    "sensors": [{ "name": "itemHere", "args": ["flag"], "label": "¿Llegué al final?" }],
    "control": ["repeat", "repeatUntil"]
  },
  "labels": { "blocks": { "procedure": "Enseñar a Tito: {name}" } }
}
```

All levels: `id`, `world`, `toolbox`, `labels?`, `stepLimit?`, `maxDepth?`, `requires?`, `meta?`,
`title?`.

- **Grid**: `board`, `actions?`, `goal`, `variants?` (explicit cases: `{ name?, board?, main?, goal? }`;
  `main` replaces the child's main, to call their procedures with arguments), `generate?`
  (`{ seed, count, rules, includeBase? }`). Cases = `variants` (or the base board if there are none
  and no generator) + generated boards.
- **Turtle**: `start?`, `goal`, `variants?` (`{ start?, main?, goal? }`).
- **Realtime**: the setup fields above plus `trials?`: `{ seed?, inputs?: string[][] (per tick),
  hold?: string[], ticks?, expect: 'win' | 'lose' | 'timeout' }`.

**Board rules** (`generate.rules`, applied in order; layout rules first): `size {width?, height?}`;
`path {length, dirs, arrows?, end?, off?}` (a random arrow path, board resized to fit, water around,
flag at the end); `rows {length, count?, start?, middle?, last?, off?, downOnlyAtStart?}` (rows of
random length with a start column); `scatter {item, chance, region?, border?, atLeast?}`;
`place {item, count, region?, border?}`; `stack {x, y, item, count}`; `choose {region, options,
border?}`; `fill {region, content, border?}`; `robot {x?, y?, facing?}`. Regions are
`{x0, y0, x1, y1}`, corners included, negatives from the far side; wall cells are skipped.

**Grid goals**: `all`, `any`, `not`, `noItem {item}` (`noItem lamp` = all lamps lit),
`itemCount {item, count, op?}`, `robotAt {x?, y?, edge?, onItem?, facing?}`, `cell {x, y, items?,
color?}`, `colors {cells, exact?}` (mosaics), `inventory {items, exact?}`, `said {value}`,
`saidCount {item, hidden?}`, `tally {counter, of}` (a counting action's total equals the board's
initial count), `sequence {commands, only?}` (scene order). Any goal takes a `message` override.

**Requirements** (`requires`, checked on the program text): `uses {block, min?, max?, in?: 'main' |
'all'}` ("the main stack only calls procedures": `{ uses, block: 'lieDown', in: 'main', max: 0 }`),
`procedure {params?, minCalls?, distinctCalls?}` ("one procedure with a parameter used with two
values").

```ts
const result = check(level, program, { seed });   // a new seed draws new random boards
result.passed;       // all cases pass, toolbox respected, requirements met, and par if strictPar
result.message;      // "¡Funciona en todos los casos!" / "Todavía no funciona… Prueba 3: Acá no hay manzana."
result.blocks; result.par; result.withinPar;
result.issues;       // static problems (RunError[] with nodeId)
result.requirements; // one GoalResult per requirement
result.cases;        // per case: { index, passed, reason, error, run }
```

`runCase(level, program, i, { snapshots: true, seed })` runs one case (the "Ejecutar" button);
`gridCases(level, seed)` lists the concrete boards; `caseCount(level)`.

## For editors

- `palette(level)` gives the offered blocks in a stable order: `{ key, category, label, params,
  returns?, args? }`. `label` is the Spanish template; `params` the slot types (`number`,
  `boolean`, `direction`, `name`, `any`); `args` the preset values, one per slot: a value is fixed
  (render it as text, do not let it be edited), `null` is an open slot (render the hole; `label`
  has its `{i}`). Categories: `command`, `sensor`, `control`, `operator`, `variable`, `procedure`,
  `event`. `matchesPreset(args, node args)` tells whether a node is that preset;
  `presetLabel(template, args, labels)` writes fixed values into a template.
- Reporters return `boolean` (pointy pieces), `number`, `direction` or `name` (round pieces).
- Offer `toolbox.choices` in dropdowns; translate values with `describeValue(v, labels)`.
- Show `toolbox.par` and `countBlocks(program, toolbox.parScope ?? 'main')` live; with `strictPar`,
  refuse to add blocks beyond it.
- Run `analyze()` while editing to mark blocks red before running.

## For renderers

- For a step world, take `run.initial` and apply each step's `events` in order
  (`applyGridEvent` / `applyTurtleEvent` keep you exact), one animation per step; highlight
  `step.node`. Or ask for `snapshots: true` and jump to `run.snapshots[i]` to scrub.
- On `run.error`, animate up to the last step, then show `error.message` near the character and
  highlight `error.nodeId` (it can be a reporter inside a slot).
- Realtime: call `game.step(keys)` on your own clock (the module has none), render
  `game.state` and animate `events`; on `ended`, show the result. Keys are the level's `keys`.
- `look` events and `level.meta` are for presentation only; changing looks never changes rules.

## Limits and decisions

- The realtime arena is cell-based. Smooth or "continuous" movement is a renderer concern
  (interpolate between cells, or use a finer arena).
- A realtime handler that is still running ignores new presses of its key; its last loop round
  takes the tick where it ends.
- Grid moves are absolute (`move N`) or relative (`forward`, `turnLeft`, `turnRight`); a level
  chooses which to offer.
- Scenes ("caminar hasta la hamaca", "pasar al siguiente vecino") are grid levels with actions and
  inventory flags, not a separate world.
- Random boards are deterministic per seed; the UI draws a new seed on each run if it wants fresh
  boards. `check()` with the level's seed is the reproducible test.
- Bumping into things is an error in step worlds (the robot stops and says why) but not in
  realtime, where it is part of playing.
