/** Errors of the block language: codes, the thrown error class and the serializable report. */
import type { NodeId } from './ast.js';
import type { Value } from './values.js';

/**
 * Every error a program can hit. Messages for children live in the label table under
 * `labels.errors[code]`, with `{param}` placeholders filled from `params`.
 */
export type ErrorCode =
  // world errors
  | 'wall'
  | 'outOfBoard'
  | 'outOfArea'
  | 'noItem'
  | 'notCarrying'
  | 'inventoryFull'
  | 'noLamp'
  | 'noArrow'
  | 'actionFailed'
  // program errors
  | 'stepLimit'
  | 'recursionDepth'
  | 'paramCount'
  | 'argType'
  | 'notBoolean'
  | 'notNumber'
  | 'badCount'
  | 'divisionByZero'
  | 'unknownProcedure'
  | 'unknownCommand'
  | 'unknownSensor'
  | 'unknownParam'
  | 'unknownVariable'
  | 'unknownBlock'
  // static checks
  | 'notAllowed'
  | 'duplicateProcedure'
  | 'duplicateId';

/** Thrown inside worlds and the interpreter. The interpreter fills `nodeId` and the message. */
export class BlockError extends Error {
  readonly code: ErrorCode;
  readonly params: Record<string, Value>;
  nodeId: NodeId | null;

  constructor(code: ErrorCode, params: Record<string, Value> = {}, nodeId: NodeId | null = null) {
    super(code);
    this.name = 'BlockError';
    this.code = code;
    this.params = params;
    this.nodeId = nodeId;
  }
}

/** Throws a `BlockError`. Worlds call it from commands and sensors; the node id is added later. */
export function fail(code: ErrorCode, params: Record<string, Value> = {}): never {
  throw new BlockError(code, params);
}

/** A runtime or static error as plain data, with its message already in the child's language. */
export interface RunError {
  code: ErrorCode;
  /** The block that failed, for highlighting. Null when the error is not tied to a block. */
  nodeId: NodeId | null;
  params: Record<string, Value>;
  message: string;
}
