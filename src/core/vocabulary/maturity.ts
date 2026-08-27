/**
 * The adoption-maturity ladder: one monotone word for how far a service's
 * documentation has got, and what stands between it and the next rung.
 *
 * This lived inside `commands/list.ts` while `list` was the only caller. It
 * moved here when `explore` needed the same answer, because the alternative is
 * the failure `core/kernel/ids/service.ts` already records for the service-id grammar: a
 * second, subtly different copy, so two commands grade the same directory
 * differently and nobody can tell which one is lying. The rung is a fleet dial
 * — `list` prints it per service and in a rollup, `explore` prints it for a
 * service somebody is about to build against — and a dial with two readings is
 * not a dial.
 */
import type { ServiceEntry } from "../repo/entries.js";

/** The ladder, in order. Each rung stands on every rung below it. */
export const MATURITY_LADDER = ["empty", "partial", "documented", "sourced", "vouched"] as const;
export type Maturity = (typeof MATURITY_LADDER)[number];

/**
 * A service entry plus the two facts the directory enumeration cannot know on
 * its own. Both change what a rung MEANS, and both are fleet-level: they need
 * the landscape, not `services/<id>/`.
 */
export interface MaturityInput {
  entry: ServiceEntry;
  /** `arch.spec.md` — the architecture-obligations axis, absent from ServiceEntry.has. */
  archSpec: boolean;
  /**
   * Does anything in the fleet call an operation on this service? True unless
   * the landscape PROVES otherwise, exactly as `validate`'s no-openapi grace
   * reads it: a missing or unparseable landscape proves nothing.
   */
  apiExpected: boolean;
}

/**
 * How far a service's documentation has got. Derived from artifact PRESENCE and
 * provenance state only — the data an enumeration already holds — never from
 * what the artifacts say. COMPLETENESS of adopted docs is explicitly on the
 * unchecked list (brief/unchecked.ts): a service with one endpoint documented out of
 * thirty climbs this ladder exactly as fast as a thorough one, which is why no
 * rung is called "adopted".
 *
 *   empty       services/<id>/ exists, no artifact is in it
 *   partial     some artifacts, but not the required set
 *   documented  the artifacts the adopt brief marks required are present
 *   sourced     the living spec declares `sources` — something ties it to code
 *   vouched     status: verified with a sources_digest behind it — a person
 *               stamped it. `verified` with no digest is a claim with nothing
 *               behind it and stays below this rung.
 *
 * `openapi.yaml` is required ONLY where an API is expected. The rung used to
 * demand it of everything, which permanently pinned every worker, cron and
 * consumer in the fleet at `partial` — services that are fully documented and
 * vouched for, reported as unfinished forever, leaving the rollup permanently
 * below its true documentation state. The evidence is the same one
 * `validate` uses to keep `service.no-openapi` quiet, so a service cannot be
 * green in one command and unfinished in the other.
 */
export function serviceMaturity(v: MaturityInput): Maturity {
  const s = v.entry;
  if (!Object.values(s.has).some(Boolean) && !v.archSpec && s.adrs === 0) return "empty";
  if (!(s.has.model && s.has.spec && (!v.apiExpected || s.has.openapi))) return "partial";
  if (!s.sources.declared) return "documented";
  if (!(s.status === "verified" && s.sources.stamped)) return "sourced";
  return "vouched";
}

/**
 * What stands between this service and `vouched`, named as the thing to go and
 * do. One rung's worth at a time: telling somebody at `empty` that they also
 * need a vouch is noise, and the vouch is not even possible yet.
 */
export function maturityGaps(v: MaturityInput): string[] {
  const s = v.entry;
  const files = [
    ...(s.has.model ? [] : ["model.likec4"]),
    ...(s.has.spec ? [] : ["spec.md"]),
    ...(v.apiExpected && !s.has.openapi ? ["openapi.yaml"] : []),
  ];
  if (files.length > 0) return files;
  if (!s.sources.declared) return ["sources: in the spec.md frontmatter"];
  if (!(s.status === "verified" && s.sources.stamped)) return [`\`loam vouch --service ${s.id}\``];
  return [];
}

/** Counts per rung, every rung present — a stable shape a fleet dashboard can diff. */
export function maturityRollup(graded: readonly { maturity: Maturity }[]): Record<Maturity, number> {
  const out = Object.fromEntries(MATURITY_LADDER.map((m) => [m, 0])) as Record<Maturity, number>;
  for (const v of graded) out[v.maturity] += 1;
  return out;
}

/* ------------------------------------------------------------------ */
/* What the fleet map proves about one service                         */
/* ------------------------------------------------------------------ */

