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
import { featureChecklist } from "../../core/verify/checklist.js";
import { readVerification } from "../../core/verify/file.js";
import { type AnsweredBy } from "../../core/verify/answers.js";
import {
  confirmedProvenance,
  tallyRecord,
  type VerificationVerdict,
  verificationVerdict,
} from "../../core/verify/record.js";
import type { DocsDir } from "../../core/kernel/ids/dirs.js";

export interface ServiceView extends MaturityInput {
  /** True when this service's `sources` can only be resolved from its own repo. */
  unverifiableFromHere: boolean;
  maturity: Maturity;
  /** What stands between this service and the next rung, in fix order. */
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
      if (r.op !== undefined) called.add(svcOf(r.target));
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

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

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
 * The verification column. `readVerification` is one file read; the checklist
 * is derived only when there is a record to judge — on a fleet-sized repo most
 * features have none, and deriving N checklists to print N dashes is the cost
 * that would get this column dropped.
 *
 * An archived feature's record is frozen history (see `core/verify/record.ts`): archive
 * merged the feature's operations into the living openapi, so a re-derived
 * checklist can only mismatch — the record is reported as recorded, never
 * judged stale.
 */
export async function featureVerification(
  docsDir: DocsDir,
  f: FeatureEntry,
): Promise<VerificationCell | null> {
  const v = await readVerification(f.dir);
  if (v === null) return null;
  const stale = f.archived
    ? false
    : (await featureChecklist(docsDir, f.dir, f.id)).digest !== v.checklist;
  const tally = tallyRecord(v);
  return {
    state: stale ? "stale" : "recorded",
    recorded: v.recorded,
    verdict: verificationVerdict(tally, stale),
    confirmed: tally.confirmed,
    claims: tally.claims,
    attested: tally.attested,
    answered: confirmedProvenance(v.claims),
  };
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/**
 * Fixed-width presence flags. `a` and `A` are deliberately the same letter in
 * two cases: the arch spec and the API are the two things a reader most often
 * mistakes for each other, and one is lowercase because it is optional.
 */
