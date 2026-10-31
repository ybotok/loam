/**
 * The spine lens — which of a graded run's findings `loam validate --spine`
 * shows, and what it says about the rest.
 *
 * Level 1 of adoption asks ONE question of a fleet: does every operation and
 * message a map edge names exist in the contracts at both ends? A fleet that
 * has stated its joins and copied its contracts, and done nothing else, gets an
 * honest answer to that from the default run — buried under one
 * `service.no-model` per service, a `service.no-spec` per service and an
 * ungoverned-operations warning per contract, every one of them true and none
 * of them about the question. The lens grades nothing differently. Every check
 * runs exactly as it would without it, at the same severity; the lens only
 * PARTITIONS what came back, after the last target is graded, and every rollup
 * the run reports (`valid`, `summary`, `fixes`, `--strict`, the text report) is
 * then computed over the shown half.
 *
 * The partition FAILS VISIBLE, and that is the property the whole design rests
 * on. The rule names what to hide — the adoption axes level 1 does not ask
 * about, by exact code and by family prefix — and shows everything else. A
 * code nobody has classified yet, the next one a later loam adds, a refusal
 * nobody foresaw: each is shown, so the lens can make a run noisier than it
 * should be but never greener. Three pins keep the deny-list honest
 * (test/spine-lens.test.ts): `SPINE_MUST_SHOW` names every code that means a
 * join was suspended or never checked and must not match a hide rule; every
 * exact entry and every prefix must match a code loam really emits, so no rule
 * is a pin on nothing; and the whole hidden set is
 * compared against a snapshot, so a new code that lands under a hidden prefix
 * fails the suite until somebody decides it belongs there.
 */
import { type Finding, type TargetReport } from "../../../core/vocabulary/report.js";

/**
 * Hidden by exact code: the adoption checks that share a family with spine
 * findings and so cannot be hidden by prefix. `service.no-openapi` lives next
 * to `service.no-model`, `landscape.matched` next to
 * `landscape.service-isolated` — the family says nothing about which side of
 * the line a code sits on, so these are named one by one.
 */
export const SPINE_HIDE_EXACT: ReadonlySet<string> = new Set([
  "service.no-model",
  "service.no-spec",
  "service.no-requirement-delta",
  "service.likec4-config-missing",
  "service.likec4-config-stray",
  "service.model-excluded",
  "service.model-unexcluded",
  "landscape.datastore-shared",
  "landscape.platform-candidate",
  "landscape.service-isolated",
  "subsystem.views-stale",
  "subsystem.view-id-collision",
  "openapi.response-undescribed",
  "asyncapi.payload-undescribed",
  "agents.stale",
  "content.stale",
  "coherence.ok",
  "scaffold.placeholder",
]);

/**
 * Hidden by family: requirements, governance, provenance, evidence, the
 * service models and every other axis a fleet climbs AFTER its joins hold.
 * Each prefix ends in its `.`, so `spec.` never swallows `spec-api.`.
 */
export const SPINE_HIDE_PREFIX: readonly string[] = [
  "api.", "event.", "spec.", "spec-api.", "spec-event.", "requirements.", "living.",
  "frontmatter.", "intent.", "delta.", "sources.", "evidence.", "gherkin.", "verify.",
  "cross.", "permissions.", "capability.", "obligation.", "glossary.", "health.",
  "covers.", "archedge.", "usecase.", "deployment.", "link.", "c4-api.", "c4-event.", "c4.",
];

/**
 * The one exception carved out of a hidden family. `c4.fleet-project-invalid`
 * says the project LikeC4 renders out of the map did not build — which is the
 * map, the document every join is read from — so it is a spine finding that
 * happens to carry a model-family name.
 */
const SPINE_PREFIX_EXCEPTIONS: ReadonlySet<string> = new Set(["c4.fleet-project-invalid"]);

/**
 * Pinned by name: the codes that mean a join was suspended or never checked —
 * an unparsable map or contract, a contract a join needs but is missing, a
 * commit that never finished, a binary older than the corpus it reads. Not a
 * rule the lens applies (fail-visible already shows them); the list the suite
 * holds the hide rules to, so a prefix added for one family cannot quietly
 * cover one of these. Every entry is a code loam emits today — a row for a
 * code that does not exist yet would be a pin on nothing.
 */
