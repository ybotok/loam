/**
 * The adoption vocabulary of the fleet scorecard: which contract axes a
 * service PARTICIPATES in, summed to the fleet's per-axis participation
 * counts, and the mechanical rule for which warnings the `--all` text report
 * may fold under a per-axis "not started" banner.
 *
 * A leaf on purpose: it imports nothing, so `../report.ts` (the text
 * renderer) and `./contracts.js` (which computes the per-service booleans)
 * can both use it without closing a cycle — `adoptionOf` takes the smallest
 * structural parameter it needs instead of the ContractCounts type,
 * core/vocabulary/maturity.ts's EdgeSource precedent for staying a leaf.
 */

/**
 * The six contract axes a service adopts one at a time, in the order every
 * rendering walks them. Participation is a per-service boolean with one
 * mechanical rule per axis, spelled on `Scorecard.adoption` (./scorecard.js)
 * where the payload key freezes them.
 */
export const ADOPTION_AXES = [
  "requirements",
  "arch",
  "openapi",
  "asyncapi",
  "permissions",
  "capabilities",
] as const;

export type AdoptionAxis = (typeof ADOPTION_AXES)[number];

/**
 * Participating services per axis. Flat counts — the denominator is
 * `Scorecard.services`, carried once so two copies cannot disagree. An axis
 * at 0 reads "not started"; 0 < N < M is "partially adopted", and the two
 * must never be conflated: a banner that grouped a partially-adopted axis's
 * warnings would hide the exact services the count says are missing.
 */
export type Adoption = Record<AdoptionAxis, number>;

/** Sum the per-service participation booleans into the fleet's counts. */
export function adoptionOf(
  perService: ReadonlyArray<{ readonly participates: Readonly<Record<AdoptionAxis, boolean>> }>,
): Adoption {
  const out: Adoption = { requirements: 0, arch: 0, openapi: 0, asyncapi: 0, permissions: 0, capabilities: 0 };
  for (const svc of perService) {
    for (const axis of ADOPTION_AXES) if (svc.participates[axis]) out[axis] += 1;
  }
  return out;
}

/**
 * THE QUALIFICATION RULE — this table IS the rule, and it is mechanical and
 * fail-closed. A finding is grouped under an axis's "not started" banner iff
 * (1) its severity is `warn`, (2) its code is listed in this table's row for
 * the axis, (3) this run's `adoption[axis] === 0`, and (4) the run could
 * measure that zero at all — a fleet with at least one service and no
 * `service.unreadable` subject (report.ts enforces this half, beside the
 * banner it gates: "0 of 0" is no fleet, and an unreadable service's
 * all-false participation must not manufacture the zero). Anything else —
 * every error, every warn code not listed here, every warn on an axis with
 * even one participating service — prints ungrouped, exactly as before. When
 * in doubt a code stays OUT of the table: the cost of a wrongly-ungrouped
 * warning is noise, the cost of a wrongly-grouped one is a hidden defect.
 *
 * A row lists exactly the warn codes whose SOLE cause is the axis not being
 * started fleet-wide — codes whose remedy presupposes starting the axis at
 * all, so with zero participating services the per-target repetition carries
 * no information the one banner does not:
 *
 * - requirements: `service.no-spec` and `spec.no-requirements` fire once per
 *   service when nobody in the fleet has written a requirement block.
 * - openapi: `service.no-openapi`'s WARN form (the error form — dangling
 *   authored links into the absent file — never groups, by condition 1), and
 *   `spine.op-link-missing`, which never reads the contract (service/spine.ts
 *   documents exactly that) and so fires per titled Calls-edge even with zero
 *   contracts fleet-wide.
 * - permissions: `permissions.unenforced` — one finding whose whole content
 *   is "the vocabulary exists and nothing cites it yet".
 * - capabilities: `capability.unrealized` — deliberately one warn PER
 *   declared capability (core/capabilities/findings.ts), so a freshly landed
 *   vocabulary warns M times before the first requirement names any of them.
 * - arch and asyncapi have NO code whose sole cause is fleet-wide absence
 *   (an absent arch.spec.md is silent; an absent asyncapi.yaml is silent or
 *   an error when authored links strand on it), so their rows are empty and
 *   those axes surface only in the scorecard's not-started one-liner.
 *
 * Rows are disjoint — a code belongs to exactly one axis — which is what lets
 * `groupedWarnCodes` invert the table into a Map. Not prose alone:
 * test/adoption-rollup.test.ts asserts the flattened rows hold no duplicate,
 * because a code filed under two axes would be grouped under whichever
 * happens to sit at zero — possibly hiding it behind a fully adopted axis.
 */
export const AXIS_GROUPED_WARNS: Record<AdoptionAxis, readonly string[]> = {
  requirements: ["service.no-spec", "spec.no-requirements"],
  arch: [],
  openapi: ["service.no-openapi", "spine.op-link-missing"],
  asyncapi: [],
  permissions: ["permissions.unenforced"],
  capabilities: ["capability.unrealized"],
};

/**
 * The table inverted for this run: warn code → its axis, for exactly the axes
 * this run's adoption counts put at zero. Insertion order is ADOPTION_AXES
 * order then row order, so every walk over the Map renders deterministically.
 */
export function groupedWarnCodes(adoption: Adoption): Map<string, AdoptionAxis> {
  const out = new Map<string, AdoptionAxis>();
  for (const axis of ADOPTION_AXES) {
    if (adoption[axis] !== 0) continue;
    for (const code of AXIS_GROUPED_WARNS[axis]) out.set(code, axis);
  }
  return out;
}
