/**
 * The architecture spec axis — the grammar and resolution of `Covers:` — and
 * the same endpoint join, reused, for the steps of a use case.
 *
 * A business spec will never mention the transactional outbox; that is
 * architecture, and it lives in `arch.spec.md` — same requirement/scenario
 * grammar as spec.md, same delta algebra, same merge. What is new is the
 * `Covers:` line: where a business requirement declares the OPERATIONS it
 * governs, an architecture requirement declares the MODEL OBJECTS its
 * scenarios exercise, so coverage can be derived mechanically instead of
 * trusted to an author who was never going to write the outbox down.
 *
 * Three entry forms, resolved against the documents loam already reads:
 *
 *   paymentService.db               a C4 element id — resolved against the
 *                                   in-scope elements the way every check joins
 *                                   them: the id itself, or the service the
 *                                   element stands for (binding, then title);
 *   paymentService -> kafka         an edge — each side resolved the same way,
 *                                   against the declared relationships;
 *   alert:<id> / sli:<id>           a health signal — ids `health.yaml`
 *                                   declares (core/vocabulary/health.ts).
 *
 * Resolution never reads code. An entry that resolves to nothing is the typo
 * guard (`covers.unknown`, warn); the emitters live with the other validate
 * checks, this module owns only the grammar and the matching.
 *
 * `attributeStep` at the foot of the file answers the same shape of question for
 * a different axis. A `dynamic view`'s hop says "web talks to orders"; which
 * declared relationship backs that hop, and what that relationship says the
 * operation is, is the join `coversEdge` already performs — same two tiers, same
 * cached `serviceResolver`, same "an endpoint names an element or the service it
 * stands for" rule. It lives here rather than beside the view reader in
 * `parsed/` because a second copy of that join is the copy that drifts, and
 * because `parsed/dynamic-views.ts` may read `$data` and nothing else
 * (docs/DESIGN.md rule 26) — it has no business holding the model join.
 */
import { type Elem, type Rel } from "./likec4.js";
import { elementService, serviceResolver } from "./resolve/service.js";
import type { ParsedStep } from "./parsed/dynamic-views.js";
import type { HealthIds } from "../vocabulary/health.js";

export type CoversEntry =
  | { form: "element"; id: string; raw: string }
  | { form: "edge"; source: string; target: string; raw: string }
  | { form: "alert" | "sli"; id: string; raw: string };

/** Parse one comma-separated `Covers:` entry into its form. Never fails: an
 * unclassifiable string is an element entry that will not resolve, and the
 * covers.unknown message is a better diagnosis than a parse refusal. */
export function parseCoversEntry(raw: string): CoversEntry {
  const alert = /^alert:\s*(.+)$/.exec(raw);
  if (alert) return { form: "alert", id: alert[1]!.trim(), raw };
  const sli = /^sli:\s*(.+)$/.exec(raw);
  if (sli) return { form: "sli", id: sli[1]!.trim(), raw };
  const edge = /^(.+?)\s*->\s*(.+)$/.exec(raw);
  if (edge) return { form: "edge", source: edge[1]!.trim(), target: edge[2]!.trim(), raw };
  return { form: "element", id: raw, raw };
}

/**
 * What `Covers:` entries resolve against: every element and relationship in
 * view (a service's own model plus the landscape; for a feature, the delta
 * plus both), and the health ids of the service whose spec is being read.
 */
export interface CoverageScope {
  elements: Elem[];
  relationships: Rel[];
  health: HealthIds;
  /**
   * The enumerated fleet (plus the feature's own `specs/` names, where the
   * caller has them). The Covers matcher resolves edge ENDPOINTS with it, and
   * it must be the SAME set the caller's own findings resolve with: the finding
   * says "write `Covers: checkout-web -> payment-service`" with the fleet in
   * hand, and a matcher resolving without it answered that exact line with
   * `covers.unknown` whenever the edge landed on a modelled container.
   */
  known?: ReadonlySet<string>;
}

/** Does an element entry name this element? Its id, or the service it stands for. */
function namesElement(name: string, e: Elem): boolean {
  return e.id === name || elementService(e) === name;
}

