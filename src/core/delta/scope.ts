/**
 * The one (service, axis) pass every delta check runs inside, and the living
 * document indexed the way those checks ask about it.
 *
 * The scope exists because the checks that used to be one 400-line function all
 * need the same five facts and none of them may take five parameters. It is a
 * record of what is being graded, never of what was found — `Issue[]` stays a
 * return value, so no check can quietly append to another's output.
 *
 * `indexLiving` builds all four lookups in one walk. Two of them answer the same
 * question by different keys (heading, Requirement-ID) and the delta algebra
 * requires them to agree; building one lazily beside the other is how they would
 * eventually be built from different arrays.
 */
import { type SpecAxis } from "../repo/paths.js";
import { type Requirement } from "../document/spec.js";

export interface DeltaScope {
  /** The feature being graded — named in the `loam rebase <FEAT>` advice. */
  featureId: string;
  docsDir: string;
  service: string;
  axis: SpecAxis;
  /** The delta document this pass reads, for the one message that names a path. */
  specPath: string;
  /**
   * How this axis's file is named in messages. The arch file says which document
   * it means so a finding cannot be chased into the wrong one; spec.md keeps its
   * historical spelling.
   */
  where: string;
  /** How the axis's LIVING document is named in messages, same reasoning. */
  livingDoc: string;
}

/** The living requirements, keyed every way a delta may select one. */
export interface LivingIndex {
  names: Set<string>;
  byName: Map<string, Requirement[]>;
  byId: Map<string, Requirement[]>;
  /** Lowercased living name -> its exact spelling, for the near-duplicate warning. */
  folded: Map<string, string>;
  all: Requirement[];
}

export function indexLiving(living: Requirement[]): LivingIndex {
  const byName = new Map<string, Requirement[]>();
  const byId = new Map<string, Requirement[]>();
  for (const requirement of living) {
    const named = byName.get(requirement.name) ?? [];
    named.push(requirement);
    byName.set(requirement.name, named);
    if (requirement.id !== undefined) {
      const identified = byId.get(requirement.id) ?? [];
      identified.push(requirement);
      byId.set(requirement.id, identified);
    }
  }
  return {
    names: new Set(living.map((r) => r.name)),
    byName,
    byId,
    folded: new Map(living.map((r) => [r.name.toLowerCase(), r.name] as const)),
    all: living,
  };
}

/** Key for the (service, axis, requirement) triple a feature claims. The two
 * axes are separate namespaces on purpose — an arch requirement cannot conflict
 * with a business requirement of the same name, they merge into different files. */
export function key(service: string, axis: SpecAxis, identity: string): string {
  return `${service}\0${axis.file}\0${identity}`;
}

/** Stable ID when present; exact heading for a legacy requirement. */
export function requirementKey(requirement: Pick<Requirement, "id" | "name">): string {
  return requirement.id === undefined ? `name:${requirement.name}` : `id:${requirement.id}`;
}
