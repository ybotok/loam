/**
 * The one way both contract axes read and write a contract document: parse it,
 * refuse its first parse error, resolve it, and hand it back as text.
 *
 * The helpers are axis-neutral and take the refusal to raise as a `fail`
 * callback, because the event axis's six entry points spelled the same parse,
 * first-error, resolve and serialize sequence the OpenAPI axis's did, against
 * its own error class (../asyncapi/merge/error.ts, beside ./merge/error.ts). A
 * leaf of its own, named for what it holds, at the lowest package both merge
 * packages already import — not inside either axis's refusal module, where the
 * event axis would read its contracts through a file named for an error.
 * Import direction is asyncapi → openapi, as everywhere else on the contract
 * axes.
 */
import { parseDocument, type Document } from "yaml";

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