/**
 * One `id -> service` resolver per document, not one per lookup.
 *
 * `serviceOf` builds a fresh id map on every call, and this axis calls it twice
 * for every relationship in scope — inside loops that already run over every
 * relationship a service can see. `serviceResolver`'s own doc says it is "built
 * once per document and shared"; this is where the Covers axis keeps that
 * promise, since `coversEdge` is exported and its callers hold only the element
 * array.
 *
 * A module-level cache is normally the wrong shape here, because a command runs
 * against whatever directory it was invoked in. This one is safe: the key is the
 * per-invocation `Elem[]` a parse produced, its value is a pure function of that
 * key alone, and nothing in it is derived from the working directory — so two
 * runs can never see each other's answer, and the entry dies with the document.
 * Nothing mutates an `Elem[]` after parse.
 *
 * Two tiers because the fleet set is part of the answer: the same document
 * resolves differently with and without `known`, so a cache keyed on the
 * elements alone handed a with-fleet caller the without-fleet resolver.
 * Callers build ONE set per run and pass the same instance through, which is
 * what lets the inner WeakMap key on the set's identity.
 */
const RESOLVERS = new WeakMap<Elem[], (id: string) => string>();
const FLEET_RESOLVERS = new WeakMap<Elem[], WeakMap<ReadonlySet<string>, (id: string) => string>>();

function resolverFor(elements: Elem[], known?: ReadonlySet<string>): (id: string) => string {
  if (known === undefined) {
    const cached = RESOLVERS.get(elements);
    if (cached !== undefined) return cached;
    const resolver = serviceResolver(elements);
    RESOLVERS.set(elements, resolver);
    return resolver;
  }
  let perSet = FLEET_RESOLVERS.get(elements);
  if (perSet === undefined) {
    perSet = new WeakMap();
    FLEET_RESOLVERS.set(elements, perSet);
  }
  const cached = perSet.get(known);
  if (cached !== undefined) return cached;
  const resolver = serviceResolver(elements, known);
  perSet.set(known, resolver);
  return resolver;
}

/** Does an edge entry's side name this relationship endpoint? */
function namesEndpoint(
  name: string,
  endpointId: string,
  elements: Elem[],
  known?: ReadonlySet<string>,
): boolean {
  return endpointId === name || resolverFor(elements, known)(endpointId) === name;
}

/** Does a Covers entry match this element? (Only element entries can.) */
export function coversElement(entry: CoversEntry, e: Elem): boolean {
  return entry.form === "element" && namesElement(entry.id, e);
}

/** Does a Covers entry match this relationship? Endpoints resolved within `elements`, through `known` where the caller has the fleet. */
export function coversEdge(entry: CoversEntry, r: Rel, elements: Elem[], known?: ReadonlySet<string>): boolean {
  return (
    entry.form === "edge" &&
    namesEndpoint(entry.source, r.source, elements, known) &&
    namesEndpoint(entry.target, r.target, elements, known)
  );
}

/** Does the entry resolve to ANYTHING in scope? False is `covers.unknown`. */
export function entryResolves(entry: CoversEntry, scope: CoverageScope): boolean {
  switch (entry.form) {
    case "alert":
      return scope.health.alerts.includes(entry.id);
    case "sli":
      return scope.health.slis.includes(entry.id);
    case "edge":
      return scope.relationships.some((r) => coversEdge(entry, r, scope.elements, scope.known));
    case "element":
      return scope.elements.some((e) => coversElement(entry, e));
  }
}

/** Ids a covers.unknown hint may offer for a mistyped entry — always real ones. */
export function coversCandidates(entry: CoversEntry, scope: CoverageScope): string[] {
  switch (entry.form) {
    case "alert":
      return closeIds(entry.id, scope.health.alerts).map((id) => `alert:${id}`);
    case "sli":
      return closeIds(entry.id, scope.health.slis).map((id) => `sli:${id}`);
    case "edge":
      // Cheap on purpose: no pairwise edge fuzzing — the sides are element
      // names, so the element hint is the useful one.
      return [];
    case "element":
      return closeIds(entry.id, [...new Set(scope.elements.map((e) => e.id))]);
  }
}

/**
 * Existing ids near a misspelling — substring containment either way, else a
 * shared 3-character prefix. Deliberately dumb: no fuzzy library for one hint,
 * and every id offered is real, so the hint can never point at the typo itself.
 * (Moved here from validate.ts once `covers.unknown` became its second user.)
 */
export function closeIds(typo: string, ids: string[]): string[] {
  const t = typo.toLowerCase();
  return ids
    .filter((id) => {
      const i = id.toLowerCase();
      return i.includes(t) || t.includes(i) || (t.length >= 3 && i.startsWith(t.slice(0, 3)));
    })
    .slice(0, 5);
}

