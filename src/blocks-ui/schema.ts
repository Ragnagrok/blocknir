/**
 * What the editor knows about a level's blocks, without any DOM: palette templates grouped for
 * children, slot types of every node, default slot contents, dropdown choices and label templates.
 * Pure: built from `palette(level)`, `catalogFor(level)` and `labelsFor(level)`.
 */
import {
  catalogFor,
  childExprs,
  describeValue,
  DIRECTIONS,
  isDirection,
  labelsFor,
  mergeLabels,
  palette,
  walkProgram,
  type Catalog,
  type EventSpec,
  type EventType,
  type Expr,
  type Handler,
  type LabelOverrides,
  type Labels,
  type Level,
  type PaletteEntry,
  type ParamSpec,
  type PresetArg,
  type Procedure,
  type Program,
  type Statement,
  type Value,
  type ValueType,
} from '../blocks/index.js';
import { stripParens } from './template.js';

/** The slot of a procedure's parameter `i` (`any` when it has no type). */
export function paramSpecOf(proc: Procedure | null | undefined, i: number): ParamSpec {
  const t = proc?.types?.[i];
  return t ? (t.name ? { type: t.type, name: t.name } : { type: t.type }) : { type: 'any' };
}

/** Palette groups, in the order children see them. */
export type Group = 'actions' | 'control' | 'sensors' | 'values' | 'variables' | 'procedures' | 'events';

export const GROUP_ORDER: readonly Group[] = ['actions', 'control', 'sensors', 'values', 'variables', 'procedures', 'events'];

/** How a block looks. `c` has one mouth (repeat, if), `cc` two (if / else), `hat` starts a script. */
export type Shape = 'stack' | 'c' | 'cc' | 'reporter' | 'boolean' | 'hat';

/** One block the palette offers, ready to turn into a node with `Schema.instantiate`. */
export interface BlockTemplate {
  /** Stable id of the palette item (`cmd:move:["N"]`, `call:dormirse`, `var:puntos`…). */
  id: string;
  /** The block key (see `blockKey`). */
  key: string;
  group: Group;
  shape: Shape;
  /** The label template (`Repetir {0} veces`), already overridden by presets. */
  label: string;
  params: ParamSpec[];
  returns?: ValueType;
  /** Preset arguments: fixed slots (not shown, not editable) and `null` for open ones. */
  args?: PresetArg[];
  /** `call` templates: the procedure they call. */
  procedure?: string;
  /** `var`, `set`, `change`, `subtract` templates: the variable. */
  variable?: string;
  /** `param` templates: the parameter and the procedure it belongs to. */
  param?: string;
  /** Hats: what tapping or dropping them creates. */
  creates?: 'procedure' | 'handler';
  event?: EventType;
}

/** A new top-level script a hat template makes. */
export type Creation = { type: 'procedure' } | { type: 'handler'; event: EventSpec };

/** Context for the palette: the procedure the cursor is in, the variables known so far. */
export interface PaletteContext {
  procedure?: Procedure | null;
  variables: readonly string[];
}

const GROUP_OF: Record<PaletteEntry['category'], Group> = {
  command: 'actions',
  sensor: 'sensors',
  control: 'control',
  operator: 'values',
  variable: 'variables',
  procedure: 'procedures',
  event: 'events',
};

const COLORS = ['red', 'blue', 'green', 'yellow', 'black', 'white'];

/** The level's knowledge, for the model and the view. */
export class Schema {
  readonly level: Level;
  readonly labels: Labels;
  readonly catalog: Catalog;
  readonly entries: readonly PaletteEntry[];

  /**
   * The program being edited, for the slots of calls and the type of parameters (procedure
   * parameters may have types). The model keeps it up to date.
   */
  program: Program | null = null;

  constructor(level: Level, overrides?: LabelOverrides) {
    this.level = level;
    this.labels = overrides ? mergeLabels(labelsFor(level), overrides) : labelsFor(level);
    this.catalog = catalogFor(level);
    this.entries = palette(level).map((e) => (overrides?.blocks?.[e.key] !== undefined && !e.args ? { ...e, label: overrides.blocks[e.key]! } : e));
  }

