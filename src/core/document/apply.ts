/**
 * A feature's ADDED/MODIFIED/REMOVED requirements folded onto a living set.
 *
 * The one thing `loam archive` does to a spec, and a module of its own because
 * it is where a requirement stops being a delta: `asLiving` drops the
 * `Based-On:` pin, which is a claim about which living version this was written
 * against — meaningless once it IS the living version, and poison for the next
 * feature's baseline, which would otherwise hash the previous feature's pin.
 */
import { requirementIdProblems, withoutBaseline, type DeltaKind, type Requirement } from "./spec.js";

/**
 * A delta requirement as it lands in the living document, with the bookkeeping
 * that belongs to the DELTA left behind: the `Based-On:` pin (a claim about
 * which living version this was written against — meaningless once it IS the
 * living version, and poison for the next feature's baseline, which would then
 * hash the previous feature's pin) and the line it was parsed from.
 */
function asLiving(d: Requirement): Requirement {
  const { line: _dropped, ...rest } = withoutBaseline(d);
  return { ...rest, kind: "BASE" };
}

/** Apply a feature's ADDED/MODIFIED/REMOVED requirements onto a living requirement set. */
export function applyRequirementDelta(living: Requirement[], delta: Requirement[]): Requirement[] {
  const malformed = [...requirementIdProblems(living), ...requirementIdProblems(delta)];
  if (malformed.length > 0) {
    throw new Error("cannot merge requirements with invalid, repeated, or duplicate Requirement-ID declarations");
  }
  let result: Requirement[] = living.map((r) => ({ ...r, kind: "BASE" as DeltaKind }));
  for (const d of delta) {
    // BASE is not a delta kind — a requirement outside an ADDED/MODIFIED/REMOVED
    // section (e.g. quoted under ## Notes) is documentation, not a change.
    if (d.kind === "BASE") continue;
    if (d.id !== undefined) {
      const idMatches = result
        .map((r, i) => (r.id === d.id ? i : -1))
        .filter((i) => i >= 0);
      const nameMatches = result
        .map((r, i) => (r.name === d.name ? i : -1))
        .filter((i) => i >= 0);
      const otherNameMatches = nameMatches.filter((i) => !idMatches.includes(i));
      if (idMatches.length > 1 || otherNameMatches.length > 0) {
        throw new Error(
          `ambiguous requirement identity for '${d.name}' (${d.id}): Requirement-ID and heading select different living requirements`,
        );
      }
      if (d.kind === "REMOVED") {
        const selected = new Set(idMatches);
        result = result.filter((_, i) => !selected.has(i));
      } else {
        const merged: Requirement = asLiving(d);
        if (idMatches.length === 1) result[idMatches[0]!] = merged;
        else result.push(merged);
      }
    } else if (d.kind === "REMOVED") {
      result = result.filter((r) => r.name !== d.name);
    } else {
      const i = result.findIndex((r) => r.name === d.name);
      // A legacy delta may still modify an ID-bearing living requirement by
      // its exact heading. Keep the identity while the repository migrates.
      const inheritedId = i >= 0 ? result[i]!.id : undefined;
      const merged: Requirement = {
        ...asLiving(d),
        ...(inheritedId === undefined ? {} : { id: inheritedId }),
      };
      if (i >= 0) result[i] = merged;
      else result.push(merged);
    }
  }
  return result;
}
