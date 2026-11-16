/**
 * Small helpers to write programs in code (tests, level harnesses, built-in actor scripts).
 * Each builder numbers its nodes `${prefix}1`, `${prefix}2`…, so ids are stable and readable.
 *
 *     const b = blocks();
 *     const program = b.program([b.repeat(3, b.cmd('move', 'E'), b.cmd('lightLamp'))]);
 */
import type {
  ArithOp,
  CompareOp,
  DirOp,
  EventSpec,
  Expr,
  Handler,
  IfStmt,
  Procedure,
  Program,
  Statement,
} from './ast.js';
import { isDirection } from './values.js';

/** An expression, or a plain value: numbers, booleans, `'N' | 'E' | 'S' | 'W'` (directions) or names. */
export type ExprLike = Expr | number | boolean | string;

/** A builder of nodes with sequential ids. */
export function blocks(prefix = 'n') {
  let n = 0;
  const id = (): string => `${prefix}${++n}`;
  const ex = (v: ExprLike): Expr => {
    if (typeof v === 'object') return v;
    if (typeof v === 'number') return { id: id(), kind: 'number', value: v };
    if (typeof v === 'boolean') return { id: id(), kind: 'boolean', value: v };
    if (isDirection(v)) return { id: id(), kind: 'direction', value: v };
    return { id: id(), kind: 'name', value: v };
  };
  return {
    /** A fresh id. */
    id,
    /** Turns a plain value into a literal. */
    expr: ex,
    num: (value: number): Expr => ({ id: id(), kind: 'number', value }),
    bool: (value: boolean): Expr => ({ id: id(), kind: 'boolean', value }),
    /** A name literal, even for strings that look like directions (a letter `E`). */
    name: (value: string): Expr => ({ id: id(), kind: 'name', value }),
    param: (name: string): Expr => ({ id: id(), kind: 'param', name }),
    v: (name: string): Expr => ({ id: id(), kind: 'var', name }),
    sensor: (sensor: string, ...args: ExprLike[]): Expr => ({ id: id(), kind: 'sensor', sensor, args: args.map(ex) }),
    arith: (op: ArithOp, left: ExprLike, right: ExprLike): Expr => ({ id: id(), kind: 'arith', op, left: ex(left), right: ex(right) }),
    cmp: (op: CompareOp, left: ExprLike, right: ExprLike): Expr => ({ id: id(), kind: 'compare', op, left: ex(left), right: ex(right) }),
    and: (left: ExprLike, right: ExprLike): Expr => ({ id: id(), kind: 'and', left: ex(left), right: ex(right) }),
    or: (left: ExprLike, right: ExprLike): Expr => ({ id: id(), kind: 'or', left: ex(left), right: ex(right) }),
    not: (operand: ExprLike): Expr => ({ id: id(), kind: 'not', operand: ex(operand) }),
    dir: (op: DirOp, operand: ExprLike): Expr => ({ id: id(), kind: 'dirOp', op, operand: ex(operand) }),

    cmd: (command: string, ...args: ExprLike[]): Statement => ({ id: id(), kind: 'command', command, args: args.map(ex) }),
    call: (procedure: string, ...args: ExprLike[]): Statement => ({ id: id(), kind: 'call', procedure, args: args.map(ex) }),
    repeat: (times: ExprLike, ...body: Statement[]): Statement => ({ id: id(), kind: 'repeat', times: ex(times), body }),
    until: (until: ExprLike, ...body: Statement[]): Statement => ({ id: id(), kind: 'repeatUntil', until: ex(until), body }),
    if: (condition: ExprLike, ...then: Statement[]): Statement => ({ id: id(), kind: 'if', condition: ex(condition), then }),
    ifElse: (condition: ExprLike, then: Statement[], otherwise: Statement[]): IfStmt => ({
      id: id(),
      kind: 'if',
      condition: ex(condition),
      then,
      else: otherwise,
    }),
    set: (variable: string, value: ExprLike): Statement => ({ id: id(), kind: 'set', variable, value: ex(value) }),
    change: (variable: string, by: ExprLike): Statement => ({ id: id(), kind: 'change', variable, by: ex(by) }),
    subtract: (variable: string, by: ExprLike): Statement => ({ id: id(), kind: 'change', variable, by: ex(by), op: '-' }),
    wait: (ticks: ExprLike = 1): Statement => ({ id: id(), kind: 'wait', ticks: ex(ticks) }),

    proc: (name: string, params: string[], ...body: Statement[]): Procedure => ({ id: id(), name, params, body }),
    on: (event: EventSpec, ...body: Statement[]): Handler => ({ id: id(), event, body }),
    program: (main: Statement[], procedures: Procedure[] = [], handlers: Handler[] = []): Program => ({ main, procedures, handlers }),
  };
}

/** The type of a builder returned by `blocks()`. */
export type Builder = ReturnType<typeof blocks>;
