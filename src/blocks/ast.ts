/**
 * The program model: plain, JSON-serializable trees of blocks. Every node has a stable `id` that the
 * editor keeps across edits, so the interpreter can point at the block that is running or that
 * failed.
 */
import type { Direction, ValueType } from './values.js';

/** A stable node id. Unique within one program. */
export type NodeId = string;

// ---------------------------------------------------------------------------------------------
// Expressions (reporter blocks and slot values)
// ---------------------------------------------------------------------------------------------

/** A number typed into a slot. */
export interface NumberLit {
  id: NodeId;
  kind: 'number';
  value: number;
}

/** `true` or `false` chosen in a slot. */
export interface BooleanLit {
  id: NodeId;
  kind: 'boolean';
  value: boolean;
}

/** A direction chosen in a slot. */
export interface DirectionLit {
  id: NodeId;
  kind: 'direction';
  value: Direction;
}

/** A name chosen in a slot: an item, color, key, sound, look or text. */
export interface NameLit {
  id: NodeId;
  kind: 'name';
  value: string;
}

/** The value of a parameter of the procedure being defined. */
export interface ParamRef {
  id: NodeId;
  kind: 'param';
  name: string;
}

/** The value of a variable. */
export interface VarRef {
  id: NodeId;
  kind: 'var';
  name: string;
}

/** A question to the world (`is there an apple here?`, `can I move north?`), with arguments. */
export interface SensorExpr {
  id: NodeId;
  kind: 'sensor';
  sensor: string;
  args: Expr[];
}

/** Arithmetic operators. `/` is real division; `%` is the remainder. */
export type ArithOp = '+' | '-' | '*' | '/' | '%';

/** `left op right` on numbers. */
export interface ArithExpr {
  id: NodeId;
  kind: 'arith';
  op: ArithOp;
  left: Expr;
  right: Expr;
}

/** Comparison operators. `=` and `!=` compare any two values; the others need numbers. */
export type CompareOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

/** `left op right`, giving a boolean. */
export interface CompareExpr {
  id: NodeId;
  kind: 'compare';
  op: CompareOp;
  left: Expr;
  right: Expr;
}

/** `left and right` / `left or right`, short-circuiting, on booleans. */
export interface LogicExpr {
  id: NodeId;
  kind: 'and' | 'or';
  left: Expr;
  right: Expr;
}

/** `not operand`, on a boolean. */
export interface NotExpr {
  id: NodeId;
  kind: 'not';
  operand: Expr;
}

/** Operations on directions: the opposite one, or the one to the left or right. */
export type DirOp = 'opposite' | 'left' | 'right';

/** `op(operand)` on a direction. */
export interface DirExpr {
  id: NodeId;
  kind: 'dirOp';
  op: DirOp;
  operand: Expr;
}

/** Literal expressions: values typed or chosen in a slot. They do not count as blocks. */
export type Literal = NumberLit | BooleanLit | DirectionLit | NameLit;

/** Any expression. */
export type Expr = Literal | ParamRef | VarRef | SensorExpr | ArithExpr | CompareExpr | LogicExpr | NotExpr | DirExpr;

// ---------------------------------------------------------------------------------------------
// Statements (stackable blocks)
// ---------------------------------------------------------------------------------------------

/** A primitive command of the world (`move N`, `pick apple`) or a level-defined action. */
export interface CommandStmt {
  id: NodeId;
  kind: 'command';
  command: string;
  args: Expr[];
}

/** A call of a user procedure by name. */
export interface CallStmt {
  id: NodeId;
  kind: 'call';
  procedure: string;
  args: Expr[];
}

/** `repeat times { body }`. `times` must be a whole number, 0 or more. */
export interface RepeatStmt {
  id: NodeId;
  kind: 'repeat';
  times: Expr;
  body: Statement[];
}

/** `repeat until condition { body }`. The condition is checked before each round. */
export interface RepeatUntilStmt {
  id: NodeId;
  kind: 'repeatUntil';
  until: Expr;
  body: Statement[];
}

/** `if condition { then }`, or `if/else` when `else` is present (even if empty). */
export interface IfStmt {
  id: NodeId;
  kind: 'if';
  condition: Expr;
  then: Statement[];
  else?: Statement[];
}

/** `set variable to value`. */
export interface SetStmt {
  id: NodeId;
  kind: 'set';
  variable: string;
  value: Expr;
}

/** `change variable by amount`: adds the number, or subtracts it with `op: '-'` (a "subtract" block). */
export interface ChangeStmt {
  id: NodeId;
  kind: 'change';
  variable: string;
  by: Expr;
  op?: '+' | '-';
}

/** `wait ticks`. In realtime worlds it pauses the script; in step worlds it is a visible pause. */
export interface WaitStmt {
  id: NodeId;
  kind: 'wait';
  ticks: Expr;
}

/** Any statement. */
export type Statement = CommandStmt | CallStmt | RepeatStmt | RepeatUntilStmt | IfStmt | SetStmt | ChangeStmt | WaitStmt;

// ---------------------------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------------------------