export const SPINE_MUST_SHOW: readonly string[] = [
  "spine.landscape-invalid", "spine.message-external", "spine.message-unbound",
  "spine.message-undefined", "spine.message-unproduced", "spine.op-deprecated",
  "spine.op-link-missing", "spine.op-undefined", "spine.resolved",
  "landscape.invalid", "landscape.missing", "landscape.merge-conflict", "landscape.matched",
  "landscape.binding-unknown", "landscape.binding-duplicate", "landscape.service-undocumented",
  "landscape.service-unmodelled", "landscape.excluded", "landscape.kind-tag-graded",
  "c4.fleet-project-invalid",
  "openapi.invalid", "asyncapi.invalid", "openapi.duplicate-operationid", "asyncapi.duplicate-message",
  "asyncapi.message-contested", "openapi.ref-unresolved", "asyncapi.ref-unresolved",
  "openapi.remove-marker-living", "asyncapi.remove-marker-living", "openapi.generated-stale",
  "contracts.source-missing", "contracts.source-invalid",
  "service.no-openapi", "service.no-asyncapi", "service.unknown", "service.unreadable", "service.id-invalid",
  "docs.commit-interrupted", "docs.binary-behind",
  "subsystem.invalid", "subsystem.name-collision", "subsystem.name-invalid", "subsystem.unmarked",
  "subsystem.marker-misplaced",
  "target.ambiguous",
];

/** The refusal for a feature under the lens — one sentence, whichever spelling named the feature. */
export const SPINE_REFUSES_FEATURE =
  "--spine grades the living fleet map's joins; a feature is a proposal graded by its own gate — drop one.";

/**
 * Whether the spine lens hides a finding with this code. The parameter is not
 * named `code` on purpose: the stable-code collector (test/helpers/stable-codes.ts)
 * reads every function with a `code` parameter as an EMITTER and every call to
 * it as a code slot, and this predicate emits nothing.
 */
export function spineHides(raised: string): boolean {
  if (SPINE_HIDE_EXACT.has(raised)) return true;
  if (SPINE_PREFIX_EXCEPTIONS.has(raised)) return false;
  return SPINE_HIDE_PREFIX.some((prefix) => raised.startsWith(prefix));
}

/** What the lens set aside, counted the way the run's own summary counts. */
export interface HiddenTally {
  errors: number;
  warnings: number;
  /**
   * Hidden errors and warnings by code, keys in codepoint order so the payload
   * is the same bytes on every machine. Hidden `ok` confirmations are not
   * counted: they confirm an axis the lens does not grade, there is nothing in
   * them a reader owes, and on a clean fleet they are most of the findings —
   * counting them would bury the codes that DO need doing under the ones that
   * do not. The sum of the values is `errors + warnings`, by construction.
   */
  byCode: Record<string, number>;
}

/** A run seen through the lens: the shown targets every rollup reads, and the tally of the rest. */
export interface SpineLens {
  targets: TargetReport[];
  hidden: HiddenTally;
}

/**
 * Partition every target's findings. Targets are kept even when nothing on
 * them is shown — a target is what was graded, and dropping one would make
 * `summary.services` count something other than the services this run looked
 * at. New target objects, never an edit in place: the caller's `targets` are
 * the graded run, and the partition is a view over it.
 */
export function applySpineLens(targets: readonly TargetReport[]): SpineLens {
  const counts = new Map<string, number>();
  let errors = 0;
  let warnings = 0;
  const shown = (f: Finding): boolean => {
    if (!spineHides(f.code)) return true;
    if (f.severity !== "ok") {
      if (f.severity === "error") errors += 1;
      else warnings += 1;
      counts.set(f.code, (counts.get(f.code) ?? 0) + 1);
    }
    return false;
  };
  const lensed = targets.map((t) => ({ ...t, findings: t.findings.filter(shown) }));
  const byCode: Record<string, number> = {};
  for (const raised of [...counts.keys()].sort()) byCode[raised] = counts.get(raised) ?? 0;
  return { targets: lensed, hidden: { errors, warnings, byCode } };
}
