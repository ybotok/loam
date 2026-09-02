/**
 * The three grades one hop of a use case can earn: `usecase.step-unbacked`,
 * `usecase.step-contested` and `usecase.step-unlinked`.
 *
 * The attribution itself is `core/c4/resolve/steps.ts`'s `attributeStep` — which declared
 * relationship backs a hop, oriented on `isBackward` and decided by the
 * DISTINCT-op count — and none of that reasoning is repeated here. This module
 * owns three things: which verdict earns which code, the three guards that keep
 * the warn honest, and the sentences.
 *
 * WHY `step-unbacked` IS THE CHECK THAT EARNS THE FEATURE. A hop between two
 * elements that both exist, with no relationship between them anywhere in the
 * model, is ZERO LikeC4 errors: a `dynamic view` is allowed to show a call the
 * model never declared, so the diagram renders, the project parses, and every
 * other check in loam stays green. The flow reads as fine in every tool the
 * fleet has. If loam does not convict it, nothing does — which is why it is an
 * error rather than an advisory.
 *
 * ONE BREACH, ONE FINDING, and here that is structural rather than remembered.
 * `contested` and `attributed` are disjoint verdicts, so deriving
 * `step-unlinked` from the `attributed` arm — never from the candidate
 * relationships — is what makes a contested step report once. A grader that
 * walked `rels` looking for a missing `op` would convict the same hop twice:
 * once for the disagreement, and once for whichever candidate happened to carry
 * no operation at all.
 */
import { attributeStep, type StepAttribution, type StepScope } from "../../../../core/c4/resolve/steps.js";
import type { Elem, Rel } from "../../../../core/c4/likec4.js";
import type { ParsedStep, ParsedView } from "../../../../core/c4/parsed/dynamic-views.js";
import { ACTOR_KINDS } from "../../../../core/vocabulary/maturity.js";
import type { Finding } from "../../../../core/vocabulary/report.js";
import { stepPlace } from "../../../../core/usecases/place.js";
import { viewPlace } from "./place.js";

/** One hop being graded and the view it belongs to — never passed apart. */
export interface GradedStep {
  view: ParsedView;
  step: ParsedStep;
}

/**
 * What a hop is graded against, built ONCE per run.
 *
 * `services` and `model.known` are the same set by construction (`./usecases.ts`
 * builds both from one value), which is what stops "which service is this
 * element" being answered one way by the attribution and another by the provider
 * guard below. `resolve` is injected for the same reason `fleetShapeFindings`
 * takes it: the fleet target already holds the shared element→service resolver,
 * and a second one built here could not disagree today but would be a second
 * place to change.
 */
export interface StepGrading {
  model: StepScope;
  /** The `services/<id>/` directories that exist. */
  services: ReadonlySet<string>;
  /** The shared element→service resolver every other edge join uses. */
  resolve: (id: string) => string;
}

type Unbacked = Extract<StepAttribution, { verdict: "unbacked" }>;
type Contested = Extract<StepAttribution, { verdict: "contested" }>;
type Attributed = Extract<StepAttribution, { verdict: "attributed" }>;

/** `…checkout.likec4 — dynamic view 'uc_checkout' step 2 'authorizes the payment'`. */
function placeOf(hop: GradedStep): string {
  return `${viewPlace(hop.view)} ${stepPlace(hop.step)}`;
}

/**
 * A hop nothing in the model backs.
 *
 * Two fixes, because there are genuinely two mistakes that land here and the
 * author is the only one who can say which they made: the edge really is
 * missing, or the hop is a reply written the long way round. The second is
 * offered as the OTHER spelling of what they already typed — suggesting the
 * spelling they used would be a hint that restates the defect — and the sentence
 * says which pair that spelling looks the hop up under, because `<-` attributes
 * a reply to the CALL it answers rather than to the direction the message
 * travels (`callPair` in core/c4/resolve/steps.ts holds the measurement).
 */
