/**
 * Toolboxes (which blocks a level offers), block keys, block counting and static checks.
 */
import { walkProgram, isLiteral, type ArithOp, type CompareOp, type DirOp, type EventType, type Node, type NodeContext, type Program } from './ast.js';
import type { ErrorCode, RunError } from './errors.js';
import { DEFAULT_LABELS, errorMessage, type Labels } from './labels.js';
import type { BlockSpec } from './interpreter.js';
import { plainLabel } from './interpreter.js';
import type { Direction, Value } from './values.js';

/** Control blocks a toolbox may offer. `ifElse` is the `if` block with its `else` branch. */
export type ControlBlock = 'repeat' | 'repeatUntil' | 'if' | 'ifElse' | 'wait';

/** Operator blocks a toolbox may offer. */
export type OperatorBlock = ArithOp | CompareOp | 'and' | 'or' | 'not' | DirOp;

/**
 * A command or sensor in a toolbox: by name (any arguments allowed), or a preset block with fixed
 * literal arguments and its own label, like `{ name: 'itemHere', args: ['apple'], label: '¿Hay manzana?' }`
 * or `{ name: 'move', args: ['N'], label: 'Mover ↑' }`. A program may use the command with those
 * exact arguments only (unless another entry allows more).
 */
export type ToolboxEntry = string | { name: string; args?: Value[]; label?: string };

/** The command or sensor name of a toolbox entry. */
export function entryName(e: ToolboxEntry): string {
  return typeof e === 'string' ? e : e.name;
}

/**
 * What a level lets the child use. Literals (numbers, directions, names typed or chosen in a slot)
 * are always allowed; `choices` tells the editor which ones to offer in dropdowns.
 */
export interface Toolbox {
  /** World commands and level actions. */
  commands: ToolboxEntry[];
  /** World sensors. */
  sensors?: ToolboxEntry[];
  control?: ControlBlock[];
  operators?: OperatorBlock[];
  /** Defining and calling procedures. */
  procedures?: boolean;
  /** Procedures with parameters (needs `procedures`). */
  parameters?: boolean;
  /** `set`, `change` and variable reporters. */
  variables?: boolean;
  /** Event handlers (realtime worlds). */
  events?: EventType[];
  /** Values the editor offers in slot dropdowns. */
  choices?: {
    directions?: Direction[];
    /** Items, colors, sounds, looks… (keys of `labels.names`). */
    names?: string[];
    keys?: string[];
  };
  /** The block budget. `check()` reports whether a program fits it. */
  par?: number;
  /**
   * What `par` counts: `main` (default) only the main stack and event handlers, not procedure
   * definitions; `all` everything, definitions included. See `countBlocks`.
   */
  parScope?: 'main' | 'all';
  /** When true, a program over `par` does not pass, and editors should refuse to add more blocks. */
  strictPar?: boolean;
}

/**
 * The key of a block, used by toolboxes and label tables, or null for literals.
 * Commands and sensors use their name; handlers use `event.<type>`.
 */
export function blockKey(node: Node): string | null {
  if (!('kind' in node)) return 'event' in node ? `event.${node.event.type}` : 'procedure';
  switch (node.kind) {
    case 'number':
    case 'boolean':
    case 'direction':
    case 'name':
      return null;
    case 'command':
      return node.command;
    case 'sensor':
      return node.sensor;
    case 'call':
      return 'call';
    case 'if':
      return node.else ? 'ifElse' : 'if';
    case 'change':
      return node.op === '-' ? 'subtract' : 'change';
    case 'arith':
    case 'compare':
    case 'dirOp':
      return node.op;
    default:
      return node.kind;
  }
}

/**
 * Counts blocks. Every statement and reporter counts 1 (a `repeat` counts 1 plus what is inside;
 * a call counts 1); literals typed or chosen in slots count 0.
 *
 * - `main` (default): the main stack and event handler bodies only; procedure definitions and
 *   their bodies, and the hats, do not count.
 * - `all`: everything, with each procedure definition and event handler hat counting 1.
 */
export function countBlocks(program: Program, scope: 'main' | 'all' = 'main'): number {
  let n = 0;
  walkProgram(program, (node, ctx) => {
    if (isLiteral(node)) return;
    if (scope === 'main' && (ctx.procedure || !('kind' in node))) return;
    n++;
  });
  return n;
}

