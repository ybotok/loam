/**
 * The capability document's own three grades, applied to a FEATURE'S DELTA.
 *
 * `../findings.ts` grades the living `capabilities/<id>/spec.md` and files
 * Findings for `loam validate`. This is the same three rules shaped as archive
 * Issues — the twin `capabilityUnknownFindings`/`capabilityUnknownIssues`
 * already are one directory over, and for the identical reason: severity says
 * whether the DOCUMENT is valid, gating says whether the MERGE is safe, and the
 * two questions are asked by two different commands about the same text.
 *
 * WITHOUT THIS THE DELTA PATH IS A HOLE THROUGH THE RULE. A capability
 * requirement carrying `Operations:` is a service requirement filed at the
 * business altitude — the one thing that makes a second requirements corpus
 * worth having is that it does not become a second place to write the first
 * one. Graded only on the living document, that requirement merges cleanly and
 * earns its error afterwards, against a file whoever reads the finding did not
 * write and cannot un-merge. So the delta is graded BEFORE the merge, where the
 * author is still holding the document.
 *
 * ADDED AND MODIFIED ONLY. A REMOVED requirement is being retired: demanding a
 * `Requirement-ID:` on it, or refusing the `Operations:` line it is deleting,
 * would ask for an edit to text that is about to stop existing. A BASE
 * requirement is a delta quoting living context, already named by
 * `delta.requirement-not-merged`, and it merges nothing — two findings for one
 * mistake is the failure to avoid.
 *
 * NO CODES OF ITS OWN, and no message of its own. Every sentence comes from
 * `capabilityDocFindings`, whose `where` parameter is what points them at the
 * feature's copy of the document.
 */
import { capabilityDocFindings, type CapabilityTarget } from "../findings.js";
import type { Requirement } from "../../document/spec.js";
import type { Issue } from "../../vocabulary/issue.js";

/**
 * The three grades, as archive-gating Issues, over the requirements a
 * capability delta would actually merge.
 *
 * `target.where` is the delta's repo-relative path so a reader is sent to the
 * file they wrote, and `target.subject` is the capability id so a `--json`
 * consumer groups by promise rather than by path — the same split every other
 * capability grade uses.
 */
export function capabilityDocIssues(reqs: Requirement[], target: CapabilityTarget): Issue[] {
  const merging = reqs.filter((r) => r.kind === "ADDED" || r.kind === "MODIFIED");
  return capabilityDocFindings(merging, target.subject, target.where).map((f) => ({
    severity: f.severity,
    code: f.code,
    subject: f.subject,
    message: f.message,
  }));
}
