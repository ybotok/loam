/**
 * Which relationship backs one hop of a use case — `attributeStep`.
 *
 * Two halves, because two different things break it.
 *
 * The first half runs against a REAL LikeC4 parse. Orientation is the half that
 * mis-grades the whole fleet if it is wrong — a reply arrow is the commonest
 * step in any sequence diagram — and a hand-written `ParsedStep` literal would
 * only ever re-state whatever the implementation already assumed about
 * `isBackward`. So the reply cases below start from source text an author would
 * write, go through `loadSource`, and assert the parsed endpoints on the way so
 * a reader can see why the lookup pair is flipped.
 *
 * The second half is literals over `Elem`/`Rel`, because the tier and distinct-op
 * rules are about the SHAPE of a model rather than about LikeC4: a fleet that
 * draws one service as containers, two container edges agreeing on an operation,
 * two disagreeing, one carrying an op and one carrying none. Parsing a document
 * for each of those would buy nothing and cost a Langium workspace apiece.
 *
 * Every case here is a wrong answer that was reachable, not a shape assertion:
 * an unflipped reply reports a return hop as unbacked, a candidate COUNT in
 * place of a distinct-op count convicts a consistent model of contesting itself,
 * and a service tier that runs when the exact tier already matched contests a
 * step the model answers outright.
 */
import { describe, expect, it } from "vitest";
import {
  attributeStep,
  type StepAttribution,
  type StepEndpoints,
  type StepScope,
} from "../src/core/c4/resolve/steps.js";
import { loadSource, type Elem, type Rel } from "../src/core/c4/likec4.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A landscape that declares the CALL and no mirror return edge — the ordinary
 * shape, and the one an unflipped reply lookup reports as unbacked.
 */
const CALL_ONLY = `specification {
  element service
}
model {
  web = service 'checkout-web'
  orders = service 'order-service'
  web -> orders 'places the order' {
    metadata { op 'createOrder' }
  }
}
views {
  dynamic view uc_checkout {
    web -> orders 'places the order'
    web <- orders 'the created order'
  }
}
`;

/**
 * The mirror of it: only `orders -> web` is declared, and the view draws both
 * hops FORWARD. A lookup that flipped unconditionally would answer these two
 * exactly the wrong way round, which is why the pair exists.
 */
const RETURN_ONLY = `specification {
  element service
}
model {
  web = service 'checkout-web'
  orders = service 'order-service'
  orders -> web 'the created order' {
    metadata { op 'orderCreated' }
  }
}
views {
  dynamic view uc_checkout {
    web -> orders 'places the order'
    orders -> web 'the created order'
  }
}
`;

/** A neutral element; nothing here binds a service, so the title is the join. */
function elem(id: string, title: string): Elem {
  return { id, kind: "service", title, tags: [] };
}

/** A relationship, with or without the `metadata { op }` an attribution reads. */
function rel(source: string, target: string, op?: string): Rel {
  return { source, target, ...(op === undefined ? {} : { op }), tags: [] };
}

/** The three fields an attribution reads off a step. */
function hop(source: string, target: string, isBackward = false): StepEndpoints {
  return { source, target, isBackward };
}

/**
 * `checkout-web` calling `order-service`, where the callee is drawn as two
 * containers. `known` is the enumerated fleet: without it the resolver falls
 * back to a container's own title and answers "api", a service that has never
 * existed, so every tier-2 case here would match nothing for the wrong reason.
 */
function containerScope(relationships: Rel[]): StepScope {
  return {
    elements: [
      elem("web", "checkout-web"),
      elem("orders", "order-service"),
      elem("orders.api", "api"),
      elem("orders.worker", "worker"),
    ],
    relationships,
    known: new Set(["checkout-web", "order-service"]),
  };
}

/* ------------------------------------------------------------------ */
/* Orientation, against a real parse                                   */
/* ------------------------------------------------------------------ */

describe("attributeStep orients a step before it looks anything up", () => {
  it("attributes a `<-` reply to the CALL it answers, in a model with no mirror edge", async () => {
    const doc = await loadSource(CALL_ONLY);
    expect(doc.errors).toEqual([]);
    const steps = doc.views?.[0]?.steps ?? [];
    const scope: StepScope = { elements: doc.elements, relationships: doc.relationships };

    const [call, reply] = steps;
    // The parsed form the flip exists to undo: LikeC4 has already reversed the
    // endpoints and set the flag. Asserted here so the expectation below reads
    // as a consequence rather than as a guess.
    expect([reply?.source, reply?.target, reply?.isBackward]).toEqual(["orders", "web", true]);

    // Both hops are the same call, so both name the same operation. Drop the
    // flip and this one becomes `unbacked` — every return hop in the fleet with
    // it.
    expect(attributeStep(call!, scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [doc.relationships[0]],
      op: "createOrder",
    });
    expect(attributeStep(reply!, scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [doc.relationships[0]],
      op: "createOrder",
    });
  });

  it("does NOT flip a forward step, so a call with only its return edge declared is unbacked", async () => {
    const doc = await loadSource(RETURN_ONLY);
    expect(doc.errors).toEqual([]);
    const steps = doc.views?.[0]?.steps ?? [];
    const scope: StepScope = { elements: doc.elements, relationships: doc.relationships };

    const [outbound, inbound] = steps;
    // Neither hop carries the flag — a forward step has no `isBackward` key at
    // all, which the reader normalizes to false.
    expect([outbound?.isBackward, inbound?.isBackward]).toEqual([false, false]);

    // Only `orders -> web` is declared, so the outbound hop has nothing behind
    // it. A lookup that flipped unconditionally would report it as attributed
    // and report the inbound hop as unbacked — the two answers swapped.
    expect(attributeStep(outbound!, scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "unbacked",
    });
    expect(attributeStep(inbound!, scope)).toStrictEqual({
      from: "orders",
      to: "web",
      verdict: "attributed",
      tier: 1,
      rels: [doc.relationships[0]],
      op: "orderCreated",
    });
  });

  it("names the CALL's endpoints when an unbacked step was drawn as a reply", () => {
    // The pair is what a finding has to print — "nothing declares web -> orders"
    // — so an unbacked reply must still report the edge the author would draw,
    // not the direction the message travelled.
    const scope: StepScope = { elements: [elem("web", "checkout-web"), elem("orders", "order-service")], relationships: [] };
    expect(attributeStep(hop("orders", "web", true), scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "unbacked",
    });
  });
});

