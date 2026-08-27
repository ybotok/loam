/**
 * The fleet scorecard: ceiling-vs-actual aggregates for `validate --all`,
 * recomputed per invocation from the same memoized FleetContext reads the run
 * already paid for. loam stores no history — week-over-week tracking is the
 * caller's pipeline's job: capture the `scorecard` payload key per run into a
 * metrics store. Each axis is a pair of domain-named counts (`defined` vs
 * `governed`) rather than abstract ceiling/actual keys, because payload keys
 * freeze the moment they ship and the domain nouns survive axis nuance.
 *
 * This module derives and never prints; `./print.js` renders the one table
 * the `--all` text report appends, and `./contracts.js` owns the per-service
 * contract reads it sums.
 */
import { existsSync } from "node:fs";
import { inOrder } from "../../../../core/kernel/concurrency.js";
import { coversElement } from "../../../../core/c4/arch.js";
import { serviceResolver } from "../../../../core/c4/resolve/service.js";
import { type FleetContext } from "../../../../core/fleet-context.js";
import { type DocsDir } from "../../../../core/kernel/ids/dirs.js";
import { landscapePath } from "../../../../core/repo/paths.js";
import { fleetStatus } from "../../../../core/status/fleet/fleet.js";
import { ARTIFACT_STATUSES, type ArtifactStatus } from "../../../../core/status/report.js";
import { ANSWERED_BY, type AnsweredBy } from "../../../../core/verify/answers.js";
import { VERIFICATION_VERDICTS, type VerificationVerdict } from "../../../../core/verify/record.js";
import { maturityRollup, type Maturity } from "../../../../core/vocabulary/maturity.js";
import { subjectsWith, type TargetReport } from "../../../../core/vocabulary/report.js";
import { featureVerification, serviceViews, type VerificationCell } from "../../../list/views.js";
import { drawnSystems } from "../census.js";
import { readLandscape } from "../load.js";
import { adoptionOf, type Adoption } from "./adoption.js";
import { contractCounts, type ContractCounts } from "./contracts.js";

/** What `buildScorecard` needs of the run that is already in hand. */
export interface ScorecardInput {
  docsDir: DocsDir;
  /** The run's graded targets — the source for the one count only a repo-bound check can make (`sources.stale` walks the service's own repository, and must not run twice). */
  targets: TargetReport[];
  /** The run's memoized snapshot: every read below is a hit on it. */
  fleet: FleetContext;
  /** loam.json's `service` — the one repo whose `sources` are checkable from here (serviceViews' rule). */
  boundService: string | undefined;
}

/**
 * The additive `scorecard` payload key of `validate --all --json`, and the
 * `--all` text table. Shape frozen on ship, like every payload key: fields
 * may be added, never changed or removed.
 */