/**
 * The three fields an attribution reads off a step, and no more.
 *
 * Narrower than `ParsedStep` on purpose. Attribution must not depend on the
 * ordinal, the title or the notes — a hop is graded by where it points, never by
 * what the author called it — and a signature that says so is also a signature a
 * test can satisfy with a literal instead of a parsed document. Derived from
 * `ParsedStep` rather than restated, so a rename upstream is a compile error
 * here instead of a second definition that quietly disagrees.
 */
export type StepEndpoints = Pick<ParsedStep, "source" | "target" | "isBackward">;

/**
 * What a step is attributed against: the model in view, plus the enumerated
 * fleet where the caller has it.
 *
 * A deliberate subset of `CoverageScope` rather than a reuse of it — an
 * attribution never reads `health`, and demanding one would make every caller
 * fabricate an empty `HealthIds` to ask a question that has nothing to do with
 * alerts. A `CoverageScope` is still structurally assignable here, so a caller
 * already holding the fuller scope passes it through unchanged.
 */
export interface StepScope {
  elements: Elem[];
  relationships: Rel[];
  /** As `CoverageScope.known`, for the same reason: one set per run, shared. */
  known?: ReadonlySet<string>;
}

/** The oriented pair a verdict is about — see `callPair` for which way round. */
interface CallPair {
  from: string;
  to: string;
}

/**
 * What the model says about one hop of a use case.
 *
 * Three variants rather than one record with optional fields, because the fields
 * are not independent: `op` is meaningful only when exactly one operation was
 * implied, `ops` only when more than one was, and an unbacked step has neither
 * and no tier either. Tagged, those states stop being constructible.
 *
 *  - `attributed` — the candidates on the matched tier agree, so the hop
 *    exercises exactly one operation. `op` is absent when that one agreed
 *    operation is *no* operation: the relationships back the hop but none of
 *    them carries `metadata { op '…' }`.
 *  - `contested` — the candidates disagree, so loam cannot say which operation
 *    the hop exercises. `ops` lists the distinct values in candidate order,
 *    `undefined` standing for the candidate that declared none.
 *  - `unbacked` — nothing in the model backs the hop on either tier. The pair is
 *    still carried, because a message about it has to be able to name the edge
 *    the author would have to draw.
 *
 * `rels` carries every candidate on the matched tier, not just the first: an
 * `attributed` verdict over two relationships is the normal shape once a service
 * is drawn as containers, and a caller pinning evidence needs all of them.
 */
export type StepAttribution =
  | (CallPair & { verdict: "attributed"; tier: 1 | 2; rels: readonly Rel[]; op?: string })
  | (CallPair & { verdict: "contested"; tier: 1 | 2; rels: readonly Rel[]; ops: readonly (string | undefined)[] })
  | (CallPair & { verdict: "unbacked" });

/**
 * The pair a step's backing relationship is looked up under. This is the half
 * that mis-grades the whole fleet if it is wrong, because a reply arrow is the
 * commonest step in any sequence diagram.
 *
 * MEASURED at the `likec4@1.59.2` pin, and `test/likec4-view-shape.test.ts` holds
 * the raw form: a reply written `a <- b 'reply'` parses as
 * `{source: "b", target: "a", isBackward: true}` — LikeC4 has ALREADY reversed
 * the endpoints and set the flag — while the forward `b -> a` yields that same
 * pair with no `isBackward` key at all (ABSENT, not false). So the endpoints as
 * parsed describe the direction the MESSAGE travels, and the flag records which
 * arrow the author typed.
 *
 * loam attributes a reply to the CALL it answers, so the reversal is undone
 * here. A landscape declares `web -> orders` because that edge is the
 * dependency; a mirror `orders -> web` for each response is not something a
 * fleet writes down. Reading a reply hop under the message's own direction would
 * report every return hop against such a landscape as `unbacked`, and where a
 * fleet does draw the mirror edge it would file the two halves of one call under
 * two operations — the call under `op 'createOrder'`, its reply under none.
 *
 * That is deliberately NOT what LikeC4's own computed stage does, and the
 * difference is measured rather than assumed: that stage resolves a backward
 * step's `relations` from the UNFLIPPED pair, so at this pin a `web <- orders`
 * step computes to `relations: []` when only `web -> orders` exists, and to the
 * mirror edge when only `orders -> web` does. It is answering which arrow to
 * draw; loam is answering which operation the hop exercises, and reads what a
 * view DECLARES rather than what it shows — which is why loam never reaches that
 * stage at all (docs/DESIGN.md rule 26, enforced by `scripts/arch-check.mjs`).
 * The consequence to know before changing this: where
 * a fleet declares BOTH directions, the mirror edge is not what backs the reply
 * here — the call is, and the mirror edge backs only a hop drawn forward along
 * it.
 */
