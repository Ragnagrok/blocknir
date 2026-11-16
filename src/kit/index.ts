/**
 * Game helpers on top of core and render: a floating touch joystick, a typewriter dialogue box, a
 * cutscene director, an actor that walks and turns, and save slots.
 *
 * Former Spanish names (from Nullgard's `src/juego`):
 * - joystick (`tactil`): `Joystick` (`alTocar` → `onTap`, `activo` → `active`, `soltar` → `release`),
 *   `detectarTactil` → `detectTouch(className = 'touch')`; the base's `activo` class → `active` (option).
 * - dialogue (`dialogo`): `Dialogo` → `Dialogue` (`decir` → `say`, `avanzar` → `advance`,
 *   `actualizar` → `update`, `activo` → `active`, `alLinea`/`alLetra` → `onLine`/`onChar`),
 *   `Linea { quien, texto, nombre }` → `Line { style, text, speaker }`; the box's `abierto`/`completo`
 *   classes → `open`/`complete` (options). Elements are passed in, no fixed ids.
 * - director (`director`): `Director` (`correr` → `run`, `esperar` → `wait`, `decir` → `say`,
 *   `fundido` → `fade`, `cartel` → `caption`, `actualizar` → `update`, `apurado` → `hurry`,
 *   `alCartel` → `onCaption`); body class `cinematica` → `cutscene`, fade class `negro` → `black`.
 * - actor (`actor`): `Actor` (`figura` → `figure`, `rumbo` → `heading`, `quieto` → `restClip`,
 *   `cambiarFigura` → `swapFigure`, `caminando` → `walking`, `poner` → `place`, `caminarA` → `walkTo`,
 *   `mirarA` → `lookAt`, `animar` → `play`, `girarHacia` → `turnToward`, `actualizar` → `update`,
 *   `dibujar` → `draw`, `alPisar` → `onStep`), `VELOCIDAD` → `WALK_SPEED`, `PISO` → `floorY` option;
 *   clips `reposo`/`andar` → `idle`/`walk` (options).
 * - save (`guardado`): `leerPartida`/`guardarPartida`/`borrarPartida` → `SaveSlot<T>(key)` with
 *   `read`/`write`/`clear`.
 */
export { detectTouch, Joystick, stickVector, type JoystickOptions } from './joystick.js';
export { Dialogue, type DialogueElements, type DialogueOptions, type Line } from './dialogue.js';
export { Director, type DirectorOptions } from './director.js';
export { Actor, WALK_SPEED, type ActorOptions } from './actor.js';
export { SaveSlot } from './save.js';
