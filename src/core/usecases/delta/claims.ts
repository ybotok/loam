/**
 * Which of this feature's own promises its own flows keep.
 *
 * A cross-service criterion — "I enter a login and a password and I am in" —
 * belongs to no single service's spec, because each service promises only its
 * own part. A `dynamic view` can carry it, because it IS the hop sequence, and
 * that is the whole reason `#req-` exists. Until `./flows.ts` gave a feature a
 * slot for one, this answer could only ever be empty inside a feature window:
 * the flow was a fleet document, so a tag naming a requirement the same change
 * was adding named something that was not living yet.
 *
 * WHAT THIS FEEDS. `capability.uncovered` — the archive gate that refuses a
 * promise nothing keeps. Its message used to end by telling authors to archive
 * with `--approve` and tag the flow AFTERWARDS, which was honest advice about a
 * hole rather than a workflow anybody wanted: it lands the promise first, kept
 * by nothing, and relies on somebody coming back.
 *
 * THE RULE IS `../capability.ts`'s AND MUST STAY SO. Only a RESOLVED claim
 * counts, and both halves must resolve — the `#cap-` tag to exactly one declared
 * capability, the `#req-` tag to exactly one of its requirements. A broken tag
 * of either kind is already an error (`usecase.capability-unresolved`,
 * `usecase.requirement-unresolved`) and must never also mark a promise kept: a
 * typo that silenced the gate would turn a mistake into a green archive. The two
 * resolvers are called directly rather than through
 * `useCaseRequirementClaims` for one reason, and it is not a difference of
 * opinion about the rule — that function flattens its answer to a `<cap>#<id>`
 * string, and `capabilities/delta/uncovered.ts` keys this same join on NUL
 * precisely because a capability id has no grammar forbidding `#`. Handing it a
 * key it has written down a reason not to use would be the wrong kind of reuse.
 *
 * THE LADDER TRAVELS. `declared === null` — an absent or unreadable
 * `architecture/capabilities.yaml` — is an empty answer, not a suspended one, and
 * the caller is already suppressing the whole family behind it. An `unreadable`
 * overlay is different and must NOT be flattened to "keeps nothing": loam did not
 * look, which is never the same answer as "there is nothing there", and a gate
 * that refused on it would blame the author for a map it could not read.
 */
import type { LoadedDoc } from "../../c4/likec4.js";
import type { ExtendingModel } from "../../c4/splice/contract.js";
import type { CapabilityVocabulary } from "../../capabilities/capabilities.js";
import { withFeatureCapabilities } from "../../capabilities/delta/overlay.js";
import type { CapabilityDeltaDoc } from "../../capabilities/delta/uncovered.js";
import { gradableCapabilityIds } from "../../capabilities/findings.js";
import { resolveCapabilityTags, resolveRequirementTags } from "../../capabilities/usecase-join.js";
import type { DocsDir, FeatureDir } from "../../kernel/ids/dirs.js";
import { compareIds } from "../../repo/entries.js";
import { readFeatureFlows, type FlowOverlayRequest } from "./overlay.js";

/** One promise this feature's flows keep, with the flows that keep it. */
export interface FlowPromise {
  /** The capability the keeping view's `#cap-` tag resolved to. */
  capability: string;
  /** The `Requirement-ID` its `#req-` tag resolved to, inside that capability. */
  requirement: string;
  /** The view ids keeping it, deduplicated and sorted — message text, never identity. */
  flows: readonly string[];
}

/**
 * What the feature's flows keep, or one of the two honest refusals to say.
 *
 * THREE ARMS, because the two failures are not the same failure and a caller
 * that merged them would say the wrong thing. `unreadable` is loam unable to
 * READ the flows — a parse error, a hop naming an element the merge does not
 * land — and it earns `usecase.flow-invalid` and a refusal. `ungraded` is loam
 * able to read them and unable to RESOLVE their tags, because the capability
 * vocabulary this feature's merge would leave behind does not parse; the flows
 * are fine, the file they point into is not, and refusing over the flows would
 * name the wrong document.
 *
 * `read` with an empty `kept` is the ordinary answer and a real one: loam
 * looked, and no flow of this feature keeps a promise it adds.
 */