function unbackedFinding(hop: GradedStep, attribution: Unbacked): Finding {
  const other = hop.step.isBackward
    ? { spelling: `${hop.step.source} -> ${hop.step.target}`, when: "is not a return step" }
    : { spelling: `${hop.step.target} <- ${hop.step.source}`, when: "is a return step" };
  return {
    severity: "error",
    code: "usecase.step-unbacked",
    subject: hop.view.id,
    message:
      `${placeOf(hop)}: nothing in the model declares ${attribution.from} -> ${attribution.to}, so this hop is ` +
      "backed by no relationship — and LikeC4 reports no error for it, so the view still renders and the " +
      "project still parses. Draw the edge in `model { }` (with `metadata { op '<operationId>' }` where it is " +
      `a call), or, if this hop ${other.when}, write it as \`${other.spelling}\` — a reply is attributed to the ` +
      `call it answers, so that spelling looks the hop up under ${attribution.to} -> ${attribution.from} instead.`,
  };
}

/** `web -> orders.api "Calls createOrder" (op: createOrder)`, or `(no op)` where the edge declares none. */
function candidateLine(rel: Rel): string {
  const op = rel.op === undefined ? "no op" : `op: ${rel.op}`;
  return `${rel.source} -> ${rel.target} "${rel.title ?? ""}" (${op})`;
}

/**
 * A hop whose candidates disagree about the operation.
 *
 * WARN, not error, because the model is complete — every candidate is a
 * relationship somebody drew on purpose — and the honest answer is sometimes
 * "two paths, one flow". What loam refuses to do is pick: a guessed operation is
 * indistinguishable from a right one in every rollup built over the use case,
 * and it stays wrong invisibly.
 *
 * `details` carries every candidate rather than the distinct ops, because the
 * repair is made on a RELATIONSHIP: the author has to find the edge that names
 * the wrong operation, and a list of operation names does not say which edge
 * that is. An absent `metadata { op }` prints as `no op` and is a candidate like
 * any other — it is exactly as much of a disagreement as a second name.
 */
function contestedFinding(hop: GradedStep, attribution: Contested): Finding {
  return {
    severity: "warn",
    code: "usecase.step-contested",
    subject: hop.view.id,
    message:
      `${placeOf(hop)}: ${attribution.rels.length} relationships back ${attribution.from} -> ` +
      `${attribution.to} and they name ${attribution.ops.length} different operations, so nothing can say ` +
      "which one this hop exercises. loam names the candidates instead of picking one — a guessed operation " +
      "reads exactly like a right one in every rollup built over this flow. Give the candidates one operation, " +
      "or draw the hop between the elements that name exactly one.",
    details: attribution.rels.map(candidateLine),
  };
}

/**
 * The service this hop calls, when the hop is a `step-unlinked` candidate at
 * all — `null` when any of the three guards refuses. ALL THREE are mechanical,
 * and each closes a whole class of warnings that would otherwise be simply
 * wrong. The count is stated because a reader auditing this function is meant to
 * find three bullets and three `return null`s below and conclude that none of
 * them is surplus: the one a miscount invites deleting is the last, and deleting
 * it puts the warning back on the first hop of almost every flow.
 *
 *  - A `publishes` or `consumes` on ANY candidate means the hop does reach a
 *    declared API — an AsyncAPI one. The event spine already grades it
 *    (`spine.message-undefined` and its family), and asking for an `op` as well
 *    would be loam demanding an HTTP operationId for a Kafka message. Read
 *    across every candidate rather than the first, because on the service tier
 *    the candidates are one call drawn as containers.
 *  - The target must resolve to a real `services/<id>/`. Without it every hop
 *    into an `#external` system, an actor, a database, a cache or a queue warns
 *    — none of which owns an `openapi.yaml`, so none of them CAN carry the
 *    operationId the message would be asking for. Through the shared resolver,
 *    so "the provider" here and "the provider" in the spine check cannot
 *    disagree about which element stands for which directory.
 *  - The CALLER must not be an actor. A person is not a caller: `customer ->
 *    checkoutWeb 'opens the basket'` is somebody using the app, and the app owes
 *    no operationId for a click. The guard above does not cover this, because it
 *    reads the TARGET — and the target here is one of ours, so without this the
 *    warning fired on the FIRST HOP OF ALMOST EVERY FLOW, which is where a
 *    sequence diagram puts its actor. Measured on the published example fleet
 *    before it was added. This is the same exemption `fleet/census.ts`,
 *    `arch-coverage.ts`, `core/gate/partners.ts` and `core/verify/checklist.ts`
 *    each already apply, through the same `ACTOR_KINDS` — a person was never a
 *    participant in any of loam's other censuses either.
 *
 * The op test reads the ATTRIBUTION rather than the relationships: an
 * `attributed` verdict with no `op` means every candidate agreed the hop names
 * no operation, which is the state this warn is about. Candidates that disagree
 * never reach here at all — that is the suppression, and it is why it cannot be
 * forgotten.
 */
