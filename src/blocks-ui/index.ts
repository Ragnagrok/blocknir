/**
 * A touch-friendly DOM block editor for `ragnagrok-engine/blocks`: a palette from
 * `palette(level)`, a workspace with the main stack, "Definir para…" procedures and event handlers,
 * drag and tap editing, keyboard support, undo, live block count and run highlighting.
 * Pure DOM and CSS (injected once, classes prefixed `rbk-`), no framework, no external assets.
 *
 * ```ts
 * import { BlockEditor } from 'ragnagrok-engine/blocks-ui';
 * const editor = new BlockEditor(el, { level, onChange: (program) => save(program) });
 * editor.highlight(step.node); editor.markError(err.nodeId, err.message);
 * ```
 */
export { renderProgram, renderStatement, type StaticBlocksOptions } from './static.js';
export { BlockEditor, JOINTS, type BlockEditorEvents, type BlockEditorOptions, type Joints, type Theme } from './editor.js';
export {
  deserializeProgram,
  EditorModel,
  getList,
  listKey,
  locateExpr,
  locateStatement,
  parseListKey,
  serializeProgram,
  spots,
  type EditResult,
  type ListRef,
  type ModelChange,
  type ModelOptions,
  type Refusal,
  type SavedProgram,
  type SlotRef,
  type Spot,
} from './model.js';
export { GROUP_ORDER, hole, isHole, KIND_OF, KIND_ORDER, paramSpecOf, Schema, type BlockTemplate, type Creation, type Group, type Kind, type Shape } from './schema.js';
export { parseTemplate, type Segment } from './template.js';
export { DEFAULT_TEXT, mergeText, paramTypeName, type UiText } from './text.js';
export { CSS as BLOCK_EDITOR_CSS, injectStyles } from './styles.js';
