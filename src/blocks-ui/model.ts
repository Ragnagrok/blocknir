/**
 * The editor model: a `Program` plus an insertion cursor, edited by small operations (insert, move,
 * delete, duplicate, fill a slot, define procedures…) with undo and redo. No DOM: the view turns
 * gestures into these calls, and tests drive them directly.
 *
 * Every operation either applies whole and returns `{ ok: true }`, or changes nothing and says why.
 * Node ids stay stable across edits; new nodes get fresh ids that never repeat in this model.
 */
import {
  childBlocks,
  childExprs,
  countBlocks,
  ensureIds,
  walkProgram,
  type EventSpec,
  type Expr,
  type Handler,
  type Node,
  type NodeId,
  type Procedure,
  type Program,
  type Statement,
  type Value,
} from '../blocks/index.js';
import { hole, type Schema } from './schema.js';

// ---------------------------------------------------------------------------------------------
// Places in a program
// ---------------------------------------------------------------------------------------------

/** A list of statements: the main stack, a definition or handler body, or a mouth of a C-block. */
export type ListRef =
  | { kind: 'main' }
  | { kind: 'procedure'; id: NodeId }
  | { kind: 'handler'; id: NodeId }
  /** `branch` 0 is the body of `repeat` / `repeatUntil` or the `then` of `if`; 1 is the `else`. */
  | { kind: 'body'; id: NodeId; branch: 0 | 1 };

/** A position between statements: `index` 0 is before the first one. */
export interface Spot {
  list: ListRef;
  index: number;
}

/** A slot of a statement or reporter, numbered in `childExprs` order (`{0}`, `{1}` in labels). */
export interface SlotRef {
  parent: NodeId;
  slot: number;
}

/** Why an operation did nothing. */
export type Refusal =
  | 'readOnly'
  | 'notFound'
  /** The block would go inside itself. */
  | 'cycle'
  /** The reporter's value does not fit the slot. */
  | 'type'
  /** A parameter used outside its procedure. */
  | 'scope'
  /** Over the level's block budget with `strictPar`. */
  | 'par'
  /** An empty name. */
  | 'name'
  /** The name is already taken. */
  | 'duplicateName'
  /** Already at the top or bottom. */
  | 'edge'
  | 'invalid';

export type EditResult = { ok: true; id?: NodeId } | { ok: false; reason: Refusal };

const OK: EditResult = { ok: true };
const no = (reason: Refusal): EditResult => ({ ok: false, reason });

/** A string key for a list (for DOM attributes and maps). */
export function listKey(ref: ListRef): string {
  switch (ref.kind) {
    case 'main':
      return 'main';
    case 'procedure':
      return `p:${ref.id}`;
    case 'handler':
      return `h:${ref.id}`;
    case 'body':
      return `b:${ref.branch}:${ref.id}`;
  }
}

/** The inverse of `listKey`. */
export function parseListKey(key: string): ListRef | null {
  if (key === 'main') return { kind: 'main' };
  if (key.startsWith('p:')) return { kind: 'procedure', id: key.slice(2) };
  if (key.startsWith('h:')) return { kind: 'handler', id: key.slice(2) };
  const m = /^b:([01]):(.+)$/.exec(key);
  if (m) return { kind: 'body', id: m[2]!, branch: m[1] === '1' ? 1 : 0 };
  return null;
}

export function sameList(a: ListRef, b: ListRef): boolean {
  return listKey(a) === listKey(b);
}

/** The statements of a list, or null if it does not exist. */
export function getList(program: Program, ref: ListRef): Statement[] | null {
  switch (ref.kind) {
    case 'main':
      return program.main;
    case 'procedure':
      return program.procedures?.find((p) => p.id === ref.id)?.body ?? null;
    case 'handler':
      return program.handlers?.find((h) => h.id === ref.id)?.body ?? null;
    case 'body': {
      const s = findStatement(program, ref.id);
      if (!s) return null;
      if (s.kind === 'repeat' || s.kind === 'repeatUntil') return ref.branch === 0 ? s.body : null;
      if (s.kind === 'if') return ref.branch === 0 ? s.then : (s.else ?? null);
      return null;
    }
  }
}

/** The lists directly inside a statement, with their refs. */
export function innerLists(s: Statement): Array<{ ref: ListRef; list: Statement[] }> {
  return childBlocks(s).map((list, i) => ({ ref: { kind: 'body', id: s.id, branch: i === 0 ? 0 : 1 }, list }));
}

