/**
 * The ancestor chain of a dotted element id — `a.b.c` yields `a.b`, then `a`.
 *
 * A leaf of its own because five modules were each walking it privately, in two
 * spellings, and the walk is not incidental to any of them: it is the rule that
 * a landscape does not have to draw a service as one opaque box. The moment
 * somebody models its containers — `paymentService.api`, `paymentService.worker`
 * — an edge drawn INTO a container is still an edge into the service, and every
 * join that groups by service has to know that. Resolving only the exact id is
 * what made those edges invisible: the spine check silently skipped them, and
 * the no-openapi grace treated a service with a dozen inbound container calls as
 * one nobody calls at all.
 *
 * The same walk answers a second question one altitude down, which is why a
 * fifth copy appeared. A service model draws an edge at `kafka.orderEvents`
 * while the fleet's health.yaml names the dependency `kafka`, so the slice of a
 * per-service project has to carry the ANCESTOR of a partner endpoint as well as
 * the endpoint (`core/c4/service-model/slice.ts`). Dropping it would turn a
 * fleet's dependency declarations into `health.dependency-unmodelled` findings
 * on the day it migrated its models, with nothing in the docs having changed.
 *
 * TWO SPELLINGS, both exported, because both are real and picking one would make
 * every second caller write `[id, ...properAncestorIds(id)]` or `.slice(1)` — a
 * per-call-site adjustment is exactly how a shared walk drifts back into five.
 * A resolver that also looks the element itself up wants `ancestorIds`; a walk
 * that has already handled the element wants `properAncestorIds`.
 *
 * No brand and no validation: this is string arithmetic over an id a DOCUMENT
 * spells, and `core/kernel/ids/service.ts`'s provenance rules are about names
 * that have to answer for a directory. An id with no dot in it has no ancestors
 * and yields the empty list, which is the correct answer rather than an edge
 * case — a top-level element belongs to nothing above it.
 */

/** Every dotted ancestor of an id, NEAREST FIRST and excluding the id itself. */
export function properAncestorIds(id: string): string[] {
  const out: string[] = [];
  // Walking right-to-left from the last dot rather than splitting and rejoining:
  // the ids are already strings, the answer is a set of prefixes of one of them,
  // and a split/join round trip would invent a rule about what a segment may
  // contain that nothing else here has.
  for (let dot = id.lastIndexOf("."); dot !== -1; dot = id.lastIndexOf(".", dot - 1)) {
    out.push(id.slice(0, dot));
  }
  return out;
}

/** The id itself, then every dotted ancestor of it, nearest first. */
export function ancestorIds(id: string): string[] {
  return [id, ...properAncestorIds(id)];
}

/**
 * The id a declaration nests directly under — `""` for a top-level one, which
 * nests under nothing.
 *
 * The nearest ancestor, named because that is the question the callers ask:
 * `properAncestorIds(id)[0] ?? ""` is the same walk spelled as an array index,
 * and every reader has to re-derive that the first entry is the parent. It is
 * here rather than beside its callers for the reason the file exists at all —
 * the archive's two merges had each grown a private copy, and a third was about
 * to appear the moment the routing gained a module.
 */
export function parentIdOf(id: string): string {
  const dot = id.lastIndexOf(".");
  return dot === -1 ? "" : id.slice(0, dot);
}
