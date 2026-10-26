/**
 * The hop join — `loam delta`'s answer to "what is this hop inside my service".
 *
 * A fleet flow's hop into a service and the service's own flows describe one
 * call at two altitudes. Before the join the brief showed the first and never
 * the second, and never the feature's own fleet flows at all: on a real fleet a
 * feature rewrote requirements of a service whose flows `adopt` had drawn, and
 * the implementer's brief named none of those flows and none of the feature's.
 *
 * What each block pins, and the wrong implementation it fails against:
 *
 * THE KEY IS THE HOP'S, ON THE ANSWERING SIDE. An operation joins only where the
 * service is CALLED, a message only on the side its metadata binds — publishes
 * at the source, consumes at the target. A join that keyed every touched hop
 * would put the payment service's operation under the order service's own call
 * to it.
 *
 * NO GUESS, NO FAKE EMPTINESS. A contested hop joins nothing and names its
 * candidates; a service whose flows cannot be read is `unread`, keys kept, with
 * no `flows` a caller could count as "nothing inside". An inside that is truly
 * empty is `joined` with `flows: []` — a fact, and no finding.
 *
 * THE CORPUS IS THE MERGE'S. A flow the feature redraws in its slot replaces the
 * living file it is named like, in the join and in `redraw` alike: listing both
 * would be listing a file the archive deletes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { makeProject, pinFor, runLoam, type Project } from "./helpers/harness.js";

const FEAT = "FEAT-1";
const FEAT_DIR = "features/FEAT-1-ordering";
const SLOT = `${FEAT_DIR}/specs/order-service/usecases`;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/**
 * Two edges between the gateway and order-service naming two operations — the
 * contested pair — and one order-service edge that PUBLISHES. order-service
 * extends the map; its flows declare their own tags, as SCHEMA allows beside an
 * extending model, so none is declared here.
 */
const LANDSCAPE = `specification {
  element softwareSystem
  element container
  element person
  tag FEAT-1
  tag cap-ordering
}

model {
  customer = person 'Customer'
  gateway = softwareSystem 'api-gateway'
  orderService = softwareSystem 'order-service' {
    metadata { service 'order-service' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }
  kafka = softwareSystem 'kafka' {
    orderEvents = container 'order-events'
  }

  customer -> gateway 'Uses'
  gateway -> orderService 'Calls placeOrder' {
    metadata { op 'placeOrder' }
  }
  gateway -> orderService 'Calls cancelOrder' {
    metadata { op 'cancelOrder' }
  }
  orderService -> paymentService 'Calls authorize' {
    metadata { op 'authorize' }
  }
  orderService -> kafka.orderEvents 'Publishes OrderPlaced' {
    metadata { publishes 'OrderPlaced' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/**
 * Five hops. For order-service: step 2 is CALLED with placeOrder (the title
 * picks it out of the contested pair), step 3 is order-service CALLING the
 * payment service, step 4 PUBLISHES, and step 5 is the contested pair with a
 * title that picks neither.
 */
const ORDERING = `views {
  dynamic view uc_ordering {
    #cap-ordering
    title 'Ordering'

    customer -> gateway 'opens the shop'
    gateway -> orderService 'placeOrder — places the order'
    orderService -> paymentService 'authorizes the payment'
    orderService -> kafka.orderEvents 'announces OrderPlaced'
    gateway -> orderService 'changes the order'
  }
}
`;

/** The feature's own fleet flow: one hop, the same call. */
const REORDER = `views {
  dynamic view uc_reorder {
    #cap-ordering
    title 'Reorder'

    gateway -> orderService 'placeOrder — places it again'
  }
}
`;

const ORDER_MODEL = `model {
  extend orderService {
    api = container 'api'
    domain = container 'domain'
    api -> domain 'places and announces'
  }
}
`;

const ORDER_SPEC = `---
service: order-service
---

# order-service

## Requirements

### Requirement: Place an order
Requirement-ID: ORD-PLACE
Operations: placeOrder
The service SHALL accept an order.

#### Scenario: Placed
- **Given** a basket
- **When** it is ordered
- **Then** an order exists