function callPair(step: StepEndpoints): CallPair {
  return step.isBackward ? { from: step.target, to: step.source } : { from: step.source, to: step.target };
}

/**
 * The distinct `op` values across candidates, first-seen order preserved.
 *
 * Absent is a VALUE here, not a gap to skip: a relationship carrying no `op` and
 * one carrying `createOrder` disagree about the operation just as surely as two
 * different ops do, and skipping the absent one would silently promote that
 * disagreement to a confident answer. `includes` rather than a `Set` because a
 * candidate list is the handful of relationships between one pair of endpoints,
 * and it keeps `undefined` comparing the way the rest of this file expects.
 */
function distinctOps(rels: readonly Rel[]): (string | undefined)[] {
  const out: (string | undefined)[] = [];
  for (const r of rels) if (!out.includes(r.op)) out.push(r.op);
  return out;
}

/**
 * The verdict one tier's candidates imply, or `undefined` when that tier found
 * nothing and is therefore not the tier that answers.
 *
 * The count that decides is the DISTINCT-OP count, never the candidate count.
 * That distinction is what makes the service tier safe: once a service is drawn
 * as containers, `a.api -> b` and `a.worker -> b` both carrying
 * `op 'createOrder'` are two relationships and one operation, and a verdict read
 * off `rels.length` would convict a perfectly consistent model of contesting
 * itself.
 */
function verdictOn(pair: CallPair, tier: 1 | 2, rels: readonly Rel[]): StepAttribution | undefined {
  if (rels.length === 0) return undefined;
  const ops = distinctOps(rels);
  if (ops.length > 1) return { ...pair, verdict: "contested", tier, rels, ops };
  // Length is exactly one here, so the single distinct value is the answer —
  // and `undefined` is a legitimate answer: every candidate agreed that this
  // hop names no operation.
  const [only] = ops;
  return { ...pair, verdict: "attributed", tier, rels, ...(only === undefined ? {} : { op: only }) };
}

/**
 * Relationships whose ENDPOINTS resolve to the same two services as the pair —
 * the fallback tier, and the reason a step drawn between two services matches an
 * edge drawn between two containers.
 *
 * Through the module's cached `resolverFor`, not a fresh `serviceResolver`: this
 * runs once per step of every use case in the fleet, and building the id map per
 * step is the cost that comment above `RESOLVERS` exists to prevent.
 */
function resolvedTier(pair: CallPair, scope: StepScope): Rel[] {
  const resolve = resolverFor(scope.elements, scope.known);
  const from = resolve(pair.from);
  const to = resolve(pair.to);
  return scope.relationships.filter((r) => resolve(r.source) === from && resolve(r.target) === to);
}

/**
 * Which relationship in the model backs one hop of a use case, and what it says
 * the operation is.
 *
 * Two tiers, and the second runs ONLY when the first is empty. That ordering is
 * load-bearing rather than an optimisation: the service tier necessarily
 * re-finds every exact match — an endpoint that matches literally resolves to
 * the same service trivially — so running it unconditionally would let a
 * container-level edge with a different `op` contest a step the model already
 * answers exactly, turning an `attributed` verdict into a `contested` one on a
 * document nobody changed.
 *
 * Relationship `kind` is deliberately not part of the match, and that is
 * measured too: at this pin `a -[http]-> b` without a `relationship http` in the
 * `specification` block is "Could not resolve reference to RelationshipKind
 * named 'http'" — a parse error, which under loam's standing rule means no model
 * at all — and `test/helpers/harness.ts`'s own `LANDSCAPE` declares no
 * relationship kinds. So narrowing by kind would mean a fix message asking an
 * author to write a line their document does not parse.
 */
export function attributeStep(step: StepEndpoints, scope: StepScope): StepAttribution {
  const pair = callPair(step);
  const exact = scope.relationships.filter((r) => r.source === pair.from && r.target === pair.to);
  const declared = verdictOn(pair, 1, exact);
  if (declared !== undefined) return declared;
  return verdictOn(pair, 2, resolvedTier(pair, scope)) ?? { ...pair, verdict: "unbacked" };
}
