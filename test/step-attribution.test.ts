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
 *
 * The last describe is the step's TITLE, the one field besides the endpoints an
 * attribution reads: it may pick among candidates that disagree, and every case
 * there is either a pick that must happen or a guess that must not — a title
 * whose prose happens to contain an operation name is the second kind.
 */
import { describe, expect, it } from "vitest";
import {
  attributeStep,
  pickingTitle,
  type StepAttribution,
  type StepReading,
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

/** An untitled step: the endpoints alone, which is all the tier and op rules read. */
function hop(source: string, target: string, isBackward = false): StepReading {
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

/* ------------------------------------------------------------------ */
/* The title picks among candidates that disagree, and does nothing else */
/* ------------------------------------------------------------------ */

/**
 * One caller, one provider, three edges between them — the shape a fleet map
 * draws for a caller that reserves, reads and releases on one service, and the
 * one that made every hop between the two contested for good.
 */
const MULTI_OP = `specification {
  element service
}
model {
  web = service 'checkout-web'
  orders = service 'order-service'
  web -> orders 'Calls createOrder' {
    metadata { op 'createOrder' }
  }
  web -> orders 'Calls getOrder' {
    metadata { op 'getOrder' }
  }
  web -> orders 'Calls cancelOrder' {
    metadata { op 'cancelOrder' }
  }
}
views {
  dynamic view uc_order {
    web -> orders 'createOrder — places the order'
    web <- orders 'getOrder(orderId): the order as stored'
    web -> orders 'places the order'
  }
}
`;

/** A step with a title — the literal form of what an author writes after the arrow. */
function titled(source: string, target: string, title: string): StepReading {
  return { source, target, isBackward: false, title };
}

describe("attributeStep lets the step's title pick among candidates that disagree", () => {
  it("picks the candidate a real step's title opens with, for a call and for a reply", async () => {
    const doc = await loadSource(MULTI_OP);
    expect(doc.errors).toEqual([]);
    const [call, reply, prose] = doc.views?.[0]?.steps ?? [];
    const create = doc.relationships.find((r) => r.op === "createOrder");
    const get = doc.relationships.find((r) => r.op === "getOrder");
    const scope: StepScope = { elements: doc.elements, relationships: doc.relationships };

    // The title reaches the join verbatim — the separator and everything after
    // it included — which is what lets the opening be read at all.
    expect(call?.title).toBe("createOrder — places the order");
    expect(attributeStep(call!, scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [create],
      op: "createOrder",
    });
    // A reply is attributed to the CALL it answers, so its title picks among
    // the call's candidates. `(` ends a name as surely as a space does.
    expect(attributeStep(reply!, scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [get],
      op: "getOrder",
    });
    // Prose names nothing, and the hop stays exactly as contested as before,
    // over all three candidates.
    expect(attributeStep(prose!, scope)).toMatchObject({ verdict: "contested", rels: doc.relationships });
  });

  it("picks an edge by the message it publishes, which then carries no op", () => {
    const call = rel("web", "orders", "createOrder");
    const event: Rel = { ...rel("web", "orders"), publishes: "order.Placed" };
    const scope = containerScope([call, event]);
    expect(attributeStep(titled("web", "orders", "order.Placed — announced"), scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 1,
      rels: [event],
    });
  });

  it("picks on the service tier too, among the container edges that tier found", () => {
    // `web -> orders.api` names createOrder and `web -> orders.worker` names
    // nothing: contested on tier 2 until the title says which.
    const api = rel("web", "orders.api", "createOrder");
    const worker = rel("web", "orders.worker");
    expect(attributeStep(titled("web", "orders", "createOrder"), containerScope([api, worker]))).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "attributed",
      tier: 2,
      rels: [api],
      op: "createOrder",
    });
  });

  it("reads only the opening, a whole name set off by punctuation, matched exactly — never prose", () => {
    const scope = containerScope([rel("web", "orders", "read"), rel("web", "orders", "release")]);
    // The control: this pair IS pickable, so every refusal below is the rule
    // refusing rather than a scope nothing could pick from.
    expect(attributeStep(titled("web", "orders", "read: the order"), scope)).toMatchObject({ op: "read" });
    for (const title of [
      // The guess the opening rule exists to refuse: the sentence contains
      // `release` as a word, and the author meant the read.
      "reads the order before release",
      // The first WORD of a sentence is not a name either. A fleet whose
      // operationIds are plain verbs has titles like this already, written
      // before a title could pick anything.
      "read the order",
      // A prefix of a longer word is not the name.
      "readAll — every order",
      // An operationId is case-sensitive.
      "Read the order",
    ]) {
      expect(attributeStep(titled("web", "orders", title), scope).verdict).toBe("contested");
    }
  });

  it("treats `-` and `_` as continuing a name, so a longer name is never read as its prefix", () => {
    const scope = containerScope([rel("web", "orders", "createOrder"), rel("web", "orders", "getOrder")]);
    for (const title of ["createOrder-batch: every order", "createOrder_v2: the new shape"]) {
      expect(attributeStep(titled("web", "orders", title), scope).verdict).toBe("contested");
    }
  });

  it("reads the title inside the tier that answered, never reaching the other", () => {
    // Tier 1 disagrees between createOrder and getOrder; only the service tier
    // also holds a container edge naming searchOrders. A title naming it must
    // not fall through to tier 2 when the exact tier's pick comes up empty.
    const create = rel("web", "orders", "createOrder");
    const get = rel("web", "orders", "getOrder");
    const scope = containerScope([create, get, rel("web", "orders.api", "searchOrders")]);
    expect(attributeStep(titled("web", "orders", "searchOrders: by date"), scope)).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "contested",
      tier: 1,
      rels: [create, get],
      ops: ["createOrder", "getOrder"],
    });
  });

  it("treats `.` and `-` as part of a name, so a name that prefixes another never picks both", () => {
    const short = { ...rel("orders", "web"), publishes: "order.placed" };
    const long = { ...rel("orders", "web"), publishes: "order.placed.v2" };
    const scope = containerScope([short, long, rel("orders", "web", "notifyCustomer")]);
    expect(attributeStep(titled("orders", "web", "order.placed.v2 — the new shape"), scope)).toMatchObject({
      verdict: "attributed",
      rels: [long],
    });
    expect(attributeStep(titled("orders", "web", "order.placed, as before"), scope)).toMatchObject({
      verdict: "attributed",
      rels: [short],
    });
  });

  it("stays contested over EVERY candidate when the picked ones still disagree", () => {
    // One name declared as one edge's op and another edge's message: the title
    // picked two candidates that disagree, which settles nothing.
    const call = rel("web", "orders", "orderPlaced");
    const event = { ...rel("web", "orders"), publishes: "orderPlaced" };
    const other = rel("web", "orders", "getOrder");
    expect(attributeStep(titled("web", "orders", "orderPlaced"), containerScope([call, event, other]))).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "contested",
      tier: 1,
      rels: [call, event, other],
      ops: ["orderPlaced", undefined, "getOrder"],
    });
  });

  it("never overrules candidates that agree, and never backs a hop nothing backs", () => {
    const agreed = rel("web", "orders", "createOrder");
    // The title names an operation the backing edge does not carry. The model
    // answers this hop outright, and a title is not evidence against it.
    expect(attributeStep(titled("web", "orders", "getOrder"), containerScope([agreed]))).toMatchObject({
      verdict: "attributed",
      op: "createOrder",
    });
    expect(attributeStep(titled("web", "orders", "createOrder"), containerScope([]))).toStrictEqual({
      from: "web",
      to: "orders",
      verdict: "unbacked",
    });
  });

  it("never picks by an empty `op ''`, which parses and names nothing", () => {
    // Every title starts with the empty string, so without the guard an
    // `op ''` would be picked by any title opening with a separator.
    const scope = containerScope([rel("web", "orders", ""), rel("web", "orders", "getOrder")]);
    expect(attributeStep(titled("web", "orders", "— places the order"), scope).verdict).toBe("contested");
  });
});

describe("pickingTitle offers only a title that would settle the hop", () => {
  it("puts an operation id in front of the step's own title, and the result picks", () => {
    const event = { ...rel("web", "orders"), publishes: "order.Placed" };
    const rels = [event, rel("web", "orders", "createOrder"), rel("web", "orders", "getOrder")];
    // Operation ids first, though the message edge comes first in candidate
    // order: the warning is about operations.
    const spelled = pickingTitle(rels, "places the order");
    expect(spelled).toBe("createOrder — places the order");
    expect(attributeStep(titled("web", "orders", spelled!), containerScope(rels))).toMatchObject({
      op: "createOrder",
    });
    expect(pickingTitle(rels, undefined)).toBe("createOrder");
  });

  it("skips a name that candidates still disagreeing share, and offers nothing when every name is one", () => {
    const call = rel("web", "orders", "orderPlaced");
    const event = { ...rel("web", "orders"), publishes: "orderPlaced" };
    expect(pickingTitle([call, event, rel("web", "orders", "getOrder")], "orderPlaced — x")).toBe(
      "getOrder — orderPlaced — x",
    );
    expect(pickingTitle([call, event], "the order")).toBeUndefined();
  });
});
