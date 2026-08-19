/**
 * The one refusal every stage of the event-contract delta path raises: a
 * document the planner cannot read, named by which side it came from.
 *
 * The mirror of ../../openapi/merge/error.ts, and the package's leaf for the
 * same reason: whichever sibling fails — the pin, the markers or the merge —
 * the command above has to map one domain error onto its own envelope, and a
 * module that owned the error would be imported by its siblings for that
 * reason alone.
 */

export type AsyncapiMergeSource = "feature" | "living";

/**
 * A document the merge machinery cannot use. Commands map this domain error
 * to their own envelope. `problem` is the verb phrase between the document's
 * name and the detail — "is not valid YAML" for the parse failures that are
 * the common case, overridden where the document parses fine and the refusal
 * is about what it says (a section spelling one slot key twice is legal YAML,
 * and calling it invalid would send the author to a linter that agrees with
 * the file).
 */
export class AsyncapiMergeError extends Error {
  override readonly name = "AsyncapiMergeError";

  constructor(
    readonly source: AsyncapiMergeSource,
    readonly service: string,
    detail: string,
    problem: string = "is not valid YAML",
  ) {
    super(`${source} asyncapi for ${service} ${problem}: ${detail}`);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
