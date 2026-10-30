/**
 * An obligation carried by a FLOW: `#obl-<id>` on a `dynamic view`.
 *
 * WHY A FLOW CAN CARRY ONE. A use case could keep only a business promise —
 * `#cap-` and `#req-` resolve into the capability tree — while an architectural
 * requirement lives inside one service's `arch.spec.md`, where no fleet flow
 * can name it. So a cross-service sequence nobody outside the fleet sees (a
 * projection reaching its consumers, a dictionary refresh, an outbox relay) was
 * either tagged with a business promise it does not keep, which `keptBy` then
 * counted, or left as a picture nothing graded (ROADMAP, "A fleet flow keeps an
 * architectural obligation"). The obligation vocabulary already names those
 * decisions and says WHERE each applies; a flow is one more way to say where.
 *
 * THE TAG APPLIES THE OBLIGATION TO EVERY HOP, and that is what makes it a
 * claim rather than a label. The relationship backing each hop is treated
 * exactly as an edge tagged `#obl-<id>` on the map, so the coverage question
 * `obligation.uncovered` asks of a tagged edge is asked of each of them, and
 * every team on the path owes an arch requirement covering its own hop. A tag
 * that applied to nothing would let a flow "keep" an obligation no team met.
 *
 * THE BACKING IS `attributeStep`'s, not a second reading of the model. A reply
 * hop is attributed to the call it answers, a hop into a container to the edge
 * drawn there or to the service-level one, and a hop nothing backs is
 * `usecase.step-unbacked`'s to report — it asks no coverage question here,
 * because there is no relationship for a `Covers:` line to name. A contested
 * hop's candidates are all applied: they join the same two endpoints, and the
 * disagreement is about which operation, which `usecase.step-contested` names.
 *
 * Two scopes read this — the fleet target over the living `architecture/`
 * project, and the feature gate over the map a feature's merge would leave —
 * and each states its own place and its own `Covers:` index. What a flow
 * carries and which relationships it rides are this module's alone, so the two
 * scopes cannot disagree about either.
 */
import { attributeStep, type StepScope } from "../../c4/resolve/steps.js";
import type { Rel } from "../../c4/likec4.js";
import type { ParsedStep, ParsedView } from "../../c4/parsed/dynamic-views.js";
import { OBLIGATION_TAG_PREFIX } from "../../obligations/obligations.js";

/**
 * The obligation ids a view's `#obl-` tags name, sorted and de-duplicated.
 *
 * A bare `#obl-` is kept as the empty id, for `taggedObjects`' reason on the
 * map: the prefix is the author's opt-in however little follows it, and it then
 * resolves to `obligation.unknown` rather than being dropped as unreserved.
 */
export function viewObligations(view: { tags: readonly string[] }): string[] {
  const ids = view.tags.filter((tag) => tag.startsWith(OBLIGATION_TAG_PREFIX)).map((tag) => tag.slice(OBLIGATION_TAG_PREFIX.length));
  return [...new Set(ids)].sort();
}

/** One relationship a flow's tag applies its obligation to, with the first hop that rides it. */
export interface FlowHop {
  edge: Rel;
  step: ParsedStep;
}

/**
 * The relationships backing a view's hops, in step order, one per ENDPOINT PAIR.
 *
 * Once per pair, not per hop and not per relationship: a call and its reply
 * ride one edge, a flow that crosses the same edge twice applies the
 * obligation to it once, and a contested hop's candidates on one tier share
 * their two endpoints — while a `Covers:` edge line names endpoints and nothing
 * else (`coversEdge` reads no kind and no operation), so two relationships
 * between one pair are one coverage question. Keyed by identity, the feature
 * gate reported a contested hop twice where `validate --all` reported it once.
 */
export function hopEdges(view: ParsedView, scope: StepScope): FlowHop[] {
  const seen = new Set<string>();
  const hops: FlowHop[] = [];
  for (const step of view.steps) {
    const verdict = attributeStep(step, scope);
    if (verdict.verdict === "unbacked") continue;
    for (const edge of verdict.rels) {
      const key = edgeKey(edge);
      if (seen.has(key)) continue;
      seen.add(key);
      hops.push({ edge, step });
    }
  }
  return hops;
}

/**
 * How an edge is told apart wherever the obligation axis asks about coverage —
 * its two endpoints, structurally joined rather than with a separator character
 * (`commands/validate/arch-coverage.ts` records the NUL that once made two
 * spellings of this key disagree).
 */
export function edgeKey(edge: Pick<Rel, "source" | "target">): string {
  return JSON.stringify([edge.source, edge.target]);
}

/**
 * The service that answers for an edge's obligation: the one it points INTO,
 * or the one it leaves where the target is no service — a topic a publisher
 * writes to, a partner system it calls. `undefined` when neither end is one of
 * ours, and a message then stays general rather than naming a team at random.
 *
 * The target first because that is who a call obliges (the provider owes the
 * contract, the retry budget, the idempotency), and a delivery from a topic
 * points at its consumer; a publish edge points at the topic, so its owner is
 * the producer at the source.
 */
export function edgeOwner(edge: Rel, resolve: (id: string) => string, known: ReadonlySet<string>): string | undefined {
  const target = resolve(edge.target);
  if (known.has(target)) return target;
  const source = resolve(edge.source);
  return known.has(source) ? source : undefined;
}