/* ------------------------------------------------------------------ */
/* The two tiers                                                       */
/* ------------------------------------------------------------------ */

describe("attributeStep falls back to the service tier, and only then", () => {
  it("matches an edge drawn between containers with a step drawn between services", () => {
    const edge = rel("web", "orders.api", "createOrder");
    const result = attributeStep(hop("web", "orders"), containerScope([edge]));
    // Tier 2: nothing declares `web -> orders` literally, but the edge's target
    // resolves through the fleet to the same service the step names.
    expect(result).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 2,
      rels: [edge],
      op: "createOrder",
    });
  });

  it("does not run the service tier when the exact tier already matched", () => {
    // The exact edge and a container edge naming a DIFFERENT operation. The
    // service tier necessarily re-finds the exact one too, so a tier 2 that ran
    // unconditionally — or that merged its candidates in — would report this
    // step as contested on a document nobody changed.
    const exact = rel("web", "orders", "createOrder");
    const scope = containerScope([exact, rel("web", "orders.api", "authorizePayment")]);
    expect(attributeStep(hop("web", "orders"), scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [exact],
      op: "createOrder",
    });
  });

  it("reports unbacked when neither tier finds anything", () => {
    // An edge between the right services in the WRONG direction is not a match
    // on either tier — the fallback widens which elements count as an endpoint,
    // never which way the arrow points.
    const scope = containerScope([rel("orders.api", "web", "createOrder")]);
    expect(attributeStep(hop("web", "orders"), scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "unbacked",
    });
  });
});

/* ------------------------------------------------------------------ */
/* The verdict comes from the distinct op count                        */
/* ------------------------------------------------------------------ */

describe("attributeStep counts distinct operations, never candidates", () => {
  it("attributes two container edges that agree on the operation", () => {
    // The case that makes the tier-2 fallback safe. Two relationships, ONE
    // operation. A verdict read off `rels.length` calls this contested and
    // convicts a perfectly consistent model of disagreeing with itself.
    const api = rel("orders.api", "web", "notifyCustomer");
    const worker = rel("orders.worker", "web", "notifyCustomer");
    const result = attributeStep(hop("orders", "web"), containerScope([api, worker]));
    expect(result).toStrictEqual({
      from: "orders",
      to: "web",
      verdict: "attributed",
      tier: 2,
      rels: [api, worker],
      op: "notifyCustomer",
    });
  });

  it("contests two candidates that name different operations", () => {
    const api = rel("orders.api", "web", "notifyCustomer");
    const worker = rel("orders.worker", "web", "refundCustomer");
    expect(attributeStep(hop("orders", "web"), containerScope([api, worker]))).toStrictEqual({
      from: "orders",
      to: "web",
      verdict: "contested",
      tier: 2,
      rels: [api, worker],
      ops: ["notifyCustomer", "refundCustomer"],
    });
  });

  it("contests a candidate carrying an op against one carrying none", () => {
    // Absent is a VALUE, not a gap to skip. Skipping it would promote this
    // disagreement to a confident `attributed` on the one op that happened to
    // be written down.
    const named = rel("orders.api", "web", "notifyCustomer");
    const bare = rel("orders.worker", "web");
    const result = attributeStep(hop("orders", "web"), containerScope([named, bare]));
    expect(result).toStrictEqual({
      from: "orders",
      to: "web",
      verdict: "contested",
      tier: 2,
      rels: [named, bare],
      ops: ["notifyCustomer", undefined],
    });
  });

  it("attributes candidates that all carry no op, and omits the key rather than inventing one", () => {
    const bare = rel("web", "orders");
    const result: StepAttribution = attributeStep(hop("web", "orders"), containerScope([bare]));
    // ABSENT, not `undefined`: a caller testing `"op" in a` must be able to tell
    // "no operation declared" from a key somebody set to undefined.
    expect("op" in result).toBe(false);
    expect(result).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [bare],
    });
  });

  it("collapses repeated ops rather than counting them twice", () => {
    // Two edges between the SAME pair carrying the same op — a fleet that split
    // one call into a read and a write path. One distinct op, so one verdict.
    const first = rel("web", "orders", "createOrder");
    const second = rel("web", "orders", "createOrder");
    expect(attributeStep(hop("web", "orders"), containerScope([first, second]))).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [first, second],
      op: "createOrder",
    });
  });
});
