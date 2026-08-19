/**
 * The one refusal every stage of the event-contract delta path raises: a
 * document the planner cannot read, named by which side it came from.
 *
 * The mirror of ../../openapi/merge/error.ts, and the package's leaf for the
 * same reason: whichever sibling fails — the pin today, the markers and the
 * merge when they land — the command above has to map one domain error onto
 * its own envelope, and a module that owned the error would be imported by
 * its siblings for that reason alone.
 */

export type AsyncapiMergeSource = "feature" | "living";

/** A document the merge planner cannot read. Commands map this domain error to their own envelope. */
export class AsyncapiMergeError extends Error {
  override readonly name = "AsyncapiMergeError";

  constructor(
    readonly source: AsyncapiMergeSource,
    readonly service: string,
    detail: string,
  ) {
    super(`${source} asyncapi for ${service} is not valid YAML: ${detail}`);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
