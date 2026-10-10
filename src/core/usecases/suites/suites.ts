/**
 * Suites: which use cases run together, and what a run of one needs standing up.
 *
 * A use case joins a suite by carrying a `#suite-<name>` tag on its `dynamic
 * view`. A TAG rather than a directory, because suites are many-to-many — one
 * journey belongs to the smoke suite and the payments suite at once — and a
 * directory gives exactly one group. The tag also buys the typo check for free:
 * LikeC4 refuses an undeclared tag, so a suite declared once in the landscape's
 * `specification` block makes a mistyped suite a parse error, where a mistyped
 * directory would silently open a second, empty suite.
 *
 * A SEPARATE PREFIX, not `#cap-`. A capability says what a flow is FOR and may
 * be claimed once per meaning; a suite says what a flow is RUN WITH, and a
 * flow is routinely in several. Reusing the capability tag would make every
 * suite a business promise and every smoke run a capability, and the `#cap-`
 * resolution ladder (`../../capabilities/usecase-join.ts`) would convict every
 * suite name the vocabulary does not declare. The prefix also keeps the tag
 * clear of the feature-id grammar: a view tag is never read as a `#FEAT-`
 * marker (feature tags are read off elements and relationships only), and no
 * other reserved prefix — `cap-`, `req-`, `obl-` — is a prefix of this one or
 * has it as a prefix, so no tag can be claimed by two readers.
 *
 * TAGGING IS THE OPT-IN, and that is the owner's call recorded in SCHEMA.md: a
 * view carrying only `#suite-` tags IS a use case — `../fleet.ts`' `isUseCase`
 * admits it — and is graded hop by hop like any other. Nothing here grades; this
 * module groups the views the scan already admitted.
 *
 * Depends on its parent by TYPE only — `./participants.ts` says why the value
 * direction is parent → child.
 */
import type { ParsedView } from "../../c4/parsed/dynamic-views.js";
import { compareIds } from "../../repo/entries.js";
import { participantsOf, type ReadScan, type UnresolvedParticipant } from "./participants.js";

/**
 * The reserved tag prefix, matched EXACTLY — case included — as `cap-` and
 * `req-` are. Exported for `../fleet.ts`, where it joins the other two in the
 * one opt-in predicate and the one byte gate in front of it.
 */
export const SUITE_TAG_PREFIX = "suite-";

/**
 * The suite names one view declares: the tags with the prefix stripped,
 * deduplicated and sorted.
 *
 * A bare `#suite-` is a suite named `''` and is KEPT, for the reason a bare
 * `#cap-` stays a claim: the prefix is the opt-in however little follows it,
 * and a view that asked to be in a suite must not silently be in none.
 */
function suiteNames(view: { tags: readonly string[] }): string[] {
  const names = view.tags.filter((tag) => tag.startsWith(SUITE_TAG_PREFIX)).map((tag) => tag.slice(SUITE_TAG_PREFIX.length));
  return [...new Set(names)].sort(compareIds);
}

/** One suite: its name, its use cases, and the environment their union needs. */
export interface Suite {
  /** The tag without `#suite-` — what `loam list suites <name>` takes. */
  name: string;
  /** The use cases carrying the tag, ordered by (document, view id). */
  views: ParsedView[];
  /** The enumerated services those use cases draw — what must be up. */
  services: string[];
  /** Participants that resolve to no enumerated service — named, never dropped. */
  unresolved: UnresolvedParticipant[];
}

/** Every suite the fleet's use cases declare, and the use cases in none. */
export interface SuiteListing {
  /** Sorted by name. */
  suites: Suite[];
  /**
   * The use cases carrying no `#suite-` tag, ordered by (document, view id).
   *
   * Answered because everything else here is per-suite: a journey in no suite
   * is absent from every suite's list, which is the one absence a per-suite
   * output cannot show. Legal and normal — an unfiled service is the same shape
   * — so it is named and never graded.
   */
  ungrouped: ParsedView[];
}

/**
 * Group the scan's use cases by suite.
 *
 * The order is by (document, view id). `../place.ts`' `viewFile` is how a
 * document is SPELLED, and it only prefixes `sourcePath` with a constant, so
 * ordering on `sourcePath` itself orders identically without pointing this
 * package back at its parent.
 */
export function suiteListing(scan: ReadScan): SuiteListing {
  const ordered = [...scan.views].sort(
    (a, b) => compareIds(a.sourcePath ?? "", b.sourcePath ?? "") || compareIds(a.id, b.id),
  );
  const byName = new Map<string, ParsedView[]>();
  const ungrouped: ParsedView[] = [];
  for (const view of ordered) {
    const names = suiteNames(view);
    if (names.length === 0) ungrouped.push(view);
    for (const name of names) byName.set(name, [...(byName.get(name) ?? []), view]);
  }
  const suites = [...byName]
    .sort(([a], [b]) => compareIds(a, b))
    .map(([name, views]) => ({ name, views, ...participantsOf(scan, views) }));
  return { suites, ungrouped };
}
