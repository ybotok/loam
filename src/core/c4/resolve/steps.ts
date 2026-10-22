/**
 * Which declared relationship backs one hop of a use case, and what it says the
 * operation is.
 *
 * A `dynamic view`'s hop says "web talks to orders". Answering it is the same
 * shape of join `Covers:` performs for an edge entry one module over — same two
 * tiers, same cached `serviceResolver` (`./service.ts`'s `resolverFor`, which
 * both axes share), same "an endpoint names an element or the service it stands
 * for" rule.
 *
 * It lived in `../arch.ts` while that file was the only home the join had, and
 * moved here when the Covers grammar grew a fourth entry form and the file
 * reached its line limit. The move changed nothing: the seam was already named
 * in that file's own header, and this is the package the resolution it depends
 * on lives in.
 *
 * It does NOT live beside the view reader in `../parsed/dynamic-views.ts`, and
 * that is a rule rather than a preference: a second copy of this join is the
 * copy that drifts, and that module may read `$data` and nothing else
 * (docs/DESIGN.md rule 26) — it has no business holding the model join.
 */
import { type Elem, type Rel } from "../likec4.js";
import { resolverFor } from "./service.js";
import type { ParsedStep } from "../parsed/dynamic-views.js";

/**
 * The fields an attribution reads off a step, and no more: the endpoints, and
 * the title that may choose between the candidates the endpoints found.
 *
 * Narrower than `ParsedStep` on purpose. Attribution must not depend on the
 * ordinal or the notes, and the title never decides WHETHER a hop is backed —
 * a hop is backed by where it points, never by what the author called it. The
 * title has exactly one job, `pickedByTitle`'s: when the relationships the
 * endpoints found disagree about the operation, a title that opens with one
 * candidate's own declared name narrows them to the ones this hop means. A
 * signature that says so is also a signature a test can satisfy with a literal
 * instead of a parsed document. Derived from `ParsedStep` rather than restated,
 * so a rename upstream is a compile error here instead of a second definition
 * that quietly disagrees.
 *
 * `title` is optional because an untitled step is legal, and that makes it the
 * one field a hand-built literal can leave out and still compile — silently
 * losing the pick. Both callers pass a `ParsedStep`, which carries it.
 */