export interface Scorecard {
  /** Every `services/` directory the enumeration lists — the maturity rollup's denominator. */
  services: number;
  /** Counts per adoption-maturity rung, every rung present (core/vocabulary/maturity.ts). */
  maturity: Record<Maturity, number>;
  provenance: {
    /** Services at the `vouched` rung — a person stamped them. */
    vouched: number;
    /**
     * Of those, the ones where the person read a recorded SAMPLE of the
     * document rather than all of it, by subject off this run's
     * `sources.sampled-vouch` findings.
     *
     * Additive beside `vouched` rather than subtracted from it, because the
     * rung is real — a person did stamp it — but a dial reading
     * `vouched: 120` where 100 of them are sampled is exactly the
     * partial-trust-as-full-trust misreading the scope exists to prevent. A
     * dashboard that wants the stricter number subtracts this one knowingly.
     */
    sampledVouched: number;
    /**
     * Services whose stamped sources digest no longer matches the code, by
     * subject off this run's `sources.stale` findings — only what THIS run
     * could verify, so read it beside the count below, never alone.
     */
    staleDigests: number;
    /** Services whose declared `sources` only their own repos can check. */
    unverifiableFromHere: number;
  };
  verification: {
    /**
     * Active features with a verification record beside them. Its ceiling is
     * `features.active` — deliberately not repeated here: one denominator,
     * derived once, so the two axes cannot disagree about how many features
     * are in flight.
     */
    recorded: number;
    /** The recorded features' three-valued verdicts (core/verify/record.ts), every key present. */
    verdicts: Record<VerificationVerdict, number>;
    claims: {
      /** Questions asked across every recorded feature, `tallyRecord`'s counting. */
      total: number;
      confirmed: number;
      /**
       * Of the confirmed, one count per `answered_by` value (`ANSWERED_BY`),
       * every key present — the stable-shape rule `verdicts` and `stages`
       * follow, so a fourth provenance would appear rather than be absorbed.
       *
       * Read off the answers' own provenance, never by subtracting the
       * attested share: `attestedClaims` counts `scenario.tested` alone, so
       * `confirmed - attested` filed every OTHER kind an agent confirmed — a
       * permission, a capability, an exposed operation — under a test runner
       * that had not run. A record with four agent answers printed as three
       * runner and one agent, which is the reading this axis exists to give.
       */
      answered: Record<AnsweredBy, number>;
    };
  };
  /**
   * The HTTP axis, with a deliberate UNIT split: `defined`/`governed` count
   * contract SLOTS, exactly as the API axis's own findings count operations,
   * while `deprecated`/`deprecatedStillConsumed` count DISTINCT operationIds —
   * a duplicate-id slot pair (already its own warning) retires as ONE
   * operation, one migration owed.
   */
  operations: {
    /** Slots the living contracts define (removal markers are never operations). */
    defined: number;
    /** Slots (like `defined`) whose id a living requirement's `Operations:` line governs. */
    governed: number;
    /** Distinct deprecated operationIds. */
    deprecated: number;
    /** Distinct deprecated ids something still joins to — a living `Operations:` line, or an op-linked inbound landscape edge. */
    deprecatedStillConsumed: number;
  };
  messages: {
    /** Distinct message names the living async contracts declare. */
    defined: number;
    /** Of them, the ones a requirement's `Publishes:`/`Consumes:` line governs. */
    linked: number;
  };
  c4: {
    /** The drawn SYSTEMS — `drawnSystems`, the fleet map's own census, so the map's exemptions (actors, `#external`, groupings, containers) and this count cannot drift. */
    elements: number;
    /** Of them, the ones some living arch requirement's `Covers:` entry names. */
    covered: number;
  };
  /**
   * Services PARTICIPATING in each contract axis — how far the staged
   * adoption has spread, axis by axis. The denominator is `services`, carried
   * once above like every other denominator here. One mechanical rule per
   * axis, per service: `requirements` — spec.md holds at least one
   * `### Requirement:` block (content, not file presence, so a fleet of empty
   * adopt scaffolds honestly reads "not started"); `arch` — the same for
   * arch.spec.md; `openapi` / `asyncapi` — the contract file exists;
   * `permissions` / `capabilities` — at least one non-REMOVED requirement in
   * either spec document carries a `Requires:` / `Capability:` entry (the
   * used-set rule the fleet vocabulary checks apply). An axis at 0 is "not
   * started" — distinct from partially adopted — and is what licenses the
   * text report's per-axis warning banner (./adoption.js). An unreadable
   * service counts as participating in nothing, the same zeros doctrine as
   * every count here — read these beside the run's `service.unreadable`
   * findings, and note the text renderer refuses to group warnings on a run
   * that has any (report.ts).
   */
  adoption: Adoption;
  features: {
    active: number;
    /**
     * The fleet form's stage per active feature — all five ARTIFACT_STATUSES
     * keys even though that form never grades `draft` (the maturityRollup
     * rule: a stable shape a dashboard can diff).
     */
    stages: Record<ArtifactStatus, number>;
  };
}

/**
 * Derive the scorecard, or decline. The failure story, per axis: a memoized
 * read that FAILED rejects again on every await, so the per-service fan-out
 * contains those per subject — an unreadable service contributes zeros while
 * its own `service.unreadable` finding names the cause — and every landscape
 * read goes through `../load.ts`'s containment, so an unreadable fleet map
 * zeroes the map-derived axes on every platform instead of deleting the card.
 * The catch is the last line of defence for the fleet-wide reads this module
 * does not own (the verification cells, the fleet status): a rollup that can
 * die must not take the graded report with it. No number rather than a wrong
 * number.
 */
export async function buildScorecard(input: ScorecardInput): Promise<Scorecard | null> {
  try {
    return await derive(input);
  } catch {
    // Unreadable is not zero: the axes cannot be counted, so no claim is made.
    return null;
  }
}