  /** The level's block budget, if any. */
  get par(): { limit: number; scope: 'main' | 'all'; strict: boolean } | null {
    const tb = this.level.toolbox;
    return tb.par === undefined ? null : { limit: tb.par, scope: tb.parScope ?? 'main', strict: !!tb.strictPar };
  }

  /** Whether the toolbox lets children define procedures, and with parameters. */
  get procedures(): boolean {
    return !!this.level.toolbox.procedures;
  }

  get parameters(): boolean {
    return !!this.level.toolbox.procedures && !!this.level.toolbox.parameters;
  }

  get variablesAllowed(): boolean {
    return !!this.level.toolbox.variables;
  }

  /** Shared variables a realtime level starts with (`points`, `lives`). */
  get levelVariables(): string[] {
    return this.level.world === 'realtime' ? Object.keys(this.level.variables ?? {}) : [];
  }

  /** The label template of a block key. */
  template(key: string): string {
    return this.labels.blocks[key] ?? key;
  }

  // -------------------------------------------------------------------------------------------
  // Slots
  // -------------------------------------------------------------------------------------------

  /** The slot specs of a node, in `childExprs` order. */
  slots(node: Expr | Statement): ParamSpec[] {
    const n: ParamSpec = { type: 'number' };
    const b: ParamSpec = { type: 'boolean' };
    const any: ParamSpec = { type: 'any' };
    switch (node.kind) {
      case 'command': {
        const spec = this.catalog.commands[node.command];
        return node.args.map((_, i) => spec?.params[i] ?? any);
      }
      case 'sensor': {
        const spec = this.catalog.sensors[node.sensor];
        return node.args.map((_, i) => spec?.params[i] ?? any);
      }
      case 'call': {
        const proc = this.program?.procedures?.find((p) => p.name === node.procedure);
        return node.args.map((_, i) => paramSpecOf(proc, i));
      }
      case 'repeat':
        return [n];
      case 'wait':
        return [{ type: 'number', name: 'ticks' }];
      case 'repeatUntil':
      case 'if':
        return [b];
      case 'set':
        return [any];
      case 'change':
        return [n];
      case 'arith':
        return [n, n];
      case 'compare':
        return node.op === '=' || node.op === '!=' ? [any, any] : [n, n];
      case 'and':
      case 'or':
        return [b, b];
      case 'not':
        return [b];
      case 'dirOp':
        return [{ type: 'direction' }];
      default:
        return [];
    }
  }

  /** What a reporter gives. */
  returns(e: Expr): ValueType {
    switch (e.kind) {
      case 'number':
      case 'arith':
        return 'number';
      case 'boolean':
      case 'compare':
      case 'and':
      case 'or':
      case 'not':
        return 'boolean';
      case 'direction':
      case 'dirOp':
        return 'direction';
      case 'name':
        return 'name';
      case 'sensor':
        return this.catalog.sensors[e.sensor]?.returns ?? 'any';
      case 'param':
        return this.paramType(e.name);
      case 'var':
        return 'any';
    }
  }

  /**
   * What a parameter gives: its type, when every procedure with a parameter of that name agrees
   * (a parameter is only used inside its own procedure); otherwise `any`.
   */
  paramType(name: string): ValueType {
    const found = new Set<ValueType>();
    for (const p of this.program?.procedures ?? []) {
      const i = p.params.indexOf(name);
      if (i >= 0) found.add(paramSpecOf(p, i).type);
    }
    return found.size === 1 ? [...found][0]! : 'any';
  }

