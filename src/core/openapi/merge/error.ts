/**
 * The one refusal every stage of the contract delta path raises: a document the
 * planner cannot read, named by which side it came from — and the one way every
 * stage reads and writes a contract, so each of them fails with it identically.
 *
 * It is the package's leaf for the same reason the pin, the markers and the
 * merge each throw it: whichever of them fails, the command above has to map
 * one domain error onto its own envelope. A module that owned the error would
 * be imported by its two siblings for that reason alone.
 *
 * The tree helpers below are axis-neutral and take the refusal to raise as a
 * `fail` callback, because the event axis's six entry points spelled the same
 * parse, first-error, resolve and serialize sequence this axis's did, against
 * its own error class (../../asyncapi/merge/error.ts). Import direction is
 * asyncapi → openapi, as everywhere else on the contract axes.
 */
import { parseDocument, type Document } from "yaml";

// Every `isRecord` below asks one question of a resolved plain tree: is this a
// node that can hold OpenAPI keys — an object, not an array?

export type OpenapiMergeSource = "feature" | "living";

/** A document the merge planner cannot read. Commands map this domain error to their own envelope. */
export class OpenapiMergeError extends Error {
  override readonly name = "OpenapiMergeError";

  constructor(
    readonly source: OpenapiMergeSource,
    readonly service: string,
    detail: string,
  ) {
    super(`${source} openapi for ${service} is not valid YAML: ${detail}`);
  }
}

/** The `fail` the tree helpers take, for one side of this axis. */
export function openapiRefusal(source: OpenapiMergeSource, service: string): (detail: string) => OpenapiMergeError {
  return (detail) => new OpenapiMergeError(source, service, detail);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A contract's AST, for the writes, and its resolved plain tree, for every shape question. */
export interface ContractTree {
  doc: Document.Parsed;
  plain: unknown;
}

/**
 * Parse a contract, refuse its first parse error, and resolve it. `check` runs
 * between the two, on the AST: the event axis refuses an ambiguous slot key
 * there, BEFORE resolution, so a document that is both ambiguous and carries
 * an unresolvable alias is refused for the ambiguity, exactly as it was when
 * each entry point spelled the sequence out.
 */
export function readTree(text: string, fail: (detail: string) => Error, check?: (doc: Document) => void): ContractTree {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw fail(doc.errors[0]!.message);
  check?.(doc);
  return { doc, plain: resolveTree(doc, fail) };
}

/**
 * Resolve aliases once with the document's own anchor context. Calling an
 * individual AST node's toJSON() loses that context and can silently turn an
 * aliased operation, slot or component into the wrong value. An alias that
 * cannot be resolved at all is a document loam cannot read, and says so.
 */
export function resolveTree(doc: Document, fail: (detail: string) => Error): unknown {
  try {
    return doc.toJS() ?? {};
  } catch (error) {
    throw fail(errorMessage(error));
  }
}

/** One spelling of "hand the document back", so every writer fails the same way. */
export function writeTree(doc: Document, fail: (detail: string) => Error): string {
  try {
    return doc.toString();
  } catch (error) {
    throw fail(errorMessage(error));
  }
}
