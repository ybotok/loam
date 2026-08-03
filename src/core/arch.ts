/**
 * The architecture spec axis — the grammar and resolution of `Covers:`.
 *
 * A business spec will never mention the transactional outbox; that is
 * architecture, and it lives in `arch.spec.md` — same requirement/scenario
 * grammar as spec.md, same delta algebra, same merge. What is new is the
 * `Covers:` line: where a business requirement declares the OPERATIONS it
 * governs, an architecture requirement declares the MODEL OBJECTS its
 * scenarios exercise, so coverage can be derived mechanically instead of
 * trusted to an author who was never going to write the outbox down.
 *
 * Three entry forms, resolved against the documents loam already reads:
 *
 *   paymentService.db               a C4 element id — resolved against the
 *                                   in-scope elements the way every check joins
 *                                   them: the id itself, or the service the
 *                                   element stands for (binding, then title);
 *   paymentService -> kafka         an edge — each side resolved the same way,
 *                                   against the declared relationships;
 *   alert:<id> / sli:<id>           a health signal — ids `health.yaml`
 *                                   declares (core/health.ts).
 *
 * Resolution never reads code. An entry that resolves to nothing is the typo
 * guard (`covers.unknown`, warn); the emitters live with the other validate
 * checks, this module owns only the grammar and the matching.
 */
import { elementService, serviceOf, type Elem, type Rel } from "./likec4.js";
import type { HealthIds } from "./health.js";

export type CoversEntry =
  | { form: "element"; id: string; raw: string }
  | { form: "edge"; source: string; target: string; raw: string }
  | { form: "alert" | "sli"; id: string; raw: string };

/** Parse one comma-separated `Covers:` entry into its form. Never fails: an
 * unclassifiable string is an element entry that will not resolve, and the
 * covers.unknown message is a better diagnosis than a parse refusal. */
export function parseCoversEntry(raw: string): CoversEntry {
  const alert = /^alert:\s*(.+)$/.exec(raw);
  if (alert) return { form: "alert", id: alert[1]!.trim(), raw };
  const sli = /^sli:\s*(.+)$/.exec(raw);
  if (sli) return { form: "sli", id: sli[1]!.trim(), raw };
  const edge = /^(.+?)\s*->\s*(.+)$/.exec(raw);
  if (edge) return { form: "edge", source: edge[1]!.trim(), target: edge[2]!.trim(), raw };
  return { form: "element", id: raw, raw };
}

/**
 * What `Covers:` entries resolve against: every element and relationship in
 * view (a service's own model plus the landscape; for a feature, the delta
 * plus both), and the health ids of the service whose spec is being read.
 */
export interface CoverageScope {
  elements: Elem[];
  relationships: Rel[];
  health: HealthIds;
}

/** Does an element entry name this element? Its id, or the service it stands for. */
function namesElement(name: string, e: Elem): boolean {
  return e.id === name || elementService(e) === name;
}

/** Does an edge entry's side name this relationship endpoint? */
function namesEndpoint(name: string, endpointId: string, elements: Elem[]): boolean {
  return endpointId === name || serviceOf(elements, endpointId) === name;
}

/** Does a Covers entry match this element? (Only element entries can.) */
export function coversElement(entry: CoversEntry, e: Elem): boolean {
  return entry.form === "element" && namesElement(entry.id, e);
}

/** Does a Covers entry match this relationship? Endpoints resolved within `elements`. */
export function coversEdge(entry: CoversEntry, r: Rel, elements: Elem[]): boolean {
  return (
    entry.form === "edge" &&
    namesEndpoint(entry.source, r.source, elements) &&
    namesEndpoint(entry.target, r.target, elements)
  );
}

/** Does the entry resolve to ANYTHING in scope? False is `covers.unknown`. */
export function entryResolves(entry: CoversEntry, scope: CoverageScope): boolean {
  switch (entry.form) {
    case "alert":
      return scope.health.alerts.includes(entry.id);
    case "sli":
      return scope.health.slis.includes(entry.id);
    case "edge":
      return scope.relationships.some((r) => coversEdge(entry, r, scope.elements));
    case "element":
      return scope.elements.some((e) => coversElement(entry, e));
  }
}

/** Ids a covers.unknown hint may offer for a mistyped entry — always real ones. */
export function coversCandidates(entry: CoversEntry, scope: CoverageScope): string[] {
  switch (entry.form) {
    case "alert":
      return closeIds(entry.id, scope.health.alerts).map((id) => `alert:${id}`);
    case "sli":
      return closeIds(entry.id, scope.health.slis).map((id) => `sli:${id}`);
    case "edge":
      // Cheap on purpose: no pairwise edge fuzzing — the sides are element
      // names, so the element hint is the useful one.
      return [];
    case "element":
      return closeIds(entry.id, [...new Set(scope.elements.map((e) => e.id))]);
  }
}

/**
 * Existing ids near a misspelling — substring containment either way, else a
 * shared 3-character prefix. Deliberately dumb: no fuzzy library for one hint,
 * and every id offered is real, so the hint can never point at the typo itself.
 * (Moved here from validate.ts once `covers.unknown` became its second user.)
 */
export function closeIds(typo: string, ids: string[]): string[] {
  const t = typo.toLowerCase();
  return ids
    .filter((id) => {
      const i = id.toLowerCase();
      return i.includes(t) || t.includes(i) || (t.length >= 3 && i.startsWith(t.slice(0, 3)));
    })
    .slice(0, 5);
}