/**
 * C4 kinds that model people, and the tag marking an element as somebody
 * else's system. A person is never a service directory, and `#external` is
 * undocumented on purpose — every census and exemption over the fleet map
 * asks both questions.
 *
 * Extracted on the third strike: `commands/validate/checks/vocabulary.ts`,
 * `core/gate/partners.ts` and `core/verify/checklist.ts` each carried a copy.
 * Their real home is `core/c4/likec4.ts` beside the model they describe, but
 * that file sits against the 300-line limit and its package holds five files
 * — so the trio lives here, beside `landscapeEvidence`, which reads the same
 * map for the same per-service questions.
 *
 * `PLATFORM_TAG` joined them from `commands/validate/checks/fleet-shape.ts`,
 * where it was declared beside its one reader. It moved for the rule above the
 * others came for: `fleet/kind-tags.ts` needs to know which tag names loam
 * grades on, and reaching into fleet-shape.ts for a five-character constant
 * would import a module that reads permissions, capabilities and every
 * service's requirements to get it. The two tags loam gives meaning to belong
 * in one place anyway — that list IS what the kind-tag check is about.
 */
export const ACTOR_KINDS = new Set(["person", "actor", "user"]);
export const EXTERNAL_TAG = "external";
/** Tag marking ubiquitous infrastructure; the scaffolded fleet view excludes it. */
export const PLATFORM_TAG = "platform";

/**
 * The tags loam GRADES on, as opposed to the ones it merely carries.
 *
 * A tag in this list changes what loam concludes about a fleet: `#external`
 * exempts an element from the landscape↔services reconciliation entirely, and
 * `#platform` silences the hub warning. Every other tag on an element is the
 * author's own vocabulary and loam does not read it.
 *
 * The list exists because since LikeC4 1.59.0 a tag can be declared on a KIND
 * — `specification { element softwareSystem { #external } }` — and LikeC4
 * applies it to every element of that kind. A kind-wide declaration of a tag on
 * this list switches loam's grading off for the whole fleet at once, which is
 * what `kindTagFindings` refuses. A tag NOT on this list is safe to declare
 * kind-wide, so the check must ask exactly this question and no broader one.
 */
export const GRADED_TAGS: readonly string[] = [EXTERNAL_TAG, PLATFORM_TAG];

/** One end of a call the fleet map draws, as every per-service view spells it. */
export interface LandscapeEdge {
  service: string;
  op: string | null;
  title: string | null;
}

/**
 * The slice of a parsed relationship the partition reads. Structural on
 * purpose — the smallest parameter type the derivation needs — so this module
 * stays a leaf: `core/c4/likec4.ts`'s `Rel` satisfies it without an import
 * edge from the vocabulary package into the parser.
 */
export interface EdgeSource {
  source: string;
  target: string;
  op?: string;
  title?: string;
}

export interface LandscapeEvidenceRequest {
  /** The service being asked about. */
  id: string;
  /** Whether the landscape parsed — what makes its silence evidence rather than absence. */
  parses: boolean;
  /** The parsed relationships; empty when the landscape is absent or unparseable. */
  relationships: readonly EdgeSource[];
  /** Every element id in the map, for the `modelled` probe. */
  elementIds: readonly string[];
  /** The shared resolver (`core/c4/resolve/service.ts` `serviceResolver`), widened to plain strings. */
  svcOf: (id: string) => string;
}

export interface LandscapeEvidence {
  inbound: LandscapeEdge[];
  outbound: LandscapeEdge[];
  /** Whether anything in the fleet map resolves to this service. */
  modelled: boolean;
  /** The `apiExpected` input the ladder above consumes. */
  apiExpected: boolean;
}

/**
 * The fleet map's evidence about one service: the edges into and out of it,
 * whether the map draws it at all, and whether an API is expected of it.
 *
 * One spelling, because it had grown three. `explore`'s describe and the
 * context pack's living slice partitioned the same relationships with the
 * same positive-evidence rule line for line — an inbound edge carrying an
 * operation proves somebody calls the service; a landscape that is absent or
 * does not parse proves NOTHING about who calls it, so the contract is still
 * owed — and a rule spelled twice is how the same service grades `partial` in
 * one command and `documented` in another. `list`'s serviceViews
 * (`commands/list/views.ts`) derives the same rule fleet-wide in ONE pass —
 * a single `called` set for every service, not a partition per service —
 * so that spelling deliberately stays there, cross-referenced from both
 * sides: calling this per service inside a fleet loop would re-walk the
 * whole relationship list once per service.
 */
export function landscapeEvidence(req: LandscapeEvidenceRequest): LandscapeEvidence {
  const { id, parses, relationships, svcOf } = req;
  const inbound: LandscapeEdge[] = [];
  const outbound: LandscapeEdge[] = [];
  for (const r of relationships) {
    const edge = { op: r.op ?? null, title: r.title ?? null };
    if (svcOf(r.target) === id) inbound.push({ service: svcOf(r.source), ...edge });
    else if (svcOf(r.source) === id) outbound.push({ service: svcOf(r.target), ...edge });
  }
  return {
    inbound,
    outbound,
    modelled: req.elementIds.some((e) => svcOf(e) === id),
    apiExpected: !parses || inbound.some((e) => e.op !== null),
  };
}