function matchesEntry(entries: readonly ToolboxEntry[] | undefined, name: string, args: readonly Node[]): boolean {
  return (entries ?? []).some((e) => {
    if (typeof e === 'string') return e === name;
    if (e.name !== name) return false;
    if (!e.args) return true;
    return e.args.length === args.length && e.args.every((v, i) => {
      const a = args[i]!;
      return isLiteral(a) && a.value === v;
    });
  });
}

/** Whether the toolbox offers the block of this node. */
export function allows(toolbox: Toolbox, node: Node): boolean {
  if (!('kind' in node)) {
    if ('event' in node) return (toolbox.events ?? []).includes(node.event.type);
    return !!toolbox.procedures && (node.params.length === 0 || !!toolbox.parameters);
  }
  switch (node.kind) {
    case 'number':
    case 'boolean':
    case 'direction':
    case 'name':
      return true;
    case 'command':
      return matchesEntry(toolbox.commands, node.command, node.args);
    case 'sensor':
      return matchesEntry(toolbox.sensors, node.sensor, node.args);
    case 'call':
      return !!toolbox.procedures && (node.args.length === 0 || !!toolbox.parameters);
    case 'param':
      return !!toolbox.parameters;
    case 'set':
    case 'change':
    case 'var':
      return !!toolbox.variables;
    case 'repeat':
    case 'repeatUntil':
    case 'wait':
      return (toolbox.control ?? []).includes(node.kind);
    case 'if':
      return (toolbox.control ?? []).includes(node.else ? 'ifElse' : 'if');
    case 'arith':
    case 'compare':
    case 'dirOp':
      return (toolbox.operators ?? []).includes(node.op);
    case 'and':
    case 'or':
    case 'not':
      return (toolbox.operators ?? []).includes(node.kind);
  }
}

/** The commands and sensors a world offers, for static checks and editors. */
export interface Catalog {
  commands: Readonly<Record<string, BlockSpec>>;
  sensors: Readonly<Record<string, BlockSpec>>;
}

/** A problem found without running the program. */
export type Issue = RunError;

/**
 * Checks a program without running it: repeated ids and procedure names, unknown commands, sensors,
 * procedures and parameters, wrong slot counts, and (with a toolbox) blocks the level does not offer.
 */
export function analyze(program: Program, catalog: Catalog, toolbox?: Toolbox, labels: Labels = DEFAULT_LABELS): Issue[] {
  const issues: Issue[] = [];
  const add = (code: ErrorCode, nodeId: string | null, params: Record<string, Value>): void => {
    issues.push({ code, nodeId, params, message: errorMessage(code, params, labels) });
  };
  const ids = new Set<string>();
  const procs = new Map<string, number>();
  for (const p of program.procedures ?? []) {
    if (procs.has(p.name)) add('duplicateProcedure', p.id, { name: p.name });
    else procs.set(p.name, p.params.length);
  }
  walkProgram(program, (node: Node, ctx: NodeContext) => {
    if (ids.has(node.id)) add('duplicateId', node.id, { id: node.id });
    ids.add(node.id);
    if (toolbox && !allows(toolbox, node)) {
      const key = blockKey(node) ?? '';
      const block = 'procedure' in node ? node.procedure : plainLabel(key, labels);
      add('notAllowed', node.id, { block });
    }
    if (!('kind' in node)) return;
    switch (node.kind) {
      case 'command': {
        const spec = catalog.commands[node.command];
        if (!spec) add('unknownCommand', node.id, { name: node.command });
        else if (spec.params.length !== node.args.length) {
          add('paramCount', node.id, { name: plainLabel(node.command, labels), expected: spec.params.length, got: node.args.length });
        }
        break;
      }
      case 'sensor': {
        const spec = catalog.sensors[node.sensor];
        if (!spec) add('unknownSensor', node.id, { name: node.sensor });
        else if (spec.params.length !== node.args.length) {
          add('paramCount', node.id, { name: plainLabel(node.sensor, labels), expected: spec.params.length, got: node.args.length });
        }
        break;
      }
      case 'call': {
        const n = procs.get(node.procedure);
        if (n === undefined) add('unknownProcedure', node.id, { name: node.procedure });
        else if (n !== node.args.length) add('paramCount', node.id, { name: node.procedure, expected: n, got: node.args.length });
        break;
      }
      case 'param':
        if (!ctx.procedure || !ctx.procedure.params.includes(node.name)) add('unknownParam', node.id, { name: node.name });
        break;
      default:
        break;
    }
  });
  return issues;
}
