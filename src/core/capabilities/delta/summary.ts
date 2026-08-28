/**
 * What one feature's capability deltas CHANGE, summarized once for the two
 * commands a person reads before an archive.
 *
 * `loam show <FEAT>` and `loam delta <FEAT>` mentioned the business corpus
 * nowhere, and the consequence was the worst shape an informational surface can
 * have: a feature carrying ONLY a capability delta — which is the first thing an
 * analyst writes, and exactly what `loam new --capability` now scaffolds —
 * displayed as a feature that carries nothing. The two surfaces a reader
 * consults before running `loam archive` therefore disagreed with the archive
 * that would refuse it.
 *
 * ONE SHAPE FOR BOTH, and that is the reason this lives in core rather than in
 * either command. `show` needs the counts (its service rows are `+N ~N -N`) and
 * `delta` needs the promises themselves (it is a task brief, and the id in
 * `Realizes: <capability>#<id>` is the one thing the implementer has to copy
 * exactly). Two derivations would be two answers to "what does this feature
 * change here", from the two commands most likely to be read side by side.
 *
 * THE READER IS INJECTED, exactly as `../rollup.ts`'s is and for the same
 * package-graph reason: `core/fleet-context.ts` imports this package for its
 * memo, so nothing under `src/core/capabilities/` may import it back.
 *
 * BASE requirements are counted by neither. A delta's `## Requirements` section
 * QUOTES living context for a reader and the merge never writes it, so counting
 * one as a change would report a feature as touching a promise it only cites.
 * `delta.requirement-not-merged` is the grade for BASE requirements the author
 * did NOT mean to quote — it exempts `## Requirements` precisely because that
 * heading is the deliberate quotation — and this module owes the same reading:
 * quoted or stranded, a BASE requirement merges nothing, so it is no part of
 * what this feature changes.
 */
import { compareIds } from "../../repo/entries.js";
import type { Requirement } from "../../document/spec.js";
import type { CapabilityDoc } from "../tree.js";

/** One promise a delta adds, restates or retires — the `Realizes:` target it creates or removes. */
export interface CapabilityDeltaPromise {
  kind: "ADDED" | "MODIFIED" | "REMOVED";
  /**
   * Its `Requirement-ID:`, or null when the delta wrote none. Null rather than
   * absent because it is a real and reportable state, not a missing field: an
   * unidentified capability requirement is an ERROR
   * (`capability.requirement-unidentified`) that gates the archive, and a brief
   * that silently dropped the row would hide the requirement the author has to
   * fix.
   */
  id: string | null;
  /** Its `### Requirement:` heading. */
  name: string;
}

/** One capability document a feature's delta carries, and what it would merge. */
export interface CapabilityDeltaSummary {
  id: string;
  /** The delta document, absolute. Callers make it repo-relative for their own payload. */
  spec: string;
  added: number;
  modified: number;
  removed: number;
  /** Every non-BASE requirement, in document order — the promises this delta moves. */
  promises: CapabilityDeltaPromise[];
}

/**
 * Summarize each capability delta, ordered by capability id.
 *
 * `docs` comes from `featureCapabilityDeltas` (or a `FleetContext`'s memo of
 * it), so it is already `compareIds`-ordered by the walk; the sort here is the
 * statement that the order is part of the answer rather than a property of
 * whoever happened to call.
 */
export async function capabilityDeltaSummaries(
  docs: readonly CapabilityDoc[],
  read: (path: string) => Promise<Requirement[]>,
): Promise<CapabilityDeltaSummary[]> {
  const out: CapabilityDeltaSummary[] = [];
  for (const doc of docs) {
    const reqs = await read(doc.spec);
    out.push({
      id: doc.id,
      spec: doc.spec,
      added: reqs.filter((r) => r.kind === "ADDED").length,
      modified: reqs.filter((r) => r.kind === "MODIFIED").length,
      removed: reqs.filter((r) => r.kind === "REMOVED").length,
      promises: reqs.flatMap((r) =>
        r.kind === "BASE" ? [] : [{ kind: r.kind, id: r.id ?? null, name: r.name }],
      ),
    });
  }
  return out.sort((a, b) => compareIds(a.id, b.id));
}