/** The top-level lists of a program: main, each procedure body, each handler body. */
export function topLists(program: Program): Array<{ ref: ListRef; list: Statement[] }> {
  return [
    { ref: { kind: 'main' }, list: program.main },
    ...(program.procedures ?? []).map((p) => ({ ref: { kind: 'procedure', id: p.id } as ListRef, list: p.body })),
    ...(program.handlers ?? []).map((h) => ({ ref: { kind: 'handler', id: h.id } as ListRef, list: h.body })),
  ];
}

function eachList(program: Program, visit: (ref: ListRef, list: Statement[]) => boolean | void): void {
  const walk = (ref: ListRef, list: Statement[]): boolean => {
    if (visit(ref, list) === true) return true;
    for (const s of list) for (const inner of innerLists(s)) if (walk(inner.ref, inner.list)) return true;
    return false;
  };
  for (const { ref, list } of topLists(program)) if (walk(ref, list)) return;
}

/** Where a statement is. */
export function locateStatement(program: Program, id: NodeId): Spot | null {
  let found: Spot | null = null;
  eachList(program, (ref, list) => {
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) return false;
    found = { list: ref, index: i };
    return true;
  });
  return found;
}

/** The statement with this id. */
export function findStatement(program: Program, id: NodeId): Statement | null {
  let found: Statement | null = null;
  eachList(program, (_, list) => {
    const s = list.find((x) => x.id === id);
    if (s) found = s;
    return !!s;
  });
  return found;
}

/** Every node of a program by id. */
export function nodeIndex(program: Program): Map<NodeId, Node> {
  const m = new Map<NodeId, Node>();
  walkProgram(program, (n) => m.set(n.id, n));
  return m;
}

/** The slot an expression sits in. */
export function locateExpr(program: Program, id: NodeId): SlotRef | null {
  let found: SlotRef | null = null;
  walkProgram(program, (n) => {
    if (found || !('kind' in n)) return;
    const kids = childExprs(n);
    const i = kids.findIndex((k) => k.id === id);
    if (i >= 0) found = { parent: n.id, slot: i };
  });
  return found;
}

/** The expression in a slot. */
export function getSlot(program: Program, ref: SlotRef): Expr | null {
  const n = nodeIndex(program).get(ref.parent);
  if (!n || !('kind' in n)) return null;
  return childExprs(n)[ref.slot] ?? null;
}

function setChild(node: Expr | Statement, slot: number, e: Expr): boolean {
  switch (node.kind) {
    case 'command':
    case 'call':
    case 'sensor':
      if (slot >= node.args.length) return false;
      node.args[slot] = e;
      return true;
    case 'arith':
    case 'compare':
    case 'and':
    case 'or':
      if (slot === 0) node.left = e;
      else if (slot === 1) node.right = e;
      else return false;
      return true;
    case 'not':
    case 'dirOp':
      if (slot !== 0) return false;
      node.operand = e;
      return true;
    case 'repeat':
      if (slot !== 0) return false;
      node.times = e;
      return true;
    case 'repeatUntil':
      if (slot !== 0) return false;
      node.until = e;
      return true;
    case 'if':
      if (slot !== 0) return false;
      node.condition = e;
      return true;
    case 'set':
      if (slot !== 0) return false;
      node.value = e;
      return true;
    case 'change':
      if (slot !== 0) return false;
      node.by = e;
      return true;
    case 'wait':
      if (slot !== 0) return false;
      node.ticks = e;
      return true;
    default:
      return false;
  }
}

/** Every node inside a statement or expression, itself included. */
export function subtree(node: Statement | Expr): Array<Statement | Expr> {
  const out: Array<Statement | Expr> = [];
  const visit = (n: Statement | Expr): void => {
    out.push(n);
    for (const e of childExprs(n)) visit(e);
    if (!isExpr(n)) for (const list of childBlocks(n)) for (const s of list) visit(s);
  };
  visit(node);
  return out;
}

const STATEMENT_KINDS = new Set(['command', 'call', 'repeat', 'repeatUntil', 'if', 'set', 'change', 'wait']);

/** Whether a node is an expression rather than a statement. */
export function isExpr(n: Statement | Expr): n is Expr {
  return !STATEMENT_KINDS.has(n.kind);
}