export type FlowPromises =
  | { kind: "read"; kept: readonly FlowPromise[] }
  | { kind: "ungraded"; why: string }
  | { kind: "unreadable"; errors: string[] };

/** Everything the join needs, on top of what the overlay already asks for. */
export interface FlowPromisesRequest extends FlowOverlayRequest {
  /**
   * The capability ids to resolve `#cap-` against — the LIVING vocabulary
   * widened with the ids this feature's own capability deltas introduce, which
   * is the same both-corpora rule `Realizes:` follows
   * (`core/capabilities/delta/overlay.ts`). `null` suspends the axis.
   */
  declared: readonly string[] | null;
  /**
   * The requirement ids per capability, widened the same way
   * (`withFeatureRequirements`). `undefined` for a capability with no document
   * at all is a different answer from an empty set, and both are real here.
   */
  requirementsOf: (capability: string) => ReadonlySet<string> | undefined;
}

/**
 * The promises this feature's own flows keep, read over the post-merge map.
 *
 * A feature with no flow is `read` with nothing kept, which is the ordinary
 * answer and costs one walk over a directory that is not there.
 */
export async function featureFlowPromises(req: FlowPromisesRequest): Promise<FlowPromises> {
  const scan = await readFeatureFlows(req);
  if (scan.kind === "unreadable") return { kind: "unreadable", errors: scan.errors };
  // The ladder, and it is `ungraded` rather than an empty answer. Once the
  // feature's own capability deltas are unioned in, `declared` is null for
  // exactly one reason — `architecture/capabilities.yaml` exists and does not
  // read as a vocabulary — so no `#cap-` tag can resolve and no claim can be
  // made either way. Returning "keeps nothing" here is what let
  // `capability.uncovered` convict a flow that does resolve, over a file the
  // feature gate reports nothing else about.
  if (req.declared === null) {
    return {
      kind: "ungraded",
      why: "architecture/capabilities.yaml does not read as a capability vocabulary (`loam validate --all` reports it as capability.invalid)",
    };
  }
  // A real, empty answer: loam read the flows and none of them claims anything.
  if (scan.views.length === 0) return { kind: "read", kept: [] };

  const byPromise = new Map<string, { promise: FlowPromise; flows: Set<string> }>();
  for (const view of scan.views) {
    const scope = resolveCapabilityTags(view.tags, req.declared).flatMap((claim) =>
      claim.kind === "resolved" ? [claim.id] : [],
    );
    for (const claim of resolveRequirementTags(view.tags, scope, req.requirementsOf)) {
      if (claim.kind !== "resolved") continue;
      // Keyed on the pair, never on a joined string: see the header. The Map is
      // only here to collapse two views keeping one promise into one row.
      const key = JSON.stringify([claim.capability, claim.id]);
      const found = byPromise.get(key);
      if (found === undefined) {
        byPromise.set(key, {
          promise: { capability: claim.capability, requirement: claim.id, flows: [] },
          flows: new Set([view.id]),
        });
      } else {
        found.flows.add(view.id);
      }
    }
  }
  // Sorted, and the view ids inside each row sorted too: nothing in loam has
  // measured that LikeC4 preserves view declaration order, so a message built
  // from it would reorder under a dependency bump.
  const kept = [...byPromise.values()]
    .map(({ promise, flows }) => ({ ...promise, flows: [...flows].sort(compareIds) }))
    .sort((a, b) => compareIds(a.capability, b.capability) || compareIds(a.requirement, b.requirement));
  return { kind: "read", kept };
}