  /**
   * The types a new parameter can take in this level: a number, and what the toolbox's own blocks
   * take (a direction, an item, a color…), plus true or false when there are conditions. The first
   * one is the default.
   */
  paramTypes(): ParamSpec[] {
    const out: ParamSpec[] = [{ type: 'number' }];
    const seen = new Set(['number']);
    let conditions = false;
    for (const e of this.entries) {
      if (e.key === 'if' || e.key === 'repeatUntil') conditions = true;
      if (e.category !== 'command' && e.category !== 'sensor') continue;
      for (const sp of e.params) {
        if (sp.type === 'any' || sp.type === 'number' || sp.type === 'boolean') continue;
        const k = sp.type === 'name' ? `name:${sp.name ?? ''}` : sp.type;
        if (seen.has(k)) continue;
        // A name slot with nothing to choose from (no items on the board) is no use as a type.
        if (sp.type === 'name' && !this.choices(sp).length) continue;
        seen.add(k);
        out.push(sp.type === 'name' && sp.name ? { type: 'name', name: sp.name } : { type: sp.type });
      }
    }
    if (conditions) out.push({ type: 'boolean' });
    return out;
  }

  /** Whether a reporter giving `given` may go in a slot of type `slot`. */
  fits(given: ValueType, slot: ValueType): boolean {
    if (slot === 'any' || given === 'any' || given === slot) return true;
    // Directions are strings, so a name slot (say, signal…) takes them too.
    return slot === 'name' && given === 'direction';
  }

  /** The values offered in a slot's dropdown. Empty: free text or a number keypad. */
  choices(spec: ParamSpec): Value[] {
    const ch = this.level.toolbox.choices ?? {};
    switch (spec.type) {
      case 'direction':
        return [...(ch.directions ?? DIRECTIONS)];
      case 'boolean':
        return [true, false];
      case 'name':
        return this.nameChoices(spec.name);
      case 'any':
        return [...(ch.directions ?? []), ...(ch.names ?? [])];
      default:
        return [];
    }
  }

  private nameChoices(hint: string | undefined): string[] {
    const level = this.level;
    const ch = level.toolbox.choices ?? {};
    if (hint === 'key') return [...(ch.keys ?? (level.world === 'realtime' ? (level.keys ?? []) : []))];
    if (ch.names?.length) return [...ch.names];
    const found = new Set<string>();
    if (level.world === 'grid') {
      if (hint === 'color') {
        for (const c of COLORS) found.add(c);
      } else if (hint === 'terrain') {
        for (const c of level.board.cells ?? []) if (c.terrain) found.add(c.terrain);
      } else {
        for (const c of level.board.cells ?? []) for (const k of Object.keys({ ...c.items, ...c.hidden })) found.add(k);
      }
    } else if (level.world === 'turtle') {
      for (const c of COLORS) found.add(c);
    } else {
      if (hint === 'kind') for (const k of Object.keys(level.kinds ?? {})) found.add(k);
      if (hint === 'tile') for (const t of level.arena.tiles ?? []) found.add(t.tile);
      if (hint === 'key') for (const k of level.keys ?? []) found.add(k);
    }
    return [...found];
  }

  /** A literal for a value, typed by what the value is. */
  literal(id: string, v: Value, type: ValueType = 'any'): Expr {
    if (typeof v === 'number') return { id, kind: 'number', value: v };
    if (typeof v === 'boolean') return { id, kind: 'boolean', value: v };
    if (isDirection(v) && type !== 'name') return { id, kind: 'direction', value: v };
    return { id, kind: 'name', value: v };
  }

