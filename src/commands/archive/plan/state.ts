/**
 * What one phase of an archive hands the next.
 *
 * `Gated` is everything the refusals resolved on the way through — the
 * canonical id, the delta document parsed once, the issue lists. `Plan` is what
 * the merges accumulate. Neither is a bag of conveniences: a value is in here
 * exactly when two phases have to agree about it, and the alternative was
 * fifteen parameters threaded through three functions in the same order.
 */
import { type Issue } from "../../../core/vocabulary/issue.js";
import { type PlannedWrite } from "../../../core/staging/writes.js";
import { type FeatureDir } from "../../../core/kernel/ids/dirs.js";
import { type PathableService } from "../../../core/kernel/ids/service.js";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { type CommitRecovery } from "../../../core/staging/interrupted.js";

export interface Gated {
  /** The canonical feature id. The raw argument does not survive the gate. */
  id: string;
  dirName: string;
  featureDir: FeatureDir;
  /** Parsed ONCE for the whole run — loading it spins up a fresh Langium workspace. */
  deltaDoc: LoadedDoc | undefined;
  deltaServices: PathableService[];
  gating: Issue[];
  advisory: Issue[];
  archiveDir: string;
  archiveDest: string;
  /** The interrupted commit this run repaired, if any — `--json` reports it. */
  recovered: CommitRecovery | null;
  /** Every coherence issue the gate read, gating and advisory together. */
  issues: Issue[];
}

export interface Plan {
  writes: PlannedWrite[];
  /**
   * Warnings born in the plan itself (openapi.op-modified,
   * openapi.component-modified, the asyncapi.*-modified trio) — printed with
   * the plan and carried into the `--json` envelope beside the coherence
   * warnings.
   */
  planWarns: Issue[];
  /** Gating issues born in the plan itself (openapi.ref-unresolved, asyncapi.ref-unresolved). */
  planGates: Issue[];
  openapiRemovals: Array<{ service: string; operations: string[] }>;
  /** Living asyncapi slots the plan deletes on removal markers, by their labels. */
  asyncapiRemovals: Array<{ service: string; slots: string[] }>;
  /** Services this feature introduces on the architecture axis alone. */
  architectureServices: Set<PathableService>;
  /**
   * The dynamic views this merge lands, with the docs-relative document each
   * one lands in. `writes` already names those documents, but not which
   * journey put them there — and "which file holds view X" is the question the
   * one-journey-per-file layout exists to make answerable.
   */
  flowViews: Array<{ id: string; path: string; action: "replaced" | "added" }>;
}

export function emptyPlan(): Plan {
  return {
    writes: [],
    planWarns: [],
    planGates: [],
    openapiRemovals: [],
    asyncapiRemovals: [],
    architectureServices: new Set<PathableService>(),
    flowViews: [],
  };
}