### Requirement: Announce a placed order
Requirement-ID: ORD-ANNOUNCE
Publishes: OrderPlaced
The service SHALL announce every placed order once.

#### Scenario: Announced
- **Given** a placed order
- **When** it is committed
- **Then** OrderPlaced is published once

### Requirement: Audit every change
Requirement-ID: ORD-AUDIT
The service SHALL audit every change to an order.

#### Scenario: Audited
- **Given** an order
- **When** it changes
- **Then** the change is audited
`;

/** The feature rewrites ORD-PLACE, pinned as `loam rebase` pins it. */
const ORDER_DELTA = `# order-service — delta for ${FEAT}

## MODIFIED Requirements

### Requirement: Place an order
Requirement-ID: ORD-PLACE
Based-On: ${pinFor(ORDER_SPEC, "Place an order")}
Operations: placeOrder
The service SHALL accept an order and reserve its stock.

#### Scenario: Placed
- **Given** a basket
- **When** it is ordered
- **Then** an order exists and its stock is reserved
`;

/** A service-local flow document declaring its own tag. */
function flow(view: string, req: string, steps: string[]): string {
  return `specification {\n  tag req-${req}\n}\n\nviews {\n  dynamic view ${view} {\n    #req-${req}\n${steps.map((s) => `    ${s}\n`).join("")}  }\n}\n`;
}

const PLACE = flow("uc_place", "ORD-PLACE", ["orderService.api -> orderService.domain 'places the order'"]);
const ANNOUNCE = flow("uc_announce", "ORD-ANNOUNCE", ["orderService.api -> orderService.domain 'announces it'"]);
const AUDIT = flow("uc_audit", "ORD-AUDIT", ["orderService.api -> orderService.domain 'audits it'"]);
const REDRAWN_PLACE = flow("uc_place", "ORD-PLACE", [
  "orderService.api -> orderService.domain 'places the order'",
  "orderService.domain -> orderService.api 'reserves the stock'",
]);

function fleet(files: Record<string, string>): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "architecture/usecases/ordering.likec4": ORDERING,
    "services/order-service/model.likec4": ORDER_MODEL,
    "services/order-service/spec.md": ORDER_SPEC,
    "services/order-service/usecases/place.likec4": PLACE,
    "services/order-service/usecases/announce.likec4": ANNOUNCE,
    "services/order-service/usecases/audit.likec4": AUDIT,
    "services/payment-service/spec.md": "---\nservice: payment-service\n---\n\n# payment-service\n",
    [`${FEAT_DIR}/intent.md`]: `---\nfeature: ${FEAT}\nstatus: proposed\n---\n\n# Ordering\n\nOrders reserve stock.\n`,
    [`${FEAT_DIR}/specs/order-service/spec.md`]: ORDER_DELTA,
    [`${FEAT_DIR}/usecases/reorder.likec4`]: REORDER,
    ...files,
  };
}

async function project(files: Record<string, string> = {}): Promise<Project> {
  const p = await makeProject(fleet(files));
  cleanups.push(() => p.destroy());
  return p;
}

interface Inside {
  state: string;
  keys?: Array<{ kind: string; name: string }>;
  flows?: Array<{ id: string; file: string; origin: string; via: string[] }>;
  candidates?: Array<string | null>;
}

interface Step {
  ordinal: number;
  inside?: Inside;
}

interface Through {
  unreadable: boolean;
  error?: string;
  flows: Array<{ id: string; file: string; steps: Step[] }>;
}

interface UseCases extends Through {
  featureFlows: Through;
  inside: { unreadable: boolean; error?: string };
  redraw: Array<{ id: string; file: string; slot?: string; claims: Array<{ requirement: string; change: string; breaks: string | null }> }>;
}

async function useCases(p: Project, service: string): Promise<UseCases> {
  const res = await runLoam(p.workDir, "delta", FEAT, "--service", service, "--json");
  const payload = JSON.parse(res.stdout) as { useCases?: UseCases };
  if (payload.useCases === undefined) throw new Error(`no useCases key in ${res.stdout}`);
  return payload.useCases;
}