export type StepReading = Pick<ParsedStep, "source" | "target" | "isBackward" | "title">;

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
 *    exercises exactly one operation, or they disagree and the step's title
 *    picked the ones it means (`pickedByTitle`), in which case `rels` holds the
 *    picked candidates only. `op` is absent when that one operation is *no*
 *    operation: the relationships back the hop but none of them carries
 *    `metadata { op '…' }`.
 *  - `contested` — the candidates disagree and the title picks none of them, so
 *    loam cannot say which operation the hop exercises. `ops` lists the distinct
 *    values in candidate order, `undefined` standing for the candidate that
 *    declared none.
 *  - `unbacked` — nothing in the model backs the hop on either tier. The pair is
 *    still carried, because a message about it has to be able to name the edge
 *    the author would have to draw.
 *
 * `rels` carries every candidate on the matched tier, not just the first: an
 * `attributed` verdict over two relationships is the normal shape once a service
 * is drawn as containers, and a caller pinning evidence needs all of them. The
 * one exception is an `attributed` verdict the title picked, whose `rels` holds
 * the picked candidates only: the others are what the author said the hop is
 * NOT, and a rollup over `rels` — a message census, the removal victims in
 * `core/usecases/operations.ts` — must not count them as exercised.
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
function callPair(step: StepReading): CallPair {
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
 * What a relationship can be picked by: the identifiers it DECLARES — its
 * `metadata { op }`, and the message it `publishes` or `consumes` — and never
 * its title, which is prose. An empty value names nothing: `op ''` parses, and
 * every title starts with the empty string.
 */
function declaredNames(rel: Rel): string[] {
  return [rel.op, rel.publishes, rel.consumes].filter((name): name is string => name !== undefined && name !== "");
}

/**
 * The characters an operation id or a message name is spelled with. A name
 * spelled with these alone ends where the next character is not one of them,
 * so of two such names where one prefixes the other (`order.placed` and
 * `order.placed.v2`, `createOrder` and `createOrder-batch`) one title never
 * picks both. A name spelled with anything else (`orders/create`) still
 * matches, and where it shares a prefix with another candidate's (`orders`) a
 * title opening with the longer one picks both and the hop stays contested —
 * which fails closed rather than guessing.
 */
const NAME_CHARACTER = /[A-Za-z0-9_.-]/;

/** A letter or a digit in any script — what a word of prose starts with. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Does `title` open with `name`, set off as a name rather than as the first
 * word of a sentence?
 *
 * Two conditions after the name. The next character must not continue it, so
 * `createOrderBatch` is not `createOrder`. And the title must end there, or go
 * on with punctuation — `:`, `(`, `,`, a dash — before any further word:
 * `'createOrder — places the order'`, `'getOrder(orderId)'` and a bare
 * `'refundPayment'` name an operation, while `'get the customer's orders'`
 * does not name `get`. The second condition is what keeps a fleet whose
 * operationIds are plain verbs from having its existing prose titles read as
 * picks on the day it upgrades: the first word of a sentence is not an author
 * naming an operation.
 */
function opensWith(title: string, name: string): boolean {
  if (!title.startsWith(name)) return false;
  const rest = title.slice(name.length);
  if (rest === "") return true;
  if (NAME_CHARACTER.test(rest.charAt(0))) return false;
  return !WORD_CHARACTER.test(rest.trimStart().charAt(0));
}

/**
 * The candidates a step's title picks: those that declare the name the title
 * opens with (`opensWith`). `[]` when the step has no title or its title opens
 * with no candidate's name.
 *
 * This is how an author says which relationship a hop means when the map joins
 * the pair by several — `orders -> payments 'authorizePayment — authorizes the
 * payment'` against an `authorizePayment` edge and a `refundPayment` one. It
 * exists because every other way to say it is closed, and each was MEASURED at
 * the 1.59.2 pin before this was chosen:
 *
 *  - `metadata { op }` on a step is a parse error (the step accepts title,
 *    `technology`, `description`, `notes`, `navigateTo` and the styling
 *    properties, and no metadata block), and so are tags on a step;
 *  - a step's KIND exists only as the arrow `-[kind]->`, which needs a
 *    `relationship <kind>` in the specification and names a TRANSPORT — the
 *    reserve, read and release calls one caller makes to one provider are one
 *    kind, so a kind cannot tell them apart;
 *  - the repair the warning used to offer alone, drawing the hop between the
 *    elements that carry exactly one candidate, is closed on a fleet flow
 *    wherever those elements are containers an extending model declares: a
 *    hop naming one does not resolve in the `architecture/` project at all
 *    (SCHEMA.md, "What loam grades is still the `architecture/` project
 *    alone"), so between two services drawn as single elements on the map
 *    there was no repair short of changing the map.
 *
 * The title is what is left, and it is the native place: a sequence diagram
 * labels a message with the operation it invokes. The rule is deliberately
 * narrow, because a guessed operation reads exactly like a right one in every
 * rollup built over a flow:
 *
 *  - the title must START with the name, set off from any prose after it by
 *    punctuation — a candidate's name later in the sentence ("reads the order
 *    before release") or as its first word ("read the order") picks nothing,
 *    since a word in a sentence is not an author naming an operation;
 *  - it must be a candidate's DECLARED identifier, matched exactly, case
 *    included — an operationId is case-sensitive, and a relationship's title is
 *    prose nobody wrote to be matched;
 *  - it only ever chooses AMONG the candidates the endpoints found, and only
 *    when they disagree: a title can never back an unbacked hop, move a hop to
 *    another tier, or overrule candidates that already agree.
 */
function pickedByTitle(rels: readonly Rel[], title: string | undefined): Rel[] {
  if (title === undefined) return [];
  return rels.filter((rel) => declaredNames(rel).some((name) => opensWith(title, name)));
}

/**
 * A title that WOULD settle a disagreement among `rels` — the step's own
 * `title` behind one candidate's declared name — or `undefined` when no single
 * name does.
 *
 * For the `usecase.step-contested` message, whose example is only worth giving
 * if pasting it clears the warning. So it is tried through `pickedByTitle`
 * itself rather than read off a candidate: a name two disagreeing candidates
 * share, or one the title already opens with to no effect, is skipped instead
 * of offered. Operation ids are tried before message names, because the
 * warning is about operations and the hop is more often a call.
 */
export function pickingTitle(rels: readonly Rel[], title: string | undefined): string | undefined {
  const names = [...rels.map((rel) => rel.op), ...rels.flatMap((rel) => [rel.publishes, rel.consumes])];
  for (const name of names) {
    if (name === undefined || name === "") continue;
    const spelled = title === undefined ? name : `${name} — ${title}`;
    if (distinctOps(pickedByTitle(rels, spelled)).length === 1) return spelled;
  }
  return undefined;
}

/** The `attributed` verdict over candidates already known to agree on `op`. */
function attributed(pair: CallPair, tier: 1 | 2, rels: readonly Rel[], op: string | undefined): StepAttribution {
  return { ...pair, verdict: "attributed", tier, rels, ...(op === undefined ? {} : { op }) };
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
 * itself. The same count decides the title's pick: a title that picks two
 * candidates still disagreeing — one name declared as one edge's `op` and
 * another's `publishes` — has said nothing that settles the hop, and the
 * verdict stays `contested` over every candidate rather than over the two.
 */
function verdictOn(
  pair: CallPair,
  tier: 1 | 2,
  rels: readonly Rel[],
  title: string | undefined,
): StepAttribution | undefined {
  if (rels.length === 0) return undefined;
  const ops = distinctOps(rels);
  if (ops.length > 1) {
    const picked = pickedByTitle(rels, title);
    const pickedOps = distinctOps(picked);
    if (pickedOps.length === 1) return attributed(pair, tier, picked, pickedOps[0]);
    return { ...pair, verdict: "contested", tier, rels, ops };
  }
  // Length is exactly one here, so the single distinct value is the answer —
  // and `undefined` is a legitimate answer: every candidate agreed that this
  // hop names no operation.
  return attributed(pair, tier, rels, ops[0]);
}

/**
 * Relationships whose ENDPOINTS resolve to the same two services as the pair —
 * the fallback tier, and the reason a step drawn between two services matches an
 * edge drawn between two containers.
 *
 * EMPTY when both endpoints resolve to ONE service, and that is a correction
 * rather than an optimisation. The service tier exists for a step drawn between
 * two SERVICES, where "which edge backs it" is answered by collapsing each
 * side's containers to the service that owns them. Inside one service there is
 * no service-tier reading: collapsing both sides yields the pair
 * (svc, svc), which EVERY internal relationship of that service matches —
 * measured at the 1.59.2 pin on a bound service drawn as three containers:
 * a hop `api -> db` with no declared edge and two unrelated internal edges
 * (`api -> workflow`, `workflow -> db`) came back `attributed` on tier 2 with
 * both edges as candidates, all agreeing on no `op`. So an unbacked hop between
 * two containers of one service could never earn `usecase.step-unbacked` — the
 * one grade this join exists to produce — until the moment a fleet drew a
 * service's flow over its own containers (`core/usecases/service/flows.ts`),
 * and a landscape that draws a service as containers had the same wrong answer
 * for the same hop all along.
 *
 * Through the module's cached `resolverFor`, not a fresh `serviceResolver`: this
 * runs once per step of every use case in the fleet, and building the id map per
 * step is the cost that comment above `RESOLVERS` exists to prevent.
 */
function resolvedTier(pair: CallPair, scope: StepScope): Rel[] {
  const resolve = resolverFor(scope.elements, scope.known);
  const from = resolve(pair.from);
  const to = resolve(pair.to);
  if (from === to) return [];
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
 * document nobody changed. The step's title is read inside a tier, never across
 * them: it narrows the tier that answered and cannot reach the other.
 *
 * Relationship `kind` is deliberately not part of the match, and that is
 * measured too: at this pin `a -[http]-> b` without a `relationship http` in the
 * `specification` block is "Could not resolve reference to RelationshipKind
 * named 'http'" — a parse error, which under loam's standing rule means no model
 * at all — and `test/helpers/harness.ts`'s own `LANDSCAPE` declares no
 * relationship kinds. So narrowing by kind would mean a fix message asking an
 * author to write a line their document does not parse.
 */
export function attributeStep(step: StepReading, scope: StepScope): StepAttribution {
  const pair = callPair(step);
  const exact = scope.relationships.filter((r) => r.source === pair.from && r.target === pair.to);
  const declared = verdictOn(pair, 1, exact, step.title);
  if (declared !== undefined) return declared;
  return verdictOn(pair, 2, resolvedTier(pair, scope), step.title) ?? { ...pair, verdict: "unbacked" };
}