/** A user procedure: a named, reusable list of statements with parameters. */
export interface Procedure {
  id: NodeId;
  /** The name the child gave it. Calls refer to it by this name. */
  name: string;
  /** Parameter names, in call order. */
  params: string[];
  /**
   * What each parameter takes, parallel to `params` (missing or shorter: `any`). The same shape
   * as a command's slots: `{ type: 'direction' }`, `{ type: 'name', name: 'color' }`. Editors offer
   * values of that type in the call's slot; a call with a value of another type stops the run.
   */
  types?: Array<{ type: ValueType; name?: string }>;
  body: Statement[];
}

/** What wakes up an event handler in a realtime world. */
export type EventSpec =
  /** Once, when the game starts (the same as `main`). */
  | { type: 'start' }
  /** When a key or on-screen button is pressed (`left`, `right`, `up`, `down`, `action`…). */
  | { type: 'key'; key: string }
  /** Every tick, or every `every` ticks (on ticks `every`, `2 * every`…). */
  | { type: 'tick'; every?: number }
  /** When this actor starts touching an actor of kind `what`, or enters a tile named `what`. */
  | { type: 'touch'; what: string };

/** The kinds of event handler. */
export type EventType = EventSpec['type'];

/** An event handler: `when <event> { body }`. */
export interface Handler {
  id: NodeId;
  event: EventSpec;
  body: Statement[];
}

/**
 * A whole program. `main` runs at the start ("when start"); step worlds only run `main`, realtime
 * worlds also run `handlers`.
 */
export interface Program {
  main: Statement[];
  procedures?: Procedure[];
  handlers?: Handler[];
}

/** Any node with an id. */
export type Node = Expr | Statement | Procedure | Handler;

/** Where a node sits, given to `walkProgram` visitors. */
export interface NodeContext {
  /** The procedure the node is inside, if any. */
  procedure: Procedure | null;
  /** The handler the node is inside, if any. */
  handler: Handler | null;
  /** Whether the node is an expression (in a slot) rather than a statement or definition. */
  expression: boolean;
}

/** The expressions directly inside an expression or statement. */
export function childExprs(node: Expr | Statement): Expr[] {
  switch (node.kind) {
    case 'sensor':
    case 'command':
    case 'call':
      return node.args;
    case 'arith':
    case 'compare':
    case 'and':
    case 'or':
      return [node.left, node.right];
    case 'not':
    case 'dirOp':
      return [node.operand];
    case 'repeat':
      return [node.times];
    case 'repeatUntil':
      return [node.until];
    case 'if':
      return [node.condition];
    case 'set':
      return [node.value];
    case 'change':
      return [node.by];
    case 'wait':
      return [node.ticks];
    default:
      return [];
  }
}

/** The statement lists directly inside a statement. */
export function childBlocks(s: Statement): Statement[][] {
  switch (s.kind) {
    case 'repeat':
    case 'repeatUntil':
      return [s.body];
    case 'if':
      return s.else ? [s.then, s.else] : [s.then];
    default:
      return [];
  }
}

/** Visits every node of a program, depth-first in source order: main, procedures, then handlers. */
export function walkProgram(program: Program, visit: (node: Node, ctx: NodeContext) => void): void {
  const expr = (e: Expr, ctx: NodeContext): void => {
    visit(e, ctx);
    for (const c of childExprs(e)) expr(c, ctx);
  };
  const block = (list: readonly Statement[], ctx: NodeContext): void => {
    for (const s of list) {
      visit(s, ctx);
      const ectx = { ...ctx, expression: true };
      for (const c of childExprs(s)) expr(c, ectx);
      for (const b of childBlocks(s)) block(b, ctx);
    }
  };
  block(program.main, { procedure: null, handler: null, expression: false });
  for (const p of program.procedures ?? []) {
    const ctx = { procedure: p, handler: null, expression: false };
    visit(p, ctx);
    block(p.body, ctx);
  }
  for (const h of program.handlers ?? []) {
    const ctx = { procedure: null, handler: h, expression: false };
    visit(h, ctx);
    block(h.body, ctx);
  }
}

/** The node with this id, or null. */
export function findNode(program: Program, id: NodeId): Node | null {
  let found: Node | null = null;
  walkProgram(program, (n) => {
    if (!found && n.id === id) found = n;
  });
  return found;
}

/** Whether a node is a literal (a value in a slot, not a block). */
export function isLiteral(node: Node): node is Literal {
  return 'kind' in node && (node.kind === 'number' || node.kind === 'boolean' || node.kind === 'direction' || node.kind === 'name');
}

/**
 * Returns a deep copy of a program where every node has a unique id: missing or empty ids, and
 * repeated ones after the first, get `${prefix}${n}`. Use it on hand-written or imported JSON.
 */
export function ensureIds(program: Program, prefix = 'b'): Program {
  const copy = JSON.parse(JSON.stringify(program)) as Program;
  const seen = new Set<string>();
  walkProgram(copy, (n) => {
    if (typeof n.id === 'string' && n.id !== '') seen.add(n.id);
  });
  const used = new Set<string>();
  let next = 0;
  const fresh = (): string => {
    let id: string;
    do id = `${prefix}${++next}`;
    while (seen.has(id) || used.has(id));
    return id;
  };
  walkProgram(copy, (n) => {
    const node = n as { id?: string };
    if (typeof node.id !== 'string' || node.id === '' || used.has(node.id)) node.id = fresh();
    used.add(node.id);
  });
  return copy;
}