async function derive(input: ScorecardInput): Promise<Scorecard> {
  const { docsDir, targets, fleet, boundService } = input;
  const services = await fleet.listServices(docsDir);

  // The landscape, through the run's memo and the fleet target's containment:
  // an unreadable file grades as one that did not parse, and a landscape that
  // proves nothing contributes no inbound edges and no element census —
  // fail-closed, exactly as the no-openapi grace reads the same absence.
  // Loaded FIRST and handed to serviceViews below, so the maturity rollup
  // costs no second parse of a document this run already holds.
  const lp = landscapePath(docsDir);
  const land = existsSync(lp) ? await readLandscape(() => fleet.loadLikeC4(lp)) : null;
  const proven = land !== null && land.errors.length === 0;

  const views = await serviceViews(docsDir, services, boundService, land);
  const maturity = maturityRollup(views);

  // Inbound op-linked edges per service, resolved exactly as the API axis
  // resolves them (service/api.ts): the container-aware resolver, so an edge
  // drawn into `paymentService.api` counts for the service that owns it.
  const known: ReadonlySet<string> = new Set(services.map((s) => s.id));
  const inbound = new Map<string, Set<string>>();
  if (proven) {
    const svcOf = serviceResolver(land.elements, known);
    for (const r of land.relationships) {
      if (r.op === undefined) continue;
      const owner: string = svcOf(r.target);
      const ops = inbound.get(owner) ?? new Set<string>();
      ops.add(r.op);
      inbound.set(owner, ops);
    }
  }

  // Every read in THIS fan-out is a memo hit — the service targets already
  // parsed both requirement documents and both contracts — so it spawns no new
  // filesystem work and needs no pool (unlike the verification fan-out below).
  const perService = await Promise.all(
    services.map((svc) => contractCounts(svc, fleet, inbound.get(svc.id) ?? new Set<string>())),
  );
  const sum = (pick: (c: ContractCounts) => number): number =>
    perService.reduce((n, c) => n + pick(c), 0);
  const operations = {
    defined: sum((c) => c.operations.defined),
    governed: sum((c) => c.operations.governed),
    deprecated: sum((c) => c.operations.deprecated),
    deprecatedStillConsumed: sum((c) => c.operations.deprecatedStillConsumed),
  };
  const messages = { defined: sum((c) => c.messages.defined), linked: sum((c) => c.messages.linked) };
  const adoption = adoptionOf(perService);

  // C4 coverage: the fleet map's own system census (`drawnSystems` — the set
  // the undocumented pass walks) against every living arch.spec.md's `Covers:`
  // entries. Element entries only — an edge entry names no element.
  const covers = perService.flatMap((c) => c.covers);
  const eligible = proven ? drawnSystems(land.elements, known) : [];
  const covered = eligible.filter((e) => covers.some((c) => coversElement(c, e))).length;

  // Verification: `list`'s own cells, so the two commands cannot disagree
  // about a record's verdict. Active features only — an archived record is
  // frozen history, not fleet debt. This fan-out is NOT memo hits:
  // readVerification is one small file read per feature, and a recorded cell
  // additionally derives its checklist (the same cost `list` pays for the same
  // column) — real filesystem work, so it runs through the bounded pool.
  const features = await fleet.listFeatures(docsDir);
  const cells = await inOrder(features, (f) => featureVerification(docsDir, f));
  const recorded = cells.filter((c): c is VerificationCell => c !== null);
  const verdicts = Object.fromEntries(VERIFICATION_VERDICTS.map((v) => [v, 0])) as Record<VerificationVerdict, number>;
  for (const cell of recorded) verdicts[cell.verdict] += 1;
  const confirmed = recorded.reduce((n, c) => n + c.confirmed, 0);
  const answered = Object.fromEntries(
    ANSWERED_BY.map((who) => [who, recorded.reduce((n, c) => n + c.answered[who], 0)]),
  ) as Record<AnsweredBy, number>;

  // The fleet form of `status`, on this run's own snapshot: presence and
  // dependency order, nothing graded — the stages an agent already branches on.
  const status = await fleetStatus(docsDir, { context: fleet });
  const stages = Object.fromEntries(ARTIFACT_STATUSES.map((s) => [s, 0])) as Record<ArtifactStatus, number>;
  for (const f of status.features) stages[f.stage] += 1;

  return {
    services: services.length,
    maturity,
    provenance: {
      vouched: maturity.vouched,
      // Both counts join through `subjectsWith` on the run's OWN findings, so
      // each is structurally the same number as the report beside it — the
      // unverifiable count is the footer's (unverifiableSubjects is the same
      // call on the same code; this package cannot import the parent back).
      // Both codes are LITERALS — provenance/sources.ts's own spellings —
      // because the stable-code collector reads counting sites and refuses a
      // slot it cannot read; the collector is also what convicts a typo here.
      staleDigests: subjectsWith(targets, "sources.stale"),
      unverifiableFromHere: subjectsWith(targets, "sources.unverifiable-from-here"),
      // Doc-side, so unlike `staleDigests` this one is complete even from the
      // docs repo: `sources.sampled-vouch` needs no service repo to fire.
      sampledVouched: subjectsWith(targets, "sources.sampled-vouch"),
    },
    verification: {
      recorded: recorded.length,
      verdicts,
      claims: {
        total: recorded.reduce((n, c) => n + c.claims, 0),
        confirmed,
        answered,
      },
    },
    operations,
    messages,
    c4: { elements: eligible.length, covered },
    adoption,
    features: { active: status.features.length, stages },
  };
}
