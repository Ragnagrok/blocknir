/**
 * Requirements on the program itself, checked without running it: "use a procedure with a
 * parameter, called with at least two different values", "the main stack only calls procedures".
 */
import { walkProgram, type Expr, type Program } from './ast.js';
import type { GoalBase, GoalResult } from './goals.js';
import { formatMessage, type LabelOverrides, type Labels } from './labels.js';
import { plainLabel } from './interpreter.js';
import { blockKey } from './toolbox.js';

/** A requirement on how the program is written. */
export type Requirement = GoalBase &
  (
    /**
     * Blocks with this key (see `blockKey`: a command name, `repeat`, `call`…) appear between `min`
     * and `max` times, in the main stack and handlers only (`in: 'main'`) or anywhere (`all`, default).
     */
    | { type: 'uses'; block: string; min?: number; max?: number; in?: 'main' | 'all' }
    /**
     * Some procedure has at least `params` parameters (default 1), is called at least `minCalls`
     * times (default 1) with at least `distinctCalls` different argument lists (default 1).
     */
    | { type: 'procedure'; params?: number; minCalls?: number; distinctCalls?: number }
  );

/** Default Spanish messages of requirements. */
export const REQUIREMENT_LABELS: LabelOverrides = {
  goals: {
    'requires.min': 'Hay que usar el bloque "{block}" (al menos {min} veces).',
    'requires.max': 'El bloque "{block}" se puede usar hasta {max} veces, y está {count} veces.',
    'requires.procedure': 'Falta un comando definido con {params} huecos, usado con {distinct} valores distintos.',
  },
};

/** An expression as text without ids, to compare call arguments. */
function exprKey(e: Expr): string {
  return JSON.stringify(e, (k, v: unknown) => (k === 'id' ? undefined : v));
}

/** Checks one requirement. */
export function checkRequirement(req: Requirement, program: Program, labels: Labels): GoalResult {
  const no = (key: string, params: Record<string, string | number>): GoalResult => ({
    passed: false,
    reason: formatMessage(req.message ?? labels.goals[key] ?? key, params, labels),
  });
  if (req.type === 'uses') {
    let count = 0;
    walkProgram(program, (node, ctx) => {
      if ((req.in ?? 'all') === 'main' && ctx.procedure) return;
      if (blockKey(node) === req.block) count++;
    });
    const block = plainLabel(req.block, labels);
    if (req.min !== undefined && count < req.min) return no('requires.min', { block, min: req.min, count });
    if (req.max !== undefined && count > req.max) return no('requires.max', { block, max: req.max, count });
    return { passed: true, reason: null };
  }
  const params = req.params ?? 1;
  const minCalls = req.minCalls ?? 1;
  const distinct = req.distinctCalls ?? 1;
  const ok = (program.procedures ?? []).some((p) => {
    if (p.params.length < params) return false;
    const calls: string[] = [];
    walkProgram(program, (node) => {
      if ('kind' in node && node.kind === 'call' && node.procedure === p.name) calls.push(node.args.map(exprKey).join('|'));
    });
    return calls.length >= minCalls && new Set(calls).size >= distinct;
  });
  return ok ? { passed: true, reason: null } : no('requires.procedure', { params, distinct });
}