/** Everything the coverage join needs, and nothing it would have to read twice. */
export interface FlowCoverageRequest {
  docsDir: DocsDir;
  featureDir: FeatureDir;
  featureId: string;
  /**
   * The feature's capability deltas, ALREADY PARSED by the caller's walk. They
   * arrive rather than being read because the one caller has just produced them,
   * and re-reading a document to answer a question about it is how two answers
   * about one file appear.
   */
  capabilities: readonly CapabilityDeltaDoc[];
  /** The LIVING capability vocabulary, read by the caller through its own index. */
  vocabulary: CapabilityVocabulary;
  /** The enumerated fleet, for `readFeatureFlows`' resolver and for its reason. */
  known: ReadonlySet<string>;
  /** The caller's memoised LikeC4 read; see `./overlay.ts`. */
  load?: (path: string) => Promise<LoadedDoc>;
  /**
   * The fleet's extending models for the merge preview, as a thunk the overlay
   * calls only when this feature really brings a flow; see `./overlay.ts` for
   * why the preview is wrong without them and why it arrives as a function.
   */
  models?: () => Promise<readonly ExtendingModel[]>;
}

/**
 * What this feature's own flows keep, resolved against the vocabulary and the
 * requirement ids its own merge would leave behind.
 *
 * THE WIDENING IS THE POINT, and it is `capabilities/delta/overlay.ts`'s
 * judgement applied to the other carrier: an analyst adds `NOTIFY-ONCE` to a
 * capability delta and an architect answers it with a flow in the same change,
 * so a `#req-` tag resolved against the LIVING tree alone names a promise that
 * does not exist yet — and the same archive that would land the flow lands the
 * promise it points at.
 *
 * `requirementsOf` KNOWS ONLY THE CAPABILITIES THIS FEATURE HAS A DELTA FOR, and
 * within those it carries living ∪ ADDED ∪ MODIFIED ids. The narrowing changes
 * no answer, for a reason stronger than "it is probably fine":
 * `uncoveredIssues` grades `r.kind === "ADDED"` and nothing else, and every
 * ADDED requirement it grades lives in one of these documents by construction —
 * so no id outside this map can reach a verdict. The LIVING half is in there
 * because a widening of the graded set must not silently need a second edit
 * here; today it decides nothing. A flow keeping a promise of a capability this
 * feature does NOT touch resolves to `undocumented` and counts for nothing,
 * which is correct: the fleet-scope `capability.requirement-unrealized` grades
 * that join over the whole corpus, and answering it here from a partial index is
 * how two surfaces start disagreeing.
 *
 * `declared` IS NOT NARROWED, and that asymmetry is load-bearing. It is what
 * `resolveCapabilityTags` compares a `#cap-` slug against, and a slug is not
 * injective — `payments/refunds` and `payments-refunds` flatten to one. Handing
 * it a short list would resolve a tag that is genuinely ambiguous fleet-wide and
 * attribute a whole flow to the wrong capability, silently. So the vocabulary is
 * the fleet's whole one, read once by the caller.
 */
export async function flowCoverage(req: FlowCoverageRequest): Promise<FlowPromises> {
  const vocab = withFeatureCapabilities(req.vocabulary, req.capabilities.map((doc) => doc.id));
  const byCapability = new Map<string, ReadonlySet<string>>();
  for (const doc of req.capabilities) {
    const ids = new Set<string>();
    // REMOVED is excluded on both sides — a promise on its way out keeps nothing.
    for (const r of doc.living) if (r.kind !== "REMOVED" && r.id !== undefined) ids.add(r.id);
    for (const r of doc.reqs) if ((r.kind === "ADDED" || r.kind === "MODIFIED") && r.id !== undefined) ids.add(r.id);
    byCapability.set(doc.id, ids);
  }
  return featureFlowPromises({
    docsDir: req.docsDir,
    featureDir: req.featureDir,
    featureId: req.featureId,
    known: req.known,
    declared: gradableCapabilityIds(vocab),
    requirementsOf: (capability) => byCapability.get(capability),
    ...(req.load === undefined ? {} : { load: req.load }),
    ...(req.models === undefined ? {} : { models: req.models }),
  });
}
