/**
 * The adoption-maturity ladder: one monotone word for how far a service's
 * documentation has got, and what stands between it and the next rung.
 *
 * This lived inside `commands/list.ts` while `list` was the only caller. It
 * moved here when `explore` needed the same answer, because the alternative is
 * the failure `core/kernel/ids.ts` already records for the service-id grammar: a
 * second, subtly different copy, so two commands grade the same directory
 * differently and nobody can tell which one is lying. The rung is a fleet dial
 * — `list` prints it per service and in a rollup, `explore` prints it for a
 * service somebody is about to build against — and a dial with two readings is
 * not a dial.
 */
import type { ServiceEntry } from "../repo/repo.js";

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
 * unchecked list (brief.ts): a service with one endpoint documented out of
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
 * vouched for, reported as unfinished forever, and a rollup that therefore said
 * a correctly-adopted fleet was half-done. The evidence is the same one
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