  /**
   * What an empty slot holds. Numbers and dropdowns get a sensible first value; boolean slots get a
   * hole (`{ kind: 'name', value: '' }`), which the interpreter reports as `notBoolean` on that hole
   * if the program runs before it is filled.
   */
  emptyExpr(id: string, spec: ParamSpec, key?: string): Expr {
    switch (spec.type) {
      case 'number':
        return { id, kind: 'number', value: defaultNumber(this.level.world, key, spec.name) };
      case 'direction': {
        const d = this.choices(spec)[0];
        return { id, kind: 'direction', value: isDirection(d) ? d : 'E' };
      }
      case 'name': {
        const v = this.choices(spec)[0];
        return { id, kind: 'name', value: typeof v === 'string' ? v : '' };
      }
      case 'boolean':
        return hole(id);
      case 'any':
        return key === 'say' ? hole(id) : { id, kind: 'number', value: 0 };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Palette
  // -------------------------------------------------------------------------------------------

  /** What a call's slot starts with: a value of the parameter's type (1 when it has no type). */
  callArg(id: string, spec: ParamSpec): Expr {
    return spec.type === 'any' ? { id, kind: 'number', value: 1 } : this.emptyExpr(id, spec);
  }

  /** The palette items for the current program, grouped and in a stable order. */
  templates(program: Program, ctx: PaletteContext): BlockTemplate[] {
    const out: BlockTemplate[] = [];
    for (const e of this.entries) {
      const base = { key: e.key, group: GROUP_OF[e.category], params: e.params, label: e.label };
      switch (e.category) {
        case 'command':
        case 'sensor':
        case 'control':
        case 'operator': {
          const t: BlockTemplate = {
            ...base,
            id: `${e.category}:${e.key}${e.args ? `:${JSON.stringify(e.args)}` : ''}`,
            shape: shapeOf(e.key, e.returns),
          };
          if (e.returns) t.returns = e.returns;
          if (e.args) t.args = [...e.args];
          out.push(t);
          break;
        }
        case 'variable': {
          const first = ctx.variables[0];
          if (e.key === 'var') {
            for (const v of ctx.variables) out.push({ ...base, id: `var:${v}`, shape: 'reporter', returns: 'any', variable: v });
          } else if (first !== undefined) {
            out.push({ ...base, id: `variable:${e.key}`, shape: 'stack', variable: first });
          }
          break;
        }
        case 'procedure': {
          if (e.key === 'procedure') {
            out.push({ ...base, id: 'procedure:new', shape: 'hat', creates: 'procedure' });
          } else if (e.key === 'call') {
            for (const p of program.procedures ?? []) {
              out.push({ ...base, id: `call:${p.name}`, shape: 'stack', procedure: p.name, params: p.params.map((_, i) => paramSpecOf(p, i)) });
            }
          } else if (e.key === 'param' && ctx.procedure) {
            for (const name of ctx.procedure.params) {
              out.push({ ...base, id: `param:${name}`, shape: 'reporter', returns: paramSpecOf(ctx.procedure, ctx.procedure.params.indexOf(name)).type, param: name, procedure: ctx.procedure.name });
            }
          }
          break;
        }
        case 'event': {
          const type = e.key.slice('event.'.length) as EventType;
          out.push({ ...base, id: e.key, shape: 'hat', creates: 'handler', event: type });
          break;
        }
      }
    }
    return out;
  }

  /** The variables a program can use: the level's shared ones, the ones in use, and `extra`. */
  variables(program: Program, extra: readonly string[] = []): string[] {
    const names = new Set<string>(this.levelVariables);
    walkProgram(program, (n) => {
      if ('kind' in n && (n.kind === 'set' || n.kind === 'change')) names.add(n.variable);
      if ('kind' in n && n.kind === 'var') names.add(n.name);
    });
    for (const v of extra) names.add(v);
    return [...names];
  }

  /**
   * Builds the node of a statement or reporter template with fresh ids. Hats return null: use
   * `creation()` instead.
   */
  instantiate(t: BlockTemplate, nextId: () => string): Statement | Expr | null {
    const id = nextId();
    // A preset's fixed slots get their value; its open slots start empty, so the child sees the hole.
    const slot = (i: number, p: ParamSpec, fallback: () => Expr): Expr => {
      const v = t.args?.[i];
      if (v === undefined) return fallback();
      return v === null ? hole(nextId()) : this.literal(nextId(), v, p.type);
    };
    const args = (): Expr[] => t.params.map((p, i) => slot(i, p, () => this.emptyExpr(nextId(), p, t.key)));
    const one = (): Expr => ({ id: nextId(), kind: 'number', value: 1 });
    const n: ParamSpec = { type: 'number' };
    switch (t.key) {
      case 'repeat':
        return { id, kind: 'repeat', times: this.emptyExpr(nextId(), n, 'repeat'), body: [] };
      case 'repeatUntil':
        return { id, kind: 'repeatUntil', until: hole(nextId()), body: [] };
      case 'if':
        return { id, kind: 'if', condition: hole(nextId()), then: [] };
      case 'ifElse':
        return { id, kind: 'if', condition: hole(nextId()), then: [], else: [] };
      case 'wait':
        return { id, kind: 'wait', ticks: this.emptyExpr(nextId(), { type: 'number', name: 'ticks' }, 'wait') };
      case 'set':
        return { id, kind: 'set', variable: t.variable ?? '', value: { id: nextId(), kind: 'number', value: 0 } };
      case 'change':
        return { id, kind: 'change', variable: t.variable ?? '', by: { id: nextId(), kind: 'number', value: 1 } };
      case 'subtract':
        return { id, kind: 'change', variable: t.variable ?? '', by: { id: nextId(), kind: 'number', value: 1 }, op: '-' };
      case 'var':
        return { id, kind: 'var', name: t.variable ?? '' };
      case 'param':
        return { id, kind: 'param', name: t.param ?? '' };
      case 'call':
        return { id, kind: 'call', procedure: t.procedure ?? '', args: t.params.map((p) => this.callArg(nextId(), p)) };
      case 'procedure':
        return null;
      case '+':
      case '-':
      case '*':
      case '/':
      case '%': {
        return { id, kind: 'arith', op: t.key, left: slot(0, n, one), right: slot(1, n, one) };
      }
      case '=':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=': {
        const [left, right] = args();
        return { id, kind: 'compare', op: t.key, left: left!, right: right! };
      }
      case 'and':
      case 'or': {
        const b: ParamSpec = { type: 'boolean' };
        return { id, kind: t.key, left: slot(0, b, () => hole(nextId())), right: slot(1, b, () => hole(nextId())) };
      }
      case 'not':
        return { id, kind: 'not', operand: slot(0, { type: 'boolean' }, () => hole(nextId())) };
      case 'opposite':
      case 'left':
      case 'right': {
        const d: ParamSpec = { type: 'direction' };
        return { id, kind: 'dirOp', op: t.key, operand: slot(0, d, () => this.emptyExpr(nextId(), d)) };
      }
      default:
        if (t.creates) return null;
        if (t.group === 'sensors') return { id, kind: 'sensor', sensor: t.key, args: args() };
        return { id, kind: 'command', command: t.key, args: args() };
    }
  }

  /** What a hat template makes. */
  creation(t: BlockTemplate): Creation | null {
    if (t.creates === 'procedure') return { type: 'procedure' };
    if (t.creates !== 'handler' || !t.event) return null;
    switch (t.event) {
      case 'start':
        return { type: 'handler', event: { type: 'start' } };
      case 'tick':
        return { type: 'handler', event: { type: 'tick' } };
      case 'key': {
        const k = this.choices({ type: 'name', name: 'key' })[0];
        return { type: 'handler', event: { type: 'key', key: typeof k === 'string' ? k : 'action' } };
      }
      case 'touch': {
        const k = this.choices({ type: 'name', name: 'kind' })[0];
        return { type: 'handler', event: { type: 'touch', what: typeof k === 'string' ? k : '' } };
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------------------------

  /**
   * The label template of a node in the workspace, and which of its slots a preset fixes: a
   * command preset (`Mover ↑`) fixes them all, so the view shows no slots; an operator preset
   * (`360 ÷ ( )`) fixes some and leaves the others open. A preset label is used only when the
   * toolbox does not also offer the general block; then `preset` is true and `fixed` lists the
   * fixed slot indexes (which the view hides and the model refuses to edit).
   */
  labelOf(node: Statement | Expr): { template: string; preset: boolean; fixed: number[] } {
    const round = node.kind === 'sensor' || node.kind === 'var' || node.kind === 'param';
    const key = keyOf(node);
    const match = this.presetOf(node);
    if (match) {
      const fixed = (match.args ?? []).flatMap((v, i) => (v === null ? [] : [i]));
      return { template: tidy(match.label, round), preset: true, fixed };
    }
    return { template: tidy(this.template(key), round), preset: false, fixed: [] };
  }

  /** The preset palette entry a node was made from, when the toolbox offers only presets of its block. */
  presetOf(node: Statement | Expr): PaletteEntry | null {
    const category = categoryOfNode(node);
    if (!category) return null;
    const key = keyOf(node);
    const own = this.entries.filter((e) => e.key === key && e.category === category);
    if (!own.length || own.some((e) => !e.args)) return null;
    const kids = childExprs(node);
    return own.find((e) => e.args!.length === kids.length && e.args!.every((v, i) => v === null || isLitValue(kids[i]!, v))) ?? null;
  }

  /** Whether a slot of a node is fixed by its preset (not editable). */
  isFixed(node: Statement | Expr, slot: number): boolean {
    const p = this.presetOf(node);
    return !!p && p.args![slot] !== undefined && p.args![slot] !== null;
  }

  /** The label of a template in the palette. */
  labelOfTemplate(t: BlockTemplate): string {
    return tidy(t.label, t.shape === 'reporter' || t.shape === 'boolean');
  }

  /** The label of a handler's hat. */
  handlerLabel(h: Handler): string {
    return this.template(`event.${h.event.type}`);
  }

  /** A value in the child's words (`→`, `farol`, `sí`, `3`). */
  describe(v: Value): string {
    return describeValue(v, this.labels);
  }
}

/** An empty slot: a name literal with no text. */
export function hole(id: string): Expr {
  return { id, kind: 'name', value: '' };
}

/** Whether a slot holds a hole. */
export function isHole(e: Expr): boolean {
  return e.kind === 'name' && e.value === '';
}

function isLitValue(e: Expr, v: Value): boolean {
  return (e.kind === 'number' || e.kind === 'boolean' || e.kind === 'direction' || e.kind === 'name') && e.value === v;
}

function tidy(label: string, round: boolean): string {
  return round ? stripParens(label) : label;
}

function defaultNumber(world: Level['world'], key: string | undefined, hint: string | undefined): number {
  if (key === 'repeat') return 2;
  if (world === 'turtle') {
    if (hint === 'steps') return 50;
    if (hint === 'degrees') return 90;
  }
  if (hint === 'x' || hint === 'y') return 0;
  return 1;
}

function shapeOf(key: string, returns: ValueType | undefined): Shape {
  if (returns === 'boolean') return 'boolean';
  if (returns) return 'reporter';
  if (key === 'repeat' || key === 'repeatUntil' || key === 'if') return 'c';
  if (key === 'ifElse') return 'cc';
  return 'stack';
}

/** The palette category whose presets can describe a node, or null for blocks without presets. */
function categoryOfNode(node: Statement | Expr): PaletteEntry['category'] | null {
  switch (node.kind) {
    case 'command':
      return 'command';
    case 'sensor':
      return 'sensor';
    case 'arith':
    case 'compare':
    case 'dirOp':
    case 'and':
    case 'or':
    case 'not':
      return 'operator';
    default:
      return null;
  }
}

/** The label key of a node. */
function keyOf(node: Statement | Expr): string {
  switch (node.kind) {
    case 'if':
      return node.else ? 'ifElse' : 'if';
    case 'change':
      return node.op === '-' ? 'subtract' : 'change';
    case 'arith':
    case 'compare':
    case 'dirOp':
      return node.op;
    case 'command':
      return node.command;
    case 'sensor':
      return node.sensor;
    default:
      return node.kind;
  }
}

/** The shape of a node in the workspace. */
export function shapeOfNode(node: Statement | Expr, schema: Schema): Shape {
  switch (node.kind) {
    case 'repeat':
    case 'repeatUntil':
      return 'c';
    case 'if':
      return node.else ? 'cc' : 'c';
    case 'command':
    case 'call':
    case 'set':
    case 'change':
    case 'wait':
      return 'stack';
    default:
      return schema.returns(node) === 'boolean' ? 'boolean' : 'reporter';
  }
}

/** The palette group a node belongs to (for its color). */
export function groupOfNode(node: Statement | Expr): Group {
  switch (node.kind) {
    case 'command':
      return 'actions';
    case 'sensor':
      return 'sensors';
    case 'repeat':
    case 'repeatUntil':
    case 'if':
    case 'wait':
      return 'control';
    case 'set':
    case 'change':
    case 'var':
      return 'variables';
    case 'call':
    case 'param':
      return 'procedures';
    default:
      return 'values';
  }
}

