/**
 * The `--subsystem` slice behind `loam list`: what the flag's name denotes,
 * and which services the filter keeps. A sub-package of list/ because the
 * list package proper stands at its five-file limit (review.ts records
 * that), and the adoption-campaign flag surface is its own subject beside
 * the section renderers. The dependency direction is list → list/campaign,
 * never back — this package imports core only, the same rule repo → repo/tree
 * already keeps.
 *
 * Resolution reuses the tree machinery verbatim (`findInTree`,
 * `servicesUnder`, `nearestTreeNames`), so `list --subsystem` and every
 * `loam subsystem` verb read the flat namespace the same way — two spellings
 * of "what does this name mean" would drift.
 */
import { fail } from "../../../core/envelope/json.js";
import { findInTree, nearestTreeNames, servicesUnder, subsystemsUnder } from "../../../core/repo/tree/find.js";
import type { FleetTree, SubsystemEntry } from "../../../core/repo/tree/walk.js";

export interface SubsystemSlice {
  /**
   * DIRECTORIES of the member services, at any depth beneath the filter
   * target — the directory, not the id, because the id is a leaf name the
   * fleet does not guarantee unique: a `subsystem.name-collision` tree still
   * enumerates both claimants on purpose, and an id-keyed slice would let
   * each of two disjoint slices claim the other's service.
   */
  readonly members: ReadonlySet<string>;
  /**
   * The subsystem rows the filtered payload shows — the named subsystem and
   * its descendants; `[]` for the unfiled slice, which sits under no group.
   */
  readonly subsystems: SubsystemEntry[];
  /** The human filter line's description of what the slice is. */
  readonly label: string;
}

/**
 * Resolve `--subsystem <name>` against the flat namespace, or report the
 * refusal and return null. The reserved name `unfiled` selects the services
 * filed under no subsystem — the tree's own concept, otherwise unreachable —
 * but only while nothing in the tree claims that name: a REAL subsystem or
 * service spelled `unfiled` wins, the same concrete-name-wins precedence
 * `findInTree` already applies to service/subsystem ties. An unknown name
 * refuses `unknown-target` with close-name hints rather than succeeding
 * emptily — an empty table over a typo would read as a finished campaign —
 * and a service name refuses `invalid-option` exactly as `loam adopt
 * --subsystem` does: a service never contains other services.
 */
export function resolveSubsystemSlice(tree: FleetTree, name: string, json: boolean): SubsystemSlice | null {
  const hit = findInTree(tree, name);
  if (hit === null && name === "unfiled") {
    return {
      members: new Set<string>(tree.services.filter((s) => s.subsystem.length === 0).map((s) => s.dir)),
      subsystems: [],
      label: "unfiled services (directly under services/)",
    };
  }
  if (hit === null) {
    // The Set: a real subsystem named 'unfiled' would otherwise sit in the
    // hint pool twice and could be offered twice in one hint.
    const close = nearestTreeNames(name, [...new Set([...tree.subsystems.map((s) => s.name), "unfiled"])]);
    fail(
      json,
      "unknown-target",
      `No subsystem '${name}' in the tree.` +
        (close.length > 0
          ? ` Close names: ${close.join(", ")}.`
          : " `loam subsystem list` shows what exists; `unfiled` selects the services filed under none."),
    );
    return null;
  }
  if (hit.kind === "service") {
    // With a SERVICE claiming the name 'unfiled' the reserved reading has no
    // spelling at all, so the refusal must say what is shadowed — otherwise
    // the message reads as loam misunderstanding the request.
    const shadowed =
      name === "unfiled"
        ? " While a service claims this name, the reserved unfiled-services reading is shadowed; rename the service to reach it."
        : "";
    fail(
      json,
      "invalid-option",
      `--subsystem names the service '${name}' — a service never contains other services.${shadowed}`,
    );
    return null;
  }
  const sub = hit.subsystem;
  return {
    members: new Set<string>(servicesUnder(tree, sub).map((s) => s.dir)),
    subsystems: [sub, ...subsystemsUnder(tree, sub)],
    label: `subsystem '${sub.name}' (services/${sub.path.join("/")}/)`,
  };
}