/** The procedure whose definition contains a list (or a node), if any. */
export function procedureOf(program: Program, at: ListRef | NodeId): Procedure | null {
  let target: NodeId;
  if (typeof at !== 'string') {
    const ref = at;
    if (ref.kind === 'procedure') return program.procedures?.find((p) => p.id === ref.id) ?? null;
    if (ref.kind !== 'body') return null;
    target = ref.id;
  } else target = at;
  let found: Procedure | null = null;
  walkProgram(program, (n, ctx) => {
    if (!found && n.id === target) found = ctx.procedure;
  });
  return found;
}

/** Every insertion spot of a program, in reading order (a mouth's spots come inside its block). */
export function spots(program: Program): Spot[] {
  const out: Spot[] = [];
  const walk = (ref: ListRef, list: readonly Statement[]): void => {
    list.forEach((s, i) => {
      out.push({ list: ref, index: i });
      for (const inner of innerLists(s)) walk(inner.ref, inner.list);
    });
    out.push({ list: ref, index: list.length });
  };
  for (const { ref, list } of topLists(program)) walk(ref, list);
  return out;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Fills in missing arrays and ids of a program from outside. */
export function normalizeProgram(program: Program, prefix: string): Program {
  const p = ensureIds(
    {
      main: Array.isArray(program?.main) ? program.main : [],
      procedures: Array.isArray(program?.procedures) ? program.procedures : [],
      handlers: Array.isArray(program?.handlers) ? program.handlers : [],
    },
    prefix,
  );
  return { main: p.main, procedures: p.procedures ?? [], handlers: p.handlers ?? [] };
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

/** The saved form of an editor's work. */
export interface SavedProgram {
  format: 'ragnagrok-blocks';
  version: 1;
  /** The level it was made for, if known. */
  level?: string;
  program: Program;
  /** Variables created but not used yet. */
  variables?: string[];
}

/** Turns a program (and the variables created in the editor) into JSON text for saving. */
export function serializeProgram(program: Program, options: { level?: string; variables?: readonly string[] } = {}): string {
  const saved: SavedProgram = { format: 'ragnagrok-blocks', version: 1, program };
  if (options.level !== undefined) saved.level = options.level;
  if (options.variables?.length) saved.variables = [...options.variables];
  return JSON.stringify(saved);
}

/** Reads saved JSON (a `SavedProgram`, or a bare `Program`). Null if it is not one. */
export function deserializeProgram(text: string): { program: Program; variables: string[]; level?: string } | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<SavedProgram> & Partial<Program>;
  const program = d.format === 'ragnagrok-blocks' ? d.program : (d as Program);
  if (!program || !Array.isArray(program.main)) return null;
  const variables = Array.isArray(d.variables) ? d.variables.filter((v): v is string => typeof v === 'string') : [];
  const out: { program: Program; variables: string[]; level?: string } = { program, variables };
  if (typeof d.level === 'string') out.level = d.level;
  return out;
}

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

interface Snapshot {
  program: string;
  cursor: Spot;
  variables: string[];
}

/** What changed, for listeners. */
export interface ModelChange {
  /** The operation (`insert`, `move`, `remove`, `undo`…). */
  op: string;
  /** The node the operation made or touched, if any. */
  id?: NodeId;
}

export interface ModelOptions {
  program?: Program;
  /** Prefix of new ids. Default `k`. */
  idPrefix?: string;
  /** Undo steps kept. Default 200. */
  historyLimit?: number;
  /** Variables created but not used yet. */
  variables?: string[];
}

export class EditorModel {
  readonly schema: Schema;
  private current: Program;
  private cursorSpot: Spot = { list: { kind: 'main' }, index: 0 };
  private extraVars: string[];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private readonly prefix: string;
  private readonly historyLimit: number;
  private counter = 0;
  private listeners = new Set<(change: ModelChange) => void>();
  /** When true, every edit is refused with `readOnly`. */
  readOnly = false;

  constructor(schema: Schema, options: ModelOptions = {}) {
    this.schema = schema;
    this.prefix = options.idPrefix ?? 'k';
    this.historyLimit = options.historyLimit ?? 200;
    this.current = normalizeProgram(options.program ?? { main: [] }, this.prefix);
    this.extraVars = [...(options.variables ?? [])];
    this.syncCounter();
    this.cursorSpot = { list: { kind: 'main' }, index: this.current.main.length };
  }

  // -------------------------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------------------------

  /** The live program. Do not mutate it; use `getProgram()` for a copy. */
  get program(): Readonly<Program> {
    return this.current;
  }

  /** A deep copy of the program: a valid AST with stable ids. */
  getProgram(): Program {
    return clone(this.current);
  }

  get cursor(): Spot {
    return { list: { ...this.cursorSpot.list }, index: this.cursorSpot.index };
  }

  /** Every variable a program can use (level, in use, created). */
  get variables(): string[] {
    return this.schema.variables(this.current, this.extraVars);
  }

  /** Variables created in the editor and not in the program yet (saved with `serialize`). */
  get createdVariables(): string[] {
    return [...this.extraVars];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Blocks counted as the level counts them. */
  get blockCount(): number {
    return countBlocks(this.current, this.schema.par?.scope ?? 'main');
  }

  node(id: NodeId): Node | null {
    return nodeIndex(this.current).get(id) ?? null;
  }

  /** The procedure the cursor is in, if any (its parameters are offered in the palette). */
  get cursorProcedure(): Procedure | null {
    return procedureOf(this.current, this.cursorSpot.list);
  }

  /** How many calls a procedure has. */
  callCount(name: string): number {
    let n = 0;
    walkProgram(this.current, (node) => {
      if ('kind' in node && node.kind === 'call' && node.procedure === name) n++;
    });
    return n;
  }

  /** A generator of fresh ids for nodes about to be inserted (`schema.instantiate`). */
  readonly newId = (): NodeId => {
    const used = nodeIndex(this.current);
    let id: string;
    do id = `${this.prefix}${++this.counter}`;
    while (used.has(id));
    return id;
  };

  subscribe(fn: (change: ModelChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // -------------------------------------------------------------------------------------------
  // Whole program and history
  // -------------------------------------------------------------------------------------------

  /** Replaces the program. With `history` (default true) it can be undone. */
  setProgram(program: Program, options: { history?: boolean; variables?: string[] } = {}): void {
    if (options.history === false) {
      this.undoStack = [];
      this.redoStack = [];
    } else this.pushUndo();
    this.current = normalizeProgram(clone(program), this.prefix);
    if (options.variables) this.extraVars = [...options.variables];
    this.syncCounter();
    this.cursorSpot = { list: { kind: 'main' }, index: this.current.main.length };
    this.emit({ op: 'setProgram' });
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.emit({ op: 'undo' });
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.emit({ op: 'redo' });
    return true;
  }

  /** Moves the insertion cursor (clamped to the list). Not an edit: no history. */
  setCursor(spot: Spot): boolean {
    const list = getList(this.current, spot.list);
    if (!list) return false;
    this.cursorSpot = { list: { ...spot.list }, index: Math.max(0, Math.min(list.length, spot.index)) };
    this.emit({ op: 'cursor' });
    return true;
  }

  /** Moves the cursor to the next or previous spot in reading order. */
  stepCursor(delta: 1 | -1): boolean {
    const all = spots(this.current);
    const i = all.findIndex((s) => sameList(s.list, this.cursorSpot.list) && s.index === this.cursorSpot.index);
    const next = all[i + delta];
    if (!next) return false;
    return this.setCursor(next);
  }

  // -------------------------------------------------------------------------------------------
  // Statements
  // -------------------------------------------------------------------------------------------

  /**
   * Inserts a new statement (with fresh ids, from `schema.instantiate`) at a spot, or at the
   * cursor. The cursor moves after it, or into its first mouth with `enter`.
   */
  insert(stmt: Statement, at: Spot = this.cursorSpot, options: { enter?: boolean } = {}): EditResult {
    return this.edit('insert', stmt.id, (p) => {
      const list = getList(p, at.list);
      if (!list) return no('notFound');
      if (!this.paramsInScope(stmt, procedureOf(p, at.list))) return no('scope');
      const index = clampIndex(at.index, list);
      list.splice(index, 0, clone(stmt));
      const inner = innerLists(stmt)[0];
      this.cursorSpot = options.enter && inner ? { list: inner.ref, index: 0 } : { list: at.list, index: index + 1 };
      return { ok: true, id: stmt.id };
    });
  }

  /** Moves a statement to a spot (positions count as if the statement were still in place). */
  move(id: NodeId, to: Spot): EditResult {
    return this.edit('move', id, (p) => {
      const from = locateStatement(p, id);
      if (!from) return no('notFound');
      const stmt = getList(p, from.list)![from.index]!;
      if (subtree(stmt).some((n) => to.list.kind === 'body' && n.id === to.list.id)) return no('cycle');
      if (!this.paramsInScope(stmt, procedureOf(p, to.list))) return no('scope');
      const target = getList(p, to.list);
      if (!target) return no('notFound');
      let index = clampIndex(to.index, target);
      const src = getList(p, from.list)!;
      if (src === target && index > from.index) index--;
      src.splice(from.index, 1);
      target.splice(index, 0, stmt);
      return { ok: true, id };
    });
  }

  /** Moves a statement one place up: past its neighbour, or out of the top of its mouth. */
  moveUp(id: NodeId): EditResult {
    return this.shift(id, -1);
  }

  /** Moves a statement one place down: past its neighbour, or out of the bottom of its mouth. */
  moveDown(id: NodeId): EditResult {
    return this.shift(id, 1);
  }

  private shift(id: NodeId, dir: 1 | -1): EditResult {
    return this.edit(dir < 0 ? 'moveUp' : 'moveDown', id, (p) => {
      const from = locateStatement(p, id);
      if (!from) return no('notFound');
      const list = getList(p, from.list)!;
      const stmt = list[from.index]!;
      const j = from.index + dir;
      if (j >= 0 && j < list.length) {
        list.splice(from.index, 1);
        list.splice(j, 0, stmt);
        return { ok: true, id };
      }
      if (from.list.kind !== 'body') return no('edge');
      const parentRef = from.list;
      const parent = findStatement(p, parentRef.id) as Statement;
      // Between the two mouths of an if / else.
      if (parent.kind === 'if' && parent.else) {
        const other = parentRef.branch === 0 ? parent.else : parent.then;
        if ((dir > 0 && parentRef.branch === 0) || (dir < 0 && parentRef.branch === 1)) {
          list.splice(from.index, 1);
          if (dir > 0) other.unshift(stmt);
          else other.push(stmt);
          return { ok: true, id };
        }
      }
      const at = locateStatement(p, parentRef.id)!;
      const outer = getList(p, at.list)!;
      list.splice(from.index, 1);
      outer.splice(dir < 0 ? at.index : at.index + 1, 0, stmt);
      return { ok: true, id };
    });
  }

  /** Copies a statement (with everything inside) right after it. */
  duplicate(id: NodeId): EditResult {
    const at = locateStatement(this.current, id);
    if (!at) return no('notFound');
    const copy = this.withFreshIds(getList(this.current, at.list)![at.index]!);
    const r = this.insert(copy, { list: at.list, index: at.index + 1 });
    return r.ok ? { ok: true, id: copy.id } : r;
  }

  /**
   * Removes a node: a statement (and its contents), a reporter (its slot is emptied), a procedure
   * definition (with all its calls) or an event handler.
   */
  remove(id: NodeId): EditResult {
    if (this.current.procedures?.some((p) => p.id === id)) return this.removeProcedure(id);
    return this.edit('remove', id, (p) => {
      const hi = p.handlers!.findIndex((h) => h.id === id);
      if (hi >= 0) {
        p.handlers!.splice(hi, 1);
        return OK;
      }
      const at = locateStatement(p, id);
      if (at) {
        getList(p, at.list)!.splice(at.index, 1);
        if (this.cursorInside(p, id)) this.cursorSpot = { ...at };
        return OK;
      }
      const slot = locateExpr(p, id);
      if (!slot) return no('notFound');
      return this.resetSlot(p, slot) ? OK : no('notFound');
    });
  }

  // -------------------------------------------------------------------------------------------
  // Slots
  // -------------------------------------------------------------------------------------------

  /** Puts a new reporter (fresh ids) in a slot, replacing what was there. */
  putExpr(expr: Expr, slot: SlotRef): EditResult {
    return this.edit('put', expr.id, (p) => this.place(p, clone(expr), slot));
  }

  /** Moves a reporter from its slot to another; the old slot is emptied. */
  moveExpr(id: NodeId, slot: SlotRef): EditResult {
    return this.edit('moveExpr', id, (p) => {
      const from = locateExpr(p, id);
      if (!from) return no('notFound');
      if (from.parent === slot.parent && from.slot === slot.slot) return no('invalid');
      const expr = getSlot(p, from)!;
      if (subtree(expr).some((n) => n.id === slot.parent)) return no('cycle');
      this.resetSlot(p, from);
      return this.place(p, expr, slot);
    });
  }

  /** Types or chooses a value in a slot (a number, a direction, a name, yes or no). */
  setValue(slot: SlotRef, value: Value): EditResult {
    return this.edit('value', slot.parent, (p) => {
      const parent = nodeIndex(p).get(slot.parent);
      if (!parent || !('kind' in parent)) return no('notFound');
      const spec = this.schema.slots(parent)[slot.slot];
      const old = childExprs(parent)[slot.slot];
      if (!spec || !old) return no('notFound');
      if (typeof value === 'number' && !Number.isFinite(value)) return no('type');
      const keepId = old.kind === 'number' || old.kind === 'boolean' || old.kind === 'direction' || old.kind === 'name';
      const lit = this.schema.literal(keepId ? old.id : this.newIdFor(p), value, spec.type);
      if (!this.schema.fits(this.schema.returns(lit), spec.type)) return no('type');
      setChild(parent, slot.slot, lit);
      return { ok: true, id: lit.id };
    });
  }

  /** Empties a slot (its default value, or a hole). */
  clearSlot(slot: SlotRef): EditResult {
    return this.edit('clear', slot.parent, (p) => (this.resetSlot(p, slot) ? OK : no('notFound')));
  }

  /** Chooses the variable of a `set` / `change` block or a variable reporter. */
  setVariable(id: NodeId, name: string): EditResult {
    const v = name.trim();
    if (!v) return no('name');
    return this.edit('variable', id, (p) => {
      const n = nodeIndex(p).get(id);
      if (!n || !('kind' in n)) return no('notFound');
      if (n.kind === 'set' || n.kind === 'change') n.variable = v;
      else if (n.kind === 'var') n.name = v;
      else return no('invalid');
      return { ok: true, id };
    });
  }

  /** Creates a variable (offered in the palette until it is used). */
  addVariable(name: string): EditResult {
    const v = name.trim();
    if (!v) return no('name');
    if (this.variables.includes(v)) return no('duplicateName');
    return this.edit('addVariable', undefined, () => {
      this.extraVars.push(v);
      return OK;
    });
  }

  // -------------------------------------------------------------------------------------------
  // Procedures and handlers
  // -------------------------------------------------------------------------------------------

  /** Defines a new procedure ("Enseñar a Bolo: name"). The cursor moves into its body. */
  addProcedure(name: string, params: string[] = []): EditResult {
    const n = name.trim();
    if (!n) return no('name');
    if (this.current.procedures!.some((p) => p.name === n)) return no('duplicateName');
    if (new Set(params).size !== params.length || params.some((x) => !x.trim())) return no('name');
    const id = this.newId();
    return this.edit('addProcedure', id, (p) => {
      p.procedures!.push({ id, name: n, params: [...params], body: [] });
      this.cursorSpot = { list: { kind: 'procedure', id }, index: 0 };
      return { ok: true, id };
    });
  }

  /** Renames a procedure and every call of it. */
  renameProcedure(id: NodeId, name: string): EditResult {
    const n = name.trim();
    if (!n) return no('name');
    return this.edit('renameProcedure', id, (p) => {
      const proc = p.procedures!.find((x) => x.id === id);
      if (!proc) return no('notFound');
      if (proc.name === n) return no('invalid');
      if (p.procedures!.some((x) => x.id !== id && x.name === n)) return no('duplicateName');
      const old = proc.name;
      proc.name = n;
      walkProgram(p, (node) => {
        if ('kind' in node && node.kind === 'call' && node.procedure === old) node.procedure = n;
      });
      return { ok: true, id };
    });
  }

  /** Deletes a procedure definition and every call of it. */
  removeProcedure(id: NodeId): EditResult {
    return this.edit('removeProcedure', id, (p) => {
      const i = p.procedures!.findIndex((x) => x.id === id);
      if (i < 0) return no('notFound');
      const name = p.procedures![i]!.name;
      p.procedures!.splice(i, 1);
      const strip = (list: Statement[]): void => {
        for (let k = list.length - 1; k >= 0; k--) {
          const s = list[k]!;
          if (s.kind === 'call' && s.procedure === name) list.splice(k, 1);
          else for (const inner of childBlocks(s)) strip(inner);
        }
      };
      for (const { list } of topLists(p)) strip(list);
      return OK;
    });
  }

  /** Adds a parameter; every call gets a new slot. */
  addParam(procId: NodeId, name: string): EditResult {
    const n = name.trim();
    if (!n) return no('name');
    return this.edit('addParam', procId, (p) => {
      const proc = p.procedures!.find((x) => x.id === procId);
      if (!proc) return no('notFound');
      if (proc.params.includes(n)) return no('duplicateName');
      proc.params.push(n);
      walkProgram(p, (node) => {
        if ('kind' in node && node.kind === 'call' && node.procedure === proc.name) node.args.push({ id: this.newIdFor(p), kind: 'number', value: 1 });
      });
      return { ok: true, id: procId };
    });
  }

  /** Renames a parameter and its uses inside the procedure. */
  renameParam(procId: NodeId, from: string, to: string): EditResult {
    const n = to.trim();
    if (!n) return no('name');
    return this.edit('renameParam', procId, (p) => {
      const proc = p.procedures!.find((x) => x.id === procId);
      if (!proc) return no('notFound');
      const i = proc.params.indexOf(from);
      if (i < 0) return no('notFound');
      if (from === n) return no('invalid');
      if (proc.params.includes(n)) return no('duplicateName');
      proc.params[i] = n;
      for (const s of proc.body) for (const node of subtree(s)) if (node.kind === 'param' && node.name === from) node.name = n;
      return { ok: true, id: procId };
    });
  }

  /** Removes a parameter: its slot in every call, and its uses (they become holes). */
  removeParam(procId: NodeId, name: string): EditResult {
    return this.edit('removeParam', procId, (p) => {
      const proc = p.procedures!.find((x) => x.id === procId);
      if (!proc) return no('notFound');
      const i = proc.params.indexOf(name);
      if (i < 0) return no('notFound');
      proc.params.splice(i, 1);
      walkProgram(p, (node) => {
        if ('kind' in node && node.kind === 'call' && node.procedure === proc.name) node.args.splice(i, 1);
      });
      const uses: string[] = [];
      for (const s of proc.body) for (const node of subtree(s)) if (node.kind === 'param' && node.name === name) uses.push(node.id);
      for (const use of uses) {
        const slot = locateExpr(p, use);
        if (slot) this.resetSlot(p, slot);
      }
      return { ok: true, id: procId };
    });
  }

  /** Adds an event handler (realtime levels). The cursor moves into its body. */
  addHandler(event: EventSpec): EditResult {
    const id = this.newId();
    return this.edit('addHandler', id, (p) => {
      p.handlers!.push({ id, event: clone(event), body: [] });
      this.cursorSpot = { list: { kind: 'handler', id }, index: 0 };
      return { ok: true, id };
    });
  }

  /** Changes what wakes a handler (`Al apretar ←` → `Al apretar →`). */
  setHandlerEvent(id: NodeId, event: EventSpec): EditResult {
    return this.edit('handlerEvent', id, (p) => {
      const h = p.handlers!.find((x: Handler) => x.id === id);
      if (!h) return no('notFound');
      h.event = clone(event);
      return { ok: true, id };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private place(p: Program, expr: Expr, slot: SlotRef): EditResult {
    const parent = nodeIndex(p).get(slot.parent);
    if (!parent || !('kind' in parent)) return no('notFound');
    const spec = this.schema.slots(parent)[slot.slot];
    if (!spec) return no('notFound');
    if (!this.schema.fits(this.schema.returns(expr), spec.type)) return no('type');
    if (!this.paramsInScope(expr, procedureOf(p, slot.parent))) return no('scope');
    setChild(parent, slot.slot, expr);
    return { ok: true, id: expr.id };
  }

  private resetSlot(p: Program, slot: SlotRef): boolean {
    const parent = nodeIndex(p).get(slot.parent);
    if (!parent || !('kind' in parent)) return false;
    const spec = this.schema.slots(parent)[slot.slot];
    if (!spec) return false;
    const key = parent.kind === 'command' ? parent.command : parent.kind;
    const e = spec.type === 'boolean' ? hole(this.newIdFor(p)) : this.schema.emptyExpr(this.newIdFor(p), spec, key);
    return setChild(parent, slot.slot, e);
  }

  private paramsInScope(node: Statement | Expr, proc: Procedure | null): boolean {
    return subtree(node).every((n) => n.kind !== 'param' || (proc !== null && proc.params.includes(n.name)));
  }

  private cursorInside(p: Program, id: NodeId): boolean {
    let list: ListRef = this.cursorSpot.list;
    for (;;) {
      if (list.kind !== 'body') return false;
      if (list.id === id) return true;
      const at = locateStatement(p, list.id);
      if (!at) return true;
      list = at.list;
    }
  }

  private newIdFor(p: Program): NodeId {
    const used = nodeIndex(p);
    let id: string;
    do id = `${this.prefix}${++this.counter}`;
    while (used.has(id) || nodeIndex(this.current).has(id));
    return id;
  }

  private withFreshIds<T extends Statement | Expr>(node: T): T {
    const copy = clone(node);
    const used = nodeIndex(this.current);
    for (const n of subtree(copy)) {
      let id: string;
      do id = `${this.prefix}${++this.counter}`;
      while (used.has(id));
      n.id = id;
    }
    return copy;
  }

  private syncCounter(): void {
    const re = new RegExp(`^${this.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
    let max = this.counter;
    walkProgram(this.current, (n) => {
      const m = re.exec(n.id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    this.counter = max;
  }

  private snapshot(): Snapshot {
    return { program: JSON.stringify(this.current), cursor: this.cursor, variables: [...this.extraVars] };
  }

  private restore(s: Snapshot): void {
    this.current = JSON.parse(s.program) as Program;
    this.extraVars = [...s.variables];
    this.cursorSpot = s.cursor;
    this.fixCursor(null);
  }

  private pushUndo(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Runs an edit on a copy. On success: the par check (strict levels refuse edits that add
   * blocks beyond the budget), history, cursor repair and listeners.
   */
  private edit(op: string, id: NodeId | undefined, fn: (draft: Program) => EditResult): EditResult {
    if (this.readOnly) return no('readOnly');
    const draft = clone(this.current);
    const before = this.snapshot();
    const beforeCursor = this.cursorAnchor();
    const vars = [...this.extraVars];
    const r = fn(draft);
    if (!r.ok) {
      this.cursorSpot = before.cursor;
      this.extraVars = vars;
      return r;
    }
    const par = this.schema.par;
    if (par?.strict) {
      const was = countBlocks(this.current, par.scope);
      const now = countBlocks(draft, par.scope);
      if (now > par.limit && now > was) {
        this.cursorSpot = before.cursor;
        this.extraVars = vars;
        return no('par');
      }
    }
    this.undoStack.push(before);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
    const cursorMoved = this.cursorSpot !== before.cursor && !(sameList(this.cursorSpot.list, before.cursor.list) && this.cursorSpot.index === before.cursor.index);
    this.current = draft;
    if (!cursorMoved) this.fixCursor(beforeCursor);
    else this.fixCursor(null);
    const change: ModelChange = { op };
    const changed = r.id ?? id;
    if (changed !== undefined) change.id = changed;
    this.emit(change);
    return r;
  }

  /** The cursor as "before statement X in list L", which survives moves of other blocks. */
  private cursorAnchor(): { list: ListRef; before: NodeId | null; index: number } {
    const list = getList(this.current, this.cursorSpot.list) ?? [];
    return { list: this.cursorSpot.list, before: list[this.cursorSpot.index]?.id ?? null, index: this.cursorSpot.index };
  }

  private fixCursor(anchor: { list: ListRef; before: NodeId | null; index: number } | null): void {
    if (anchor) {
      const list = getList(this.current, anchor.list);
      if (list) {
        const i = anchor.before === null ? list.length : list.findIndex((s) => s.id === anchor.before);
        this.cursorSpot = { list: anchor.list, index: i >= 0 ? i : Math.min(anchor.index, list.length) };
        return;
      }
    }
    const list = getList(this.current, this.cursorSpot.list);
    if (list) this.cursorSpot = { list: this.cursorSpot.list, index: clampIndex(this.cursorSpot.index, list) };
    else this.cursorSpot = { list: { kind: 'main' }, index: this.current.main.length };
  }

  private emit(change: ModelChange): void {
    for (const fn of this.listeners) fn(change);
  }
}

function clampIndex(i: number, list: readonly unknown[]): number {
  return Math.max(0, Math.min(list.length, Math.floor(i)));
}