function step(through: Through, view: string, ordinal: number): Step {
  const found = through.flows.find((f) => f.id === view)?.steps.find((s) => s.ordinal === ordinal);
  if (found === undefined) throw new Error(`no step ${ordinal} of ${view} in ${JSON.stringify(through)}`);
  return found;
}

describe("loam delta — what each hop is inside the service", () => {
  it("joins a called hop by its operation and a publishing hop by its message, and leaves the service's own call alone", async () => {
    const p = await project();
    const u = await useCases(p, "order-service");
    expect(u.unreadable).toBe(false);
    expect(u.inside).toEqual({ unreadable: false });
    // The same hops the blast radius always reported: the join adds a key and never a step.
    expect(u.flows.find((f) => f.id === "uc_ordering")?.steps.map((s) => s.ordinal)).toEqual([2, 3, 4, 5]);

    expect(step(u, "uc_ordering", 2).inside).toEqual({
      state: "joined",
      keys: [{ kind: "op", name: "placeOrder" }],
      flows: [{ id: "uc_place", file: "services/order-service/usecases/place.likec4", origin: "living", via: ["ORD-PLACE"] }],
    });
    // order-service CALLS the payment service here: the operation is the
    // payment service's, so this hop has no inside on this side at all.
    expect(step(u, "uc_ordering", 3).inside).toBeUndefined();
    expect(step(u, "uc_ordering", 4).inside).toEqual({
      state: "joined",
      keys: [{ kind: "publishes", name: "OrderPlaced" }],
      flows: [{ id: "uc_announce", file: "services/order-service/usecases/announce.likec4", origin: "living", via: ["ORD-ANNOUNCE"] }],
    });
  });

  it("joins nothing under a contested hop, and names the operations it could be", async () => {
    const p = await project();
    const u = await useCases(p, "order-service");
    expect(step(u, "uc_ordering", 5).inside).toEqual({ state: "contested", candidates: ["cancelOrder", "placeOrder"] });
  });

  it("states an empty inside as joined with no flows — on the other side of the same call", async () => {
    const p = await project();
    const u = await useCases(p, "payment-service");
    // payment-service is called with authorize and draws no flow for it: a
    // fact the brief states, never a finding.
    expect(step(u, "uc_ordering", 3).inside).toEqual({ state: "joined", keys: [{ kind: "op", name: "authorize" }], flows: [] });
    expect(u.redraw).toEqual([]);
  });

  it("shows the feature's own fleet flows, joined over the same corpus", async () => {
    const p = await project();
    const u = await useCases(p, "order-service");
    expect(u.featureFlows.unreadable).toBe(false);
    expect(u.featureFlows.flows.map((f) => [f.id, f.file])).toEqual([["uc_reorder", `${FEAT_DIR}/usecases/reorder.likec4`]]);
    expect(step(u.featureFlows, "uc_reorder", 1).inside?.flows?.map((f) => f.id)).toEqual(["uc_place"]);
    // And `flows` keeps meaning what it always meant: the living ones alone.
    expect(u.flows.map((f) => f.id)).toEqual(["uc_ordering"]);
  });

  it("lists the living flow whose requirement the feature rewrites, with the slot to redraw it in", async () => {
    const p = await project();
    const u = await useCases(p, "order-service");
    expect(u.redraw).toEqual([
      {
        id: "uc_place",
        file: "services/order-service/usecases/place.likec4",
        slot: `${SLOT}/place.likec4`,
        claims: [{ requirement: "ORD-PLACE", change: "MODIFIED", breaks: null }],
      },
    ]);
  });

  it("puts the feature's redrawn flow inside the hop in place of the living file, and empties redraw", async () => {
    const p = await project({ [`${SLOT}/place.likec4`]: REDRAWN_PLACE });
    const u = await useCases(p, "order-service");
    expect(u.inside).toEqual({ unreadable: false });
    expect(step(u, "uc_ordering", 2).inside?.flows).toEqual([
      { id: "uc_place", file: `${SLOT}/place.likec4`, origin: "feature", via: ["ORD-PLACE"] },
    ]);
    expect(u.redraw).toEqual([]);
  });

  it("says a hop is unread — never empty — when the service's flows cannot be read", async () => {
    // `ghost` is declared nowhere, so order-service's project does not parse,
    // and the document carries the tag spelling the byte gate opens on.
    const p = await project({
      "services/order-service/usecases/place.likec4": flow("uc_place", "ORD-PLACE", ["orderService.api -> orderService.ghost 'places'"]),
    });
    const u = await useCases(p, "order-service");
    expect(u.inside.unreadable).toBe(true);
    expect(u.inside.error).toContain("order-service");
    const inside = step(u, "uc_ordering", 2).inside;
    expect(inside).toEqual({ state: "unread", keys: [{ kind: "op", name: "placeOrder" }] });
    expect(inside).not.toHaveProperty("flows");
  });

  it("says every keyed hop is unread when the service's requirement merge is refused", async () => {
    // Two ADDED requirements under one id: the archive's fold refuses the delta,
    // so there is no requirement set the hop could be joined through.
    const refused = `${ORDER_DELTA}
## ADDED Requirements

### Requirement: Refund an order
Requirement-ID: ORD-REFUND
The service SHALL refund an order once.

#### Scenario: Refunded
- **Given** an order
- **When** it is refunded
- **Then** it is refunded once

### Requirement: Refund an order again
Requirement-ID: ORD-REFUND
The service SHALL refund an order once more.

#### Scenario: Refunded again
- **Given** an order
- **When** it is refunded again
- **Then** it is refunded again
`;
    const p = await project({ [`${FEAT_DIR}/specs/order-service/spec.md`]: refused });
    const u = await useCases(p, "order-service");
    expect(u.inside.unreadable).toBe(true);
    expect(u.inside.error).toContain("requirement merge is refused");
    expect(step(u, "uc_ordering", 2).inside).toEqual({ state: "unread", keys: [{ kind: "op", name: "placeOrder" }] });
  });

  it("gives a claim whose tag the merge breaks the error's own fix — never 'put it there unchanged'", async () => {
    const removed = `# order-service — delta for ${FEAT}

## REMOVED Requirements

### Requirement: Place an order
Requirement-ID: ORD-PLACE
Based-On: ${pinFor(ORDER_SPEC, "Place an order")}
`;
    const p = await project({ [`${FEAT_DIR}/specs/order-service/spec.md`]: removed });
    const u = await useCases(p, "order-service");
    expect(u.redraw.map((r) => [r.id, r.claims])).toEqual([["uc_place", [{ requirement: "ORD-PLACE", change: "REMOVED", breaks: "unresolved" }]]]);
    const res = await runLoam(p.workDir, "delta", FEAT, "--service", "order-service");
    expect(res.stdout).toContain("claims ORD-PLACE, which this feature REMOVED: its tag stops resolving, which gates the archive");
    expect(res.stdout).not.toContain("put it there unchanged");
    // A non-breaking MODIFIED is not a status step's either way: the removal is
    // an error, and `next.fix-coherence` already stands in front of the author.
    expect((await status(p)).next.map((n) => n.code)).not.toContain("next.redraw-flows");
  });

  it("lists a flow claiming two rewritten requirements once, with both claims", async () => {
    const both = `${ORDER_DELTA}
### Requirement: Audit every change
Requirement-ID: ORD-AUDIT
Based-On: ${pinFor(ORDER_SPEC, "Audit every change")}
The service SHALL audit every change to an order, its stock reservation included.

#### Scenario: Audited
- **Given** an order
- **When** its stock is reserved
- **Then** the reservation is audited
`;
    const twoTags = `specification {\n  tag req-ORD-PLACE\n  tag req-ORD-AUDIT\n}\n\nviews {\n  dynamic view uc_both {\n    #req-ORD-PLACE\n    #req-ORD-AUDIT\n    orderService.api -> orderService.domain 'places and audits'\n  }\n}\n`;
    const p = await project({
      [`${FEAT_DIR}/specs/order-service/spec.md`]: both,
      "services/order-service/usecases/place.likec4": twoTags,
      "services/order-service/usecases/audit.likec4": "// folded into place.likec4\n",
    });
    const u = await useCases(p, "order-service");
    expect(u.redraw.map((r) => [r.id, r.claims.map((c) => c.requirement)])).toEqual([["uc_both", ["ORD-AUDIT", "ORD-PLACE"]]]);
    const steps = (await status(p)).next.filter((n) => n.code === "next.redraw-flows");
    expect(steps.map((n) => n.statement.split(" ")[0])).toEqual(["1"]);
  });

  it("does not count an empty slot document as a redraw — the join and redraw agree", async () => {
    const p = await project({ [`${SLOT}/place.likec4`]: "" });
    const u = await useCases(p, "order-service");
    expect(step(u, "uc_ordering", 2).inside?.flows?.map((f) => [f.id, f.origin])).toEqual([["uc_place", "living"]]);
    expect(u.redraw.map((r) => r.id)).toEqual(["uc_place"]);
    expect((await status(p)).next.map((n) => n.code)).toContain("next.redraw-flows");
  });

  it("prints the inside under each hop, grouped by requirement, and the flows the change makes untrue", async () => {
    const p = await project();
    const res = await runLoam(p.workDir, "delta", FEAT, "--service", "order-service");
    expect(res.stdout).toContain("Use cases (business flows this service is already a hop of):");
    expect(res.stdout).toContain("step 2 'placeOrder — places the order': gateway -> orderService");
    expect(res.stdout).toContain("inside order-service, by op placeOrder:");
    expect(res.stdout).toContain("ORD-PLACE: uc_place  services/order-service/usecases/place.likec4");
    expect(res.stdout).toContain("not joined — the edges behind this hop name cancelOrder, placeOrder, and its title picks none");
    expect(res.stdout).toContain("Use cases this feature brings (its own flows through this service):");
    expect(res.stdout).toContain("Flows of order-service this change makes untrue:");
    expect(res.stdout).toContain(`claims ORD-PLACE, which this feature MODIFIED: redraw it at ${SLOT}/place.likec4, or put it there unchanged if it still holds`);
  });
});

