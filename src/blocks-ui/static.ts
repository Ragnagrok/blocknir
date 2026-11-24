/**
 * Programs as pictures: blocks that look exactly like the editor's but are not editable, without
 * palette, bar or workspace. For quizzes ("what does this program do?"), tiles that are tapped
 * into place, hints and printouts.
 *
 * ```ts
 * import { renderProgram, renderStatement } from 'blocknir/blocks-ui';
 * el.append(renderProgram(level, program));
 * bank.append(renderStatement(level, blocks.cmd('move', 'E')));
 * ```
 */
import { ensureIds, type Level, type Program, type Statement } from '../blocks/index.js';
import type { LabelOverrides } from '../blocks/index.js';
import { h } from './dom.js';
import type { Joints, Theme } from './editor.js';
import { EditorModel } from './model.js';
import { Renderer } from './render.js';
import { Schema } from './schema.js';
import { injectStyles } from './styles.js';
import { mergeText, type DeepPartial, type UiText } from './text.js';

export interface StaticBlocksOptions {
  /** `auto` (default) follows the system. */
  theme?: Theme;
  /** Label overrides on top of the level's. */
  labels?: LabelOverrides;
  /** The editor's own words (the main hat's "Al tocar Ejecutar", for one). */
  text?: DeepPartial<UiText>;
  /** Draw the main script's hat. Default true. */
  hat?: boolean;
  /** Block size: `normal` (like the editor) or `small` (about three quarters). Default `normal`. */
  size?: 'normal' | 'small';
  /** How stacked blocks join, as in the editor. Default `stack`. */
  joints?: Joints;
}

function root(level: Level, options: StaticBlocksOptions, ...children: Node[]): HTMLElement {
  injectStyles(document);
  return h(
    'div',
    { class: `rbk-editor rbk-static${options.size === 'small' ? ' rbk-static-small' : ''}${options.hat === false ? ' rbk-static-nohat' : ''}`, 'data-rbk-theme': options.theme ?? 'auto', 'data-rbk-joints': options.joints ?? 'stack', 'data-rbk-world': level.world },
    ...children,
  );
}

function renderer(level: Level, program: Program, options: StaticBlocksOptions): Renderer {
  const schema = new Schema(level, options.labels);
  const model = new EditorModel(schema, { program });
  model.readOnly = true;
  return new Renderer(schema, model, mergeText(options.text));
}

/** A whole program (main script, procedures and handlers), read-only. */
export function renderProgram(level: Level, program: Program, options: StaticBlocksOptions = {}): HTMLElement {
  const r = renderer(level, program, options);
  return root(level, options, h('div', { class: 'rbk-static-content' }, r.workspace({ readOnly: true })));
}

/** One statement (with what it holds inside, for a Repetir), the way the palette shows it. */
export function renderStatement(level: Level, statement: Statement, options: StaticBlocksOptions = {}): HTMLElement {
  const program = ensureIds({ main: [statement], procedures: [] });
  const r = renderer(level, program, options);
  return root(level, { ...options, hat: false }, r.stmt(program.main[0]!));
}
