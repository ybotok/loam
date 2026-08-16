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
import { type PathableService } from "../../../core/kernel/ids.js";
import { type LoadedDoc } from "../../../core/c4/likec4.js";
import { type CommitRecovery } from "../../../core/staging/recovery/intent.js";

export interface Gated {
  /** The canonical feature id. The raw argument does not survive the gate. */
  id: string;
  dirName: string;
  featureDir: string;
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
   * openapi.component-modified) — printed with the plan and carried into the
   * `--json` envelope beside the coherence warnings.
   */
  planWarns: Issue[];
  /** Gating issues born in the plan itself (openapi.ref-unresolved). */
  planGates: Issue[];
  openapiRemovals: Array<{ service: string; operations: string[] }>;
  /** Services this feature introduces on the architecture axis alone. */
  architectureServices: Set<PathableService>;
}

export function emptyPlan(): Plan {
  return {
    writes: [],
    planWarns: [],
    planGates: [],
    openapiRemovals: [],
    architectureServices: new Set<PathableService>(),
  };
}
