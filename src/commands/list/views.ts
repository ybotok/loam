/**
 * What the list actually reads: one row per service, one verification cell per
 * feature.
 *
 * Both are gathered before anything is printed or serialized, because the same
 * numbers appear in `--json` and in the worklist footer — a footer computed
 * from a second read is a footer that can contradict the rows above it.
 */
import { existsSync } from "node:fs";
import { loadFile, type LoadedDoc } from "../../core/c4/likec4.js";
import { serviceResolver } from "../../core/c4/resolve/service.js";
import {
  maturityGaps,
  serviceMaturity,
  type Maturity,
  type MaturityInput,
} from "../../core/vocabulary/maturity.js";
import { type FeatureEntry, type ServiceEntry } from "../../core/repo/entries.js";
import { landscapePath, servicePathsAt } from "../../core/repo/paths.js";
import { featureTitle } from "../../core/repo/repo.js";
import type { FleetContext } from "../../core/fleet-context.js";
import { verificationState } from "../../core/status/verification.js";
import { type AnsweredBy } from "../../core/verify/answers.js";
import { type VerificationVerdict } from "../../core/verify/record.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

export interface ServiceView extends MaturityInput {
  /** True when this service's `sources` can only be resolved from its own repo. */
  unverifiableFromHere: boolean;
  maturity: Maturity;
  /**
   * What stands between this service and the next rung, in fix order — and at
   * `vouched`, the re-vouch a document that moved under its stamp owes
   * (`maturityGaps`). Empty exactly when nothing is owed, which is the
   * worklist's membership test.
   */
  missing: string[];
}

/**
 * Read the living landscape ONCE and decide, per service, whether an API is
 * expected of it. `serviceResolver` is handed the real service ids so an edge
 * drawn into a modelled container (`paymentService.api`) counts for the service
 * that owns it — the same resolution `validate` uses, so the two commands
 * cannot disagree about who is called.
 */
export async function serviceViews(
  docsDir: DocsDir,
  services: ServiceEntry[],
  boundService: string | undefined,
  preloaded?: LoadedDoc | null,
): Promise<ServiceView[]> {
  const known = new Set(services.map((s) => s.id));
  const lp = landscapePath(docsDir);
  // `preloaded` is the landscape a caller already holds — `undefined` means
  // "load it if it exists", null "there is none", the convention
  // validateService's own `preloaded` follows. The fleet scorecard hands in
  // the batch-parsed doc because a healthy `validate --all` must spin ZERO
  // per-document workspaces (test/validate-batch-fallback.test.ts counts
  // them), and a second parse of a document that run already holds was the
  // exact per-path cost the batch loader exists to retire.
  const land = preloaded !== undefined ? preloaded : existsSync(lp) ? await loadFile(lp) : null;
  const called = new Set<string>();
  // Positive evidence only: with no landscape, or one that does not parse, we
  // know nothing about who is called and every service is assumed to have an
  // API — the conservative direction, because claiming a service needs no
  // contract is how a real one goes undocumented. This is the SAME rule
  // `landscapeEvidence` (core/vocabulary/maturity.ts) spells per service for
  // explore and the context pack — derived fleet-wide here in one pass (one
  // `called` set for every service) because calling the per-service partition
  // from this loop would re-walk the whole relationship list once per
  // service. If the rule moves, both spellings move.
  const proven = land !== null && land.errors.length === 0;
  if (proven) {
    const svcOf = serviceResolver(land.elements, known);
    for (const r of land.relationships) {
      // …including its self-edge rule: an edge whose two endpoints resolve to
      // one service is that service's own internal wiring, and counting it made
      // a service nobody calls owe an OpenAPI contract — `partial` here while
      // `loam context` (which reads the shared derivation) said `documented`.
      if (r.op !== undefined && svcOf(r.source) !== svcOf(r.target)) called.add(svcOf(r.target));
    }
  }

  return services.map((entry) => {
    const archSpec = existsSync(servicePathsAt(entry.dir).archSpec);
    const apiExpected = !proven || called.has(entry.id);
    const view = {
      entry,
      archSpec,
      apiExpected,
      unverifiableFromHere: entry.sources.declared && boundService !== entry.id,
    };
    const missing = maturityGaps(view);
    return { ...view, maturity: serviceMaturity(view), missing };
  });
}

/** What the features table says about verification without N `loam verify` runs. */
export interface VerificationCell {
  state: "recorded" | "stale";
  /** The day the record was written. */
  recorded: string;
  /**
   * `verify --json`'s own three-valued verdict, through `verificationVerdict` —
   * not a fourth opinion computed here. `attested` is the one this column got
   * wrong: a scenario confirmed on an agent's word printed as `11/11` under a
   * heading that said `verified`, and `list --json` is how the fleet is graded.
   */
  verdict: VerificationVerdict;
  /** Both counts are `tallyRecord`'s — the record's `claims[]`, never its `summary:` block. */
  confirmed: number;
  claims: number;
  /** Of the confirmed, the scenario claims on an agent's word (`attestedClaims`). */
  attested: number;
  /**
   * Of the confirmed, one count per `answered_by` value (`confirmedProvenance`), every key
   * present. A different question from `attested` above, which is why both are here: `attested`
   * asks only about `scenario.tested` because that is what the verdict turns on, while this asks
   * who answered EVERY kind — and reading the first as if it were the second is how the fleet
   * scorecard credited agent-answered permission and operation claims to a test runner.
   */
  answered: Record<AnsweredBy, number>;
}

/**
 * The verification column: `status`'s own record state (`verificationState`),
 * projected onto the cell — the record read, the files added up against the
 * checklist just derived, the archived record read as frozen history — so
 * `list`, `status` and `gate` compute one cell, for the reasons that function
 * records. Reading the record is cheap but no longer one file read — a
 * directory listing and one small read per attesting service, plus the
 * one-file `verification.yaml` — and the checklist is derived only when there
 * is a record to judge: on a fleet-sized repo most features have none, and
 * deriving N checklists to print N dashes is the cost that would get this
 * column dropped. `fleet` is the invocation's read index, so each derivation's
 * enumerations and delta parse are memo hits rather than a walk per feature.
 *
 * A record that cannot be read is one dash like an absent one: this column
 * shows one glyph either way. That includes a record whose summary
 * contradicts its own claims (`verify.record-miscounted`), so no count from it
 * is printed as fact — reading it as absent is the safe half of the truth, and
 * `status` and `verify`, which can say why, report it as unreadable instead.
 */
export async function featureVerification(
  docsDir: DocsDir,
  f: FeatureEntry,
  fleet: FleetContext,
): Promise<VerificationCell | null> {
  const { state: s } = await verificationState(docsDir, f, { fleet });
  if (s.state === "absent" || s.state === "unreadable" || s.recorded === null) return null;
  return {
    state: s.state,
    recorded: s.recorded,
    verdict: s.verdict,
    confirmed: s.confirmed,
    claims: s.claims,
    attested: s.attested,
    answered: s.answered,
  };
}

/**
 * One features-table row: the feature, its verification cell, and what it is
 * called — carried together so the table and the payload iterate rows rather
 * than join two arrays by position.
 */
export interface FeatureRow {
  feature: FeatureEntry;
  cell: VerificationCell | null;
  /** intent.md's title (`featureTitle`) — the words a person recognises a change by; the id alone is a key. */
  title: string | null;
}

export async function featureRow(docsDir: DocsDir, f: FeatureEntry, fleet: FleetContext): Promise<FeatureRow> {
  return { feature: f, cell: await featureVerification(docsDir, f, fleet), title: await featureTitle(f) };
}
