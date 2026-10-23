/**
 * Which `Requirement-ID`s a `#req-` tag resolves against TODAY and AFTER this
 * feature's merge — per capability document, or per service with its two
 * documents read as one set.
 *
 * It was the private table of `../modified.ts`, the walk that names a living
 * flow whose promise this feature rewrites or retires. A feature's own
 * service-local flows need the same two answers — the gate on replacing a
 * living flow asks what the feature MODIFIES or REMOVES, and the grade of the
 * replacement asks which ids the merge leaves (`overwrites` and `scopeOf` in `./grade.ts`) — and a
 * second reading of "what the merge leaves" is the copy that would drift first
 * from the merge itself. So it moved down here, beside its second reader, and
 * both read the archive's own fold.
 */
import { existsSync } from "node:fs";
import { applyRequirementDelta, replacementsOf, type Replacement } from "../../../document/apply.js";
import type { Requirement } from "../../../document/spec.js";
import { SPEC_AXES, type ServicePaths, type SpecAxis } from "../../../repo/paths.js";

/** One delta document beside the living one it merges into — a capability's, or one spec axis of a service. */
export interface DeltaPair {
  /** The capability id, or the service id. */
  id: string;
  reqs: readonly Requirement[];
  living: readonly Requirement[];
}

/** One spec axis of a service the feature touches, and where that service lives — asked only for one whose delta changes something. */
export interface ServiceDeltaPair extends DeltaPair {
  /** Which of the service's two documents this is: the other is read as it stands when the feature carries no delta for it. */
  axis: SpecAxis["key"];
  paths: () => Promise<ServicePaths>;
}

/**
 * Per document id — a capability, or a service's two axes together, the one
 * set its directory-scoped tag is read against — the ids a tag resolves
 * against today and after the merge, and which living ids this feature
 * rewrites or retires.
 */
export interface Table {
  living: Map<string, Set<string>>;
  merged: Map<string, Set<string>>;
  modified: Map<string, Set<string>>;
  removed: Map<string, Set<string>>;
}

/**
 * Each document's table rows. The modified and removed ids are named by the id
 * the LIVING document gives them — selected by `replacementsOf`, the merge's own
 * walk, so a MODIFIED or REMOVED written by heading alone still names the id a
 * tag carries — and the after-side is that same merge's result. A document the
 * merge would refuse keeps its living ids on both sides and changes nothing:
 * the delta gate reports it, and nothing here has a true thing to say about a
 * merge that cannot happen.
 *
 * TODAY'S side leaves out a living requirement sitting under a REMOVED heading,
 * as both fleet indexes do (`capabilityRequirementIndex`, `requirementIdsOf`):
 * a tag resolving only through one is already the fleet's error. The fold
 * still runs on the whole living list, because that is the archive's input.
 */
export function tableOf(docs: readonly DeltaPair[]): Table {
  const table: Table = { living: new Map(), merged: new Map(), modified: new Map(), removed: new Map() };
  for (const doc of docs) {
    const living = doc.living.filter((r) => r.kind !== "REMOVED");
    let fold: { replaced: Replacement[]; merged: readonly Requirement[] };
    try {
      fold = { replaced: replacementsOf([...doc.living], [...doc.reqs]), merged: applyRequirementDelta([...doc.living], [...doc.reqs]) };
    } catch {
      fold = { replaced: [], merged: living };
    }
    idsInto(table.living, doc.id, living);
    idsInto(table.merged, doc.id, fold.merged);
    for (const r of fold.replaced) {
      if (r.living.id === undefined || (r.kind !== "MODIFIED" && r.kind !== "REMOVED")) continue;
      const into = r.kind === "MODIFIED" ? table.modified : table.removed;
      into.set(doc.id, (into.get(doc.id) ?? new Set()).add(r.living.id));
    }
  }
  return table;
}

/** A document's ids, unioned into its row — created even when empty, which is the `empty` arm's answer rather than `undocumented`'s. */
function idsInto(rows: Map<string, Set<string>>, id: string, reqs: readonly Requirement[]): void {
  const ids = rows.get(id) ?? new Set<string>();
  for (const r of reqs) if (r.id !== undefined) ids.add(r.id);
  rows.set(id, ids);
}

/** The ids each document's delta modifies or removes — what a flow has to mention to be asked about at all. */
export function changedIds(table: Table): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const rows of [table.modified, table.removed]) {
    for (const [id, ids] of rows) out.set(id, new Set([...(out.get(id) ?? []), ...ids]));
  }
  return out;
}

/**
 * The service pairs, plus — for each service whose delta modifies or removes
 * something — every document of it the feature carries no delta for, as it
 * stands (`untouched`). `requirementIdsOf` (`../../service/grade.ts`) reads both
 * documents for a service-local tag, skipping a requirement under a REMOVED
 * heading; so must this, or a tag the untouched document keeps resolving reads
 * as broken — and one only a REMOVED entry there answers reads as kept, though
 * the archive leaves that document as it is.
 */
export async function withUntouchedAxes(
  services: readonly ServiceDeltaPair[],
  readRequirements: (path: string) => Promise<Requirement[]>,
): Promise<DeltaPair[]> {
  const out: DeltaPair[] = [...services];
  const asked = new Set<string>();
  // Sequential, and it costs nothing worth racing: a feature names a handful of
  // services, each read is one memoised document, and most services here
  // already have both axes in the feature or no second document at all.
  for (const pair of services) {
    const own = services.filter((p) => p.id === pair.id);
    if (asked.has(pair.id) || !own.some((p) => p.reqs.some((r) => r.kind === "MODIFIED" || r.kind === "REMOVED"))) continue;
    asked.add(pair.id);
    out.push(...(await untouched(pair.id, await pair.paths(), own, readRequirements)));
  }
  return out;
}

/**
 * The documents of one service the feature carries no delta for, each as a
 * pair that changes nothing (`reqs: []`) — the living text as it stands, a
 * requirement under a REMOVED heading left out for `tableOf`'s reason.
 */
export async function untouched(
  service: string,
  paths: ServicePaths,
  own: readonly ServiceDeltaPair[],
  readRequirements: (path: string) => Promise<Requirement[]>,
): Promise<DeltaPair[]> {
  const out: DeltaPair[] = [];
  for (const axis of SPEC_AXES) {
    if (own.some((p) => p.axis === axis.key) || !existsSync(paths[axis.key])) continue;
    const living = (await readRequirements(paths[axis.key])).filter((r) => r.kind !== "REMOVED");
    out.push({ id: service, reqs: [], living });
  }
  return out;
}