interface StatusPayload {
  useCases: Through & { featureFlows: Through };
  next: Array<{ code: string; statement: string; service?: string; path?: string; command: string; execution: { kind: string } }>;
}

async function status(p: Project): Promise<StatusPayload> {
  const res = await runLoam(p.workDir, "status", FEAT, "--json");
  return JSON.parse(res.stdout) as StatusPayload;
}

describe("loam status — the feature's own flows, and the step to redraw what it makes untrue", () => {
  it("carries the feature's flows as a key of their own beside the living ones", async () => {
    const p = await project();
    const s = await status(p);
    expect(s.useCases.flows.map((f) => f.id)).toEqual(["uc_ordering"]);
    expect(s.useCases.featureFlows.unreadable).toBe(false);
    expect(s.useCases.featureFlows.flows.map((f) => [f.id, f.file])).toEqual([["uc_reorder", `${FEAT_DIR}/usecases/reorder.likec4`]]);
  });

  it("puts a living flow whose requirement the feature rewrites in front of the author, as an edit", async () => {
    const p = await project();
    const steps = (await status(p)).next.filter((n) => n.code === "next.redraw-flows");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.service).toBe("order-service");
    expect(steps[0]!.path).toBe(`${SLOT}/`);
    expect(steps[0]!.command).toBe(`loam delta ${FEAT} --service order-service --json`);
    expect(steps[0]!.execution.kind).toBe("edit");
  });

  it("raises no step for a flow with no slot — one in views.likec4 is edited in place, and keeps only the warning", async () => {
    // The same flow, moved out of usecases/: a document in the feature's slot
    // would replace nothing, so a step pointing there would never clear.
    const p = await project({
      "services/order-service/views.likec4": PLACE,
      "services/order-service/usecases/place.likec4": "// moved to ../views.likec4\n",
    });
    const s = await status(p);
    expect(s.next.map((n) => n.code)).not.toContain("next.redraw-flows");
    const u = await useCases(p, "order-service");
    expect(u.redraw.map((r) => [r.file, r.slot])).toEqual([["services/order-service/views.likec4", undefined]]);
  });

  it("drops the step once the flow is redrawn in the slot", async () => {
    const p = await project({ [`${SLOT}/place.likec4`]: REDRAWN_PLACE });
    expect((await status(p)).next.map((n) => n.code)).not.toContain("next.redraw-flows");
  });
});
