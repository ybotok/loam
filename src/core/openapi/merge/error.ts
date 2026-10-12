/**
 * The one refusal every stage of the contract delta path raises: a document the
 * planner cannot read, named by which side it came from.
 *
 * It is the package's leaf for the same reason the pin, the markers and the
 * merge each throw it: whichever of them fails, the command above has to map
 * one domain error onto its own envelope. A module that owned the error would
 * be imported by its two siblings for that reason alone.
 *
 * Every stage reads and writes its contract through ../contract-tree.ts, and
 * hands those helpers `openapiRefusal` as the error to raise — which is what
 * makes each of them fail with this one identically.
 */
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
