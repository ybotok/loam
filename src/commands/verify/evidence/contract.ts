/**
 * `--contract-results` consumed: the file read and pinned through the shared
 * plumbing in `./read.ts`, then graded by the format reader in
 * `core/verify/evidence/contract.ts`. Mirrors what `../results.ts` is for the
 * cucumber report — the command-side half that touches the filesystem, kept
 * apart from the core half that only ever judges a parsed document.
 */
import { readContractReport, type ContractRun } from "../../../core/verify/evidence/contract.js";
import { type ConsumedContractReport } from "../../../core/verify/record.js";
import { readReportArtifact } from "./read.js";

export type ContractResultsRead =
  | { ok: true; report: ConsumedContractReport; runs: ContractRun[] }
  | { ok: false; code: "answers-unreadable"; message: string };

export async function readContractResults(
  spelled: string,
  repoDir: string | undefined,
): Promise<ContractResultsRead> {
  const artifact = await readReportArtifact(spelled, repoDir, "contract-test report");
  if (!artifact.ok) return artifact;
  const parsed = readContractReport(artifact.doc, spelled);
  if (!parsed.ok) return { ok: false, code: "answers-unreadable", message: parsed.message };
  return {
    ok: true,
    runs: parsed.runs,
    report: {
      path: artifact.spelled,
      digest: artifact.digest,
      mtime: artifact.mtime,
      // Distinct operationIds, not entries: the pin says how much of an API
      // the file speaks about, and a re-run is not a second operation.
      operations: new Set(parsed.runs.map((r) => r.operationId)).size,
      format: "generic",
    },
  };
}
