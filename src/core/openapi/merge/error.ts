/**
 * The one refusal every stage of the contract delta path raises: a document the
 * planner cannot read, named by which side it came from.
 *
 * It is the package's leaf for the same reason the pin, the markers and the
 * merge each throw it: whichever of them fails, the command above has to map
 * one domain error onto its own envelope. A module that owned the error would
 * be imported by its two siblings for that reason alone.
 */
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