function unlinkedProvider(attribution: Attributed, grading: StepGrading): string | null {
  if (attribution.op !== undefined) return null;
  if (attribution.rels.some((rel) => rel.publishes !== undefined || rel.consumes !== undefined)) return null;
  if (isActor(attribution.from, grading.model.elements)) return null;
  const provider = grading.resolve(attribution.to);
  return grading.services.has(provider) ? provider : null;
}

/**
 * Is this endpoint a person rather than a system?
 *
 * Exact id, not the ancestor walk the service resolver does: an actor is a
 * top-level element in every landscape loam has seen, and a nested one would be
 * a person inside a system, which is not a shape the model has. An endpoint that
 * names no element cannot occur — a step naming one is a LikeC4 reference error,
 * so the document never reaches a check.
 */
function isActor(id: string, elements: Elem[]): boolean {
  const element = elements.find((candidate) => candidate.id === id);
  return element !== undefined && ACTOR_KINDS.has(element.kind.toLowerCase());
}

/**
 * A hop backed by the model and joined to no contract.
 *
 * The mirror of `spine.op-link-missing` at flow altitude: the use case reaches
 * the fleet map and stops there, so nothing can say which operation of the
 * provider's contract the step exercises — and the whole point of grading a use
 * case is that the flow joins through to the API it drives.
 */
function unlinkedFinding(hop: GradedStep, attribution: Attributed, provider: string): Finding {
  const backing =
    attribution.rels.length === 1 ? "one relationship" : `${attribution.rels.length} relationships`;
  return {
    severity: "warn",
    code: "usecase.step-unlinked",
    subject: hop.view.id,
    message:
      `${placeOf(hop)}: ${attribution.from} -> ${attribution.to} is backed by ${backing} carrying no ` +
      "`metadata { op }` and no `publishes`/`consumes`, so this hop names no operation of " +
      `${provider}'s contract — the use case reaches the fleet map and stops there. Add ` +
      "`metadata { op '<operationId>' }` to the edge in `model { }`, or `metadata { publishes '<message>' }` / " +
      "`consumes` where the hop is an event.",
  };
}

/**
 * The findings one hop earns — at most one, whatever is wrong with it.
 *
 * A `switch` over the closed verdict union with every arm returning, so a fourth
 * verdict added upstream is a compile error here rather than a hop that silently
 * stops being graded.
 */
export function stepFindings(hop: GradedStep, grading: StepGrading): Finding[] {
  const attribution = attributeStep(hop.step, grading.model);
  switch (attribution.verdict) {
    case "unbacked":
      return [unbackedFinding(hop, attribution)];
    case "contested":
      return [contestedFinding(hop, attribution)];
    case "attributed": {
      const provider = unlinkedProvider(attribution, grading);
      return provider === null ? [] : [unlinkedFinding(hop, attribution, provider)];
    }
  }
}
