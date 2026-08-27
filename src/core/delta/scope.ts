/**
 * The one (subject, axis) pass every delta check runs inside, and the living
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
import { type Requirement } from "../document/spec.js";

/**
 * Which file an axis is, at the grain the delta checks need — the filename and
 * nothing else, because that is all any of them read (`key` below is the only
 * consumer). Structurally a `SPEC_AXES` entry with its other fields dropped, so
 * the two service axes keep travelling exactly as before while the CAPABILITY
 * axis — which indexes no `ServicePaths` and therefore has no `key` — travels
 * too. `label` is deliberately NOT carried: nothing here reads it, and a field
 * that exists only to look like the record it came from is a field the next
 * reader tries to use in a message.
 */
export interface DeltaAxis {
  file: string;
}

/**
 * WHAT a delta claims, at the grain the claim registry is keyed by: the kind of
 * document, its identity, and which of its axes.
 *
 * `kind` is not decoration. A fleet may hold a service called `billing` and a
 * capability called `billing`, and both write requirements into a `spec.md`; a
 * key built from the name and the filename alone would let one feature's
 * service claim answer another feature's capability question — reporting
 * `delta.added-conflict` against a document it has nothing to do with.
 */
export interface ClaimSubject {
  kind: "service" | "capability";
  /** The service id, or the capability id — whichever `kind` says. */
  subject: string;
  axis: DeltaAxis;
}

export interface DeltaScope extends ClaimSubject {
  /** The feature being graded — named in the `loam rebase <FEAT>` advice. */
  featureId: string;
  docsDir: string;
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

/** Key for the (kind, subject, axis, requirement) tuple a feature claims. The
 * axes are separate namespaces on purpose — an arch requirement cannot conflict
 * with a business requirement of the same name, they merge into different files
 * — and so are the kinds, for the reason `ClaimSubject` states above. */
export function key(claim: ClaimSubject, identity: string): string {
  return `${claim.kind}\0${claim.subject}\0${claim.axis.file}\0${identity}`;
}

/** Stable ID when present; exact heading for a legacy requirement. */
export function requirementKey(requirement: Pick<Requirement, "id" | "name">): string {
  return requirement.id === undefined ? `name:${requirement.name}` : `id:${requirement.id}`;
}
