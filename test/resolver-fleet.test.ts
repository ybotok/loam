/**
 * The element→service resolver receives the enumerated fleet in the checks
 * that are repository-aware. A landscape does not have to draw a service as
 * one opaque box: the moment somebody models its containers, an edge drawn
 * INTO `paymentService.api` is still an edge into payment-service — but
 * without the fleet in hand, `serviceResolver` fell back to the container's
 * own title and answered "api", a service that has never existed. Every join
 * keyed on the service id then silently missed: the removal gate's consumer
 * scan answered "nobody calls it" while retiring an operation that container
 * still consumed, and the dependency graph filed a delta edge's operation
 * under the phantom, inventing or dropping an ordering edge.
 *
 * Each test here pins one of those joins through the CLI, on fixtures whose
 * only unusual property is the modelled container.
 */
import { describe, expect, it } from "vitest";
import { makeProject, pinFor, runLoam } from "./helpers/harness.js";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A living landscape whose consumer edges land on a CONTAINER nested inside
 * payment-service — not on the service element itself. Nothing carries a
 * `metadata { service }` binding, deliberately: the point of every test below
 * is that the ancestor walk through the enumerated fleet is what attaches
 * these edges to payment-service, so an explicit binding would let the checks
 * pass for a reason that is not under test.
 */
const NESTED_LANDSCAPE = `specification {
  element softwareSystem
  element container
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization and capture'
    api = container 'api'
  }

  checkoutWeb -> paymentService.api 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  checkoutWeb -> paymentService.api 'Calls capturePayment' {
    metadata { op 'capturePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/** The same landscape with the authorizePayment consumer edge deleted by hand. */
const NESTED_LANDSCAPE_NO_AUTHORIZE = NESTED_LANDSCAPE.replace(
  `  checkoutWeb -> paymentService.api 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
`,
  "",
);

const PAYMENT_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized

### Requirement: Capture a payment
The service SHALL capture an authorized payment.

Operations: capturePayment

#### Scenario: Successful capture
- **Given** an authorized payment
- **When** capture is requested
- **Then** the funds are captured
`;

const PAYMENT_OPENAPI = `openapi: 3.1.0
info: { title: payment-service, version: "1.0" }
paths:
  /payments:
    post:
      operationId: authorizePayment
      responses: { "200": { description: ok } }
  /payments/capture:
    post:
      operationId: capturePayment
      responses: { "200": { description: ok } }
`;

const CHECKOUT_SPEC = `---
service: checkout-web
status: verified
---

# checkout-web

## Requirements

### Requirement: Take a payment at checkout
The UI SHALL take a payment when the customer confirms the order.

#### Scenario: Customer confirms
- **Given** a basket
- **When** the customer confirms
- **Then** a payment is taken
`;

/** A third living service, so a delta can draw an edge from somewhere new. */
const LEDGER_SPEC = `---
service: ledger-service
status: verified
---

# ledger-service

## Requirements

### Requirement: Record an authorization
The service SHALL record every authorization in the books.

#### Scenario: An authorization is recorded
- **Given** an authorized payment
- **When** the books are written
- **Then** the authorization appears in them
`;

function serviceModel(id: string, variable: string): string {
  return `specification {
  element softwareSystem
  element container
}

model {
  ${variable} = softwareSystem '${id}' {
    api = container 'api'
  }
}

views {
  view of ${variable} {
    include *
  }
}
`;
}

/** Two living services wired only through the nested container above. */
function nestedFleet(landscape = NESTED_LANDSCAPE): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape,
    "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
    "services/payment-service/spec.md": PAYMENT_SPEC,
    "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
    "services/checkout-web/model.likec4": serviceModel("checkout-web", "checkoutWeb"),
    "services/checkout-web/spec.md": CHECKOUT_SPEC,
  };
}

/** A feature that retires authorizePayment: REMOVED requirement + removal marker. */
function retireAuthorize(): Record<string, string> {
  return {
    // The REMOVED requirement carries a Based-On pin because delta.baseline-missing
    // gates archive: an unpinned removal cannot prove the living text it deletes is
    // the text it was written against. The x-loam-remove marker below needs no
    // x-loam-based-on — a marker asserts a slot rather than restating an operation.
    "features/FEAT-10-retire-authorize/specs/payment-service/spec.md": `# payment-service — delta for FEAT-10

## REMOVED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(PAYMENT_SPEC, "Authorize a payment")}

Operations: authorizePayment
`,
    "features/FEAT-10-retire-authorize/specs/payment-service/openapi.yaml": `openapi: 3.1.0
paths:
  /payments:
    post:
      operationId: authorizePayment
      x-loam-remove: true
`,
    // intent.empty gates archive, so the fixture states its Why in one line of prose.
    "features/FEAT-10-retire-authorize/intent.md": `# Retire authorization

The authorizePayment operation is being retired from payment-service.
`,
  };
}

/* ------------------------------------------------------------------ */
/* 1. The removal gate sees a consumer drawn into a container           */
/* ------------------------------------------------------------------ */

describe("the removal gate sees a consumer drawn into a container", () => {
  it("refuses while a nested-container edge still calls the operation", async () => {
    const p = await makeProject({ ...nestedFleet(), ...retireAuthorize() });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-10", "--json");
      // This is exactly the path of lookups.ts's edgeConsumers: the living
      // landscape's relationships are filtered by `resolve(r.target) ===
      // 'payment-service'`, where `resolve` is `serviceResolver(elements, new
      // Set(enumerated fleet))`. The edge's target `paymentService.api` has no
      // explicit binding and its own title ('api') names no services/
      // directory, so only the ancestor walk — paymentService's title
      // 'payment-service', vouched for by the enumeration — attaches the edge.
      // Verified by neutralizing that one line to the pre-fix call
      // (`serviceResolver(livingLandscape.elements)`, no fleet) in a scratch
      // edit: the target then resolves to the phantom 'api', the join finds no
      // consumer, and this very archive PROCEEDS at exit 0 with the living
      // operation deleted out from under its last caller.
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("not-coherent");
      const issue = (payload.issues as Array<{ code: string; message: string }>).find(
        (i) => i.code === "openapi.remove-op-consumed",
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toContain("authorizePayment");
      expect(issue!.message).toContain("edge checkout-web → payment-service");
      expect(issue!.message).toContain("--approve");
      // Refused at the gate: the living contract still serves the operation.
      expect(await p.read("services/payment-service/openapi.yaml")).toContain(
        "operationId: authorizePayment",
      );
    } finally {
      await p.destroy();
    }
  });

  it("archives cleanly once the consuming edge is gone, and the fleet stays green", async () => {
    // The control that makes the refusal above the edge's doing and nothing
    // else's: the identical feature on the identical fleet, minus the one
    // consuming edge, must go through — otherwise the test would pass on any
    // fixture the archive refuses for any reason at all.
    const p = await makeProject({
      ...nestedFleet(NESTED_LANDSCAPE_NO_AUTHORIZE),
      ...retireAuthorize(),
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-10", "--json");
      expect(res.code).toBe(0);
      expect(await p.read("services/payment-service/openapi.yaml")).not.toContain(
        "authorizePayment",
      );

      // The capturePayment edge still lands on the container, and the merged
      // fleet must grade green — validate joins through the same resolver, so
      // a disagreement here would mean archive and validate resolve the same
      // edge to different services.
      const after = await runLoam(p.workDir, "validate", "--all", "--json");
      const report = JSON.parse(after.stdout);
      const errors = (report.targets as Array<{ findings: Array<{ severity: string; message: string }> }>)
        .flatMap((t) => t.findings)
        .filter((f) => f.severity === "error");
      expect(errors).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. The dependency graph resolves container-target edges              */
/* ------------------------------------------------------------------ */

describe("the dependency graph resolves container-target edges", () => {
  it("orders the operation's provider before the feature whose delta calls into the container", async () => {
    // FEAT-1's delta draws its call onto the CONTAINER; FEAT-2 introduces the
    // operation on payment-service. The graph joins the two on (service, op),
    // so the edge exists only if the container target resolves to
    // 'payment-service' through the enumerated fleet — before the fix it
    // resolved to 'api', the keys never met, and the graph answered "these
    // features share nothing", leaving the natural id order FEAT-1, FEAT-2 in
    // place of the dependency order asserted below.
    const p = await makeProject({
      "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
      "features/FEAT-1-caller/delta.likec4": `specification {
  element softwareSystem
  element container
  tag FEAT-1
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service' {
    api = container 'api'
  }

  checkoutWeb -> paymentService.api 'Calls createMandate' {
    #FEAT-1
    metadata { op 'createMandate' }
  }
}

views {
  view feat_1 {
    include *
  }
}
`,
      "features/FEAT-2-provider/specs/payment-service/openapi.yaml": `openapi: 3.1.0
paths:
  /mandates:
    post:
      operationId: createMandate
      responses: { "201": { description: created } }
`,
    });
    try {
      const res = await runLoam(p.workDir, "dependencies", "--json");
      expect(res.code).toBe(0);
      const graph = JSON.parse(res.stdout);
      const edge = (graph.edges as Array<{ from: string; to: string; reasons: unknown[] }>).find(
        (e) => e.from === "FEAT-1" && e.to === "FEAT-2",
      );
      expect(edge).toBeDefined();
      expect(edge!.reasons).toEqual([
        expect.objectContaining({
          kind: "operation",
          service: "payment-service",
          operationId: "createMandate",
        }),
      ]);
      const order = graph.order as string[];
      expect(order.indexOf("FEAT-2")).toBeLessThan(order.indexOf("FEAT-1"));
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. A real service named 'api' beside a modelled container            */
/* ------------------------------------------------------------------ */

/**
 * The collision the phantom used to hide behind: this fleet REALLY has a
 * services/api/ directory, so the name the old fallback invented for the
 * container edge now belongs to somebody. The two edges must land on two
 * different services — the nested one on the container's owner through the
 * ancestor walk, the direct one on the api service itself.
 *
 * The container is titled 'payments api', not 'api', and that spelling is
 * load-bearing: `serviceResolver`'s fleet walk trusts an element's OWN title
 * before its ancestors' (likec4.ts documents the order as nearest-first, the
 * id itself included), so a container literally titled 'api' in THIS fleet
 * resolves to the real api service, ancestor or no ancestor. Whether that
 * nearest-first choice is right for a container nested inside another service
 * is a question about the resolver's order — validate's landscape pass says
 * "what sits INSIDE a service is that service's container" — and this test
 * deliberately does not pin either answer; it pins that the ancestor walk
 * works at all while the colliding directory exists in the enumerated set.
 */
const COLLIDING_LANDSCAPE = `specification {
  element softwareSystem
  element container
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  api = softwareSystem 'api' {
    description 'A gateway whose directory really is services/api'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization and capture'
    api = container 'payments api'
  }

  checkoutWeb -> paymentService.api 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
  checkoutWeb -> api 'Calls listCatalog' {
    metadata { op 'listCatalog' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

const API_SPEC = `---
service: api
status: verified
---

# api

## Requirements

### Requirement: List the catalog
The gateway SHALL list the product catalog.

Operations: listCatalog

#### Scenario: Catalog is served
- **Given** a published catalog
- **When** a client asks for it
- **Then** the catalog is returned
`;

const API_OPENAPI = `openapi: 3.1.0
info: { title: api, version: "1.0" }
paths:
  /catalog:
    get:
      operationId: listCatalog
      responses: { "200": { description: ok } }
`;

describe("a real service named 'api' beside a modelled container", () => {
  it("attributes each consuming edge to its own service", async () => {
    // One feature retires an operation on EACH side of the collision. Both
    // refusals must arrive, each naming its own edge: the nested edge
    // attributed to payment-service proves the ancestor walk was not captured
    // by the colliding directory, and the direct edge attributed to api proves
    // the walk did not overshoot a target that IS the service.
    const p = await makeProject({
      "architecture/landscape.likec4": COLLIDING_LANDSCAPE,
      "services/payment-service/spec.md": PAYMENT_SPEC,
      "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
      "services/checkout-web/spec.md": CHECKOUT_SPEC,
      "services/api/spec.md": API_SPEC,
      "services/api/openapi.yaml": API_OPENAPI,
      "features/FEAT-30-collide/specs/payment-service/spec.md": `# payment-service — delta for FEAT-30

## REMOVED Requirements

### Requirement: Authorize a payment
Based-On: ${pinFor(PAYMENT_SPEC, "Authorize a payment")}

Operations: authorizePayment
`,
      "features/FEAT-30-collide/specs/payment-service/openapi.yaml": `openapi: 3.1.0
paths:
  /payments:
    post:
      operationId: authorizePayment
      x-loam-remove: true
`,
      "features/FEAT-30-collide/specs/api/spec.md": `# api — delta for FEAT-30

## REMOVED Requirements

### Requirement: List the catalog
Based-On: ${pinFor(API_SPEC, "List the catalog")}

Operations: listCatalog
`,
      "features/FEAT-30-collide/specs/api/openapi.yaml": `openapi: 3.1.0
paths:
  /catalog:
    get:
      operationId: listCatalog
      x-loam-remove: true
`,
      "features/FEAT-30-collide/intent.md": `# Retire two operations at once

Both authorizePayment and the gateway's listCatalog are being retired.
`,
    });
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-30", "--json");
      expect(res.code).toBe(1);
      const payload = JSON.parse(res.stdout);
      expect(payload.error.code).toBe("not-coherent");
      const consumed = (payload.issues as Array<{ code: string; subject?: string; message: string }>)
        .filter((i) => i.code === "openapi.remove-op-consumed");

      const nested = consumed.find((i) => i.subject === "payment-service");
      expect(nested).toBeDefined();
      expect(nested!.message).toContain("authorizePayment");
      expect(nested!.message).toContain("edge checkout-web → payment-service");

      const direct = consumed.find((i) => i.subject === "api");
      expect(direct).toBeDefined();
      expect(direct!.message).toContain("listCatalog");
      expect(direct!.message).toContain("edge checkout-web → api");
      // Neither edge crossed over: the nested consumer was not filed under the
      // api service, nor the direct one under payment-service.
      expect(nested!.message).not.toContain("listCatalog");
      expect(direct!.message).not.toContain("authorizePayment");
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4. The checklist resolves through the feature's OWN specs/           */
/* ------------------------------------------------------------------ */

/**
 * The service a feature INTRODUCES has no `services/` directory yet — its
 * `specs/<svc>/` inside the feature is the only place the name exists on disk
 * — so the enumerated fleet alone cannot vouch for it. Model that service with
 * a container of its own and both halves of the resolver are exercised at
 * once: the edge INTO `paymentSplitService.api` and the edge OUT of it.
 */
const INTRODUCED_DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-40
}

model {
  paymentService = softwareSystem 'payment-service'
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-40
    description 'Splits a payment across payees'
    api = container 'api'
  }

  paymentService -> paymentSplitService.api 'Calls createSplit' {
    #FEAT-40
    metadata { op 'createSplit' }
  }
  paymentSplitService.api -> paymentService 'Calls authorizePayment' {
    #FEAT-40
    metadata { op 'authorizePayment' }
  }
}

views {
  view feat_40 {
    include *
  }
}
`;

const SPLIT_SPEC = `# payment-split-service — delta for FEAT-40

## ADDED Requirements

### Requirement: Split a payment
The service SHALL split a payment across payees summing to the total.

Operations: createSplit

#### Scenario: Split across two payees
- **Given** a payment of 100.00
- **When** it is split 60/40
- **Then** two shares are recorded
`;

const SPLIT_OPENAPI = `openapi: 3.1.0
info: { title: payment-split-service, version: "1.0" }
paths:
  /splits:
    post:
      operationId: createSplit
      responses: { "201": { description: created } }
`;

describe("the verify checklist resolves through the feature's own specs/", () => {
  it("asks about the service the feature introduces, never about its container", async () => {
    // Both c4.calls claims name the introduced service because the resolver
    // was handed `enumeratedServiceIds ∪ featureSpecServices`: the ancestor
    // `paymentSplitService` titled 'payment-split-service' is vouched for by
    // the feature's own specs/ directory, so `paymentSplitService.api`
    // resolves to its owner.
    //
    // Established by reverting the one line in a scratch copy of the tree.
    // With `serviceOf(elements, r.source)` — no fleet at all, the shape the
    // checklist had — both endpoints fall through to the container's own
    // title and the claims read "…on api" / subject "api". With the fleet
    // half alone (`new Set(await enumeratedServiceIds(docsDir))`, no
    // specServices) they read the same way, because no services/
    // payment-split-service exists for the walk to recognise: an introduced
    // service is exactly the case the enumeration cannot answer. Either
    // revert breaks the two `toBe` assertions on the claim text below, and
    // the `services` assertion with them.
    const p = await makeProject({
      "services/payment-service/model.likec4": serviceModel("payment-service", "paymentService"),
      "services/payment-service/spec.md": PAYMENT_SPEC,
      "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
      "features/FEAT-40-split/delta.likec4": INTRODUCED_DELTA,
      "features/FEAT-40-split/specs/payment-split-service/spec.md": SPLIT_SPEC,
      "features/FEAT-40-split/specs/payment-split-service/openapi.yaml": SPLIT_OPENAPI,
      "features/FEAT-40-split/intent.md": `# Split payments

A payment is being split across payees by a new service.
`,
    });
    try {
      const res = await runLoam(p.workDir, "verify", "FEAT-40", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      const calls = (payload.claims as Array<{ kind: string; subject: string; claim: string }>)
        .filter((c) => c.kind === "c4.calls");
      expect(calls).toHaveLength(2);

      // The inbound edge: the CALLER owns the claim, and the introduced
      // service is named as the callee rather than its container's title.
      const inbound = calls.find((c) => c.claim.includes("createSplit"));
      expect(inbound).toBeDefined();
      expect(inbound!.claim).toBe("payment-service calls 'createSplit' on payment-split-service");
      expect(inbound!.subject).toBe("payment-service");

      // The outbound edge: the container is the SOURCE, so the phantom would
      // have become the claim's subject — a question filed against a
      // repository that does not exist, which no evidence could ever answer.
      const outbound = calls.find((c) => c.claim.includes("authorizePayment"));
      expect(outbound).toBeDefined();
      expect(outbound!.claim).toBe("payment-split-service calls 'authorizePayment' on payment-service");
      expect(outbound!.subject).toBe("payment-split-service");

      // `services` is the sorted set of claim owners — the lens list an agent
      // picks its `--service` from. A phantom in it invites an attestation
      // nobody can make.
      expect(payload.services).toEqual(["payment-service", "payment-split-service"]);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 5. Arch coverage grades a container-modelled edge as new             */
/* ------------------------------------------------------------------ */

/** A living fleet with ONE edge, checkout-web → payment-service. */
const COVERAGE_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  ledgerService = softwareSystem 'ledger-service' {
    description 'Records the books'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization and capture'
  }

  checkoutWeb -> paymentService 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
}

views {
  view landscape {
    include *
  }
}
`;

/**
 * Two container-targeted edges, one for each half of the resolver's fleet set.
 *
 * `paymentService.split` is the service this feature INTRODUCES, drawn as a
 * container nested inside an existing one — the shape a landscape takes while
 * a new service is still being carved out of its parent. `paymentService.api`
 * is an ordinary container of the existing service, and the edge into it comes
 * from a service the living landscape draws no edge to at all.
 */
const COVERAGE_DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-41
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  ledgerService = softwareSystem 'ledger-service'
  paymentService = softwareSystem 'payment-service' {
    split = container 'payment-split-service' {
      #FEAT-41
    }
    api = container 'api'
  }

  checkoutWeb -> paymentService.split 'Calls createSplit' {
    #FEAT-41
    metadata { op 'createSplit' }
  }
  ledgerService -> paymentService.api 'Calls authorizePayment' {
    #FEAT-41
    metadata { op 'authorizePayment' }
  }
}

views {
  view feat_41 {
    include *
  }
}
`;

interface Finding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
}

/** Every finding of one code across every target of a --json validate run. */
function ofCode(stdout: string, code: string): Finding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: Finding[] }> };
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code === code);
}

describe("arch coverage grades a container-modelled edge as new", () => {
  it("reports the introduced service's edge, and names the owner of the existing one", async () => {
    // The two edges pin the two halves of the resolver's `known` set, and each
    // half fails differently. Established by reverting the source in a scratch
    // copy of the tree, once per half:
    //
    //  · Drop `...featureServices` from the set (the fleet half alone):
    //    `paymentService.split` no longer matches on its own title, the walk
    //    continues to the ancestor `paymentService` — which the enumeration
    //    DOES vouch for — and the edge resolves to checkout-web →
    //    payment-service. That pair is in the living landscape, so the
    //    already-living exemption swallows it: a genuinely new service's
    //    inbound edge disappears from c4.uncovered entirely, and the
    //    `checkout-web → payment-split-service` expectation below fails.
    //
    //  · Drop `known` altogether (`serviceResolver(elements)`, the shape this
    //    module had): `paymentService.api` falls through to the container's
    //    own title, so the second finding arrives as `ledger-service → api`
    //    with subject 'api' — the `→ payment-service` expectation and the
    //    subject list below both fail.
    const p = await makeProject({
      "architecture/landscape.likec4": COVERAGE_LANDSCAPE,
      "services/payment-service/spec.md": PAYMENT_SPEC,
      "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
      "services/checkout-web/spec.md": CHECKOUT_SPEC,
      "services/ledger-service/spec.md": LEDGER_SPEC,
      "features/FEAT-41-split/delta.likec4": COVERAGE_DELTA,
      "features/FEAT-41-split/specs/payment-split-service/spec.md": SPLIT_SPEC.replace(
        "FEAT-40",
        "FEAT-41",
      ),
      "features/FEAT-41-split/specs/payment-split-service/openapi.yaml": SPLIT_OPENAPI,
      "features/FEAT-41-split/intent.md": `# Carve the split out of payments

The split is being carved out of payment-service as a service of its own.
`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-41", "--json");
      const uncovered = ofCode(res.stdout, "c4.uncovered");
      const messages = uncovered.map((f) => f.message);

      // The introduced service's inbound edge is NEW architecture: nothing in
      // the living landscape calls payment-split-service, whatever the box it
      // is currently drawn inside is called.
      expect(messages.some((m) => m.includes("edge checkout-web → payment-split-service"))).toBe(true);
      // The existing service's container edge is new too, and it is filed
      // under the service that owns the container.
      expect(messages.some((m) => m.includes("edge ledger-service → payment-service"))).toBe(true);

      // No finding was filed against the phantom, in either direction: the
      // subject is what a reader goes to fix, and 'api' is not a directory.
      expect([...new Set(uncovered.map((f) => f.subject))].sort()).toEqual([
        "payment-service",
        "payment-split-service",
      ]);
      expect(messages.some((m) => m.includes("→ api"))).toBe(false);
    } finally {
      await p.destroy();
    }
  });

  it("does not re-report an edge the LIVING landscape already draws into that container", async () => {
    // The other side of the same key. A delta has to re-declare the edges it
    // attaches to, so `checkoutWeb -> paymentService.api` appears tagged in the
    // delta AND untagged in the living landscape, and the exemption holds only
    // if both sides resolve the container the same way: the delta's through
    // `svcOf`, the living one through `baseSvcOf`. Both take the fleet set now.
    //
    // Established by reverting `baseSvcOf` alone in a scratch copy of the tree
    // (`serviceResolver(base.elements)`, the shape it had): the living side
    // keys the pair as checkout-web → api while the delta side keys it as
    // checkout-web → payment-service, the two never meet, and the assertion
    // below fails with a c4.uncovered telling the author to cover architecture
    // that has been living in the landscape all along.
    const p = await makeProject({
      ...nestedFleet(),
      "features/FEAT-45-redeclare/delta.likec4": `specification {
  element softwareSystem
  element container
  tag FEAT-45
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service' {
    api = container 'api'
  }

  checkoutWeb -> paymentService.api 'Calls authorizePayment' {
    #FEAT-45
    metadata { op 'authorizePayment' }
  }
}

views {
  view feat_45 {
    include *
  }
}
`,
      "features/FEAT-45-redeclare/intent.md": `# Re-declare the checkout call

The existing checkout call is re-declared so the feature can attach to it.
`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-45", "--json");
      expect(ofCode(res.stdout, "c4.uncovered")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6. A Covers: line may name the service the container belongs to      */
/* ------------------------------------------------------------------ */

/**
 * The living fleet for the Covers case draws NO edge between the two services:
 * the delta's edge has to be new architecture, or the already-living exemption
 * would silence c4.uncovered before the Covers matcher was ever consulted, and
 * the entry would resolve against the living relationship rather than the
 * delta's.
 */
const UNLINKED_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  checkoutWeb = softwareSystem 'checkout-web' {
    description 'Customer-facing checkout UI'
  }
  paymentService = softwareSystem 'payment-service' {
    description 'Owns payment authorization and capture'
  }
}

views {
  view landscape {
    include *
  }
}
`;

const CONTAINER_EDGE_DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-42
}

model {
  checkoutWeb = softwareSystem 'checkout-web'
  paymentService = softwareSystem 'payment-service' {
    api = container 'api'
  }

  checkoutWeb -> paymentService.api 'Calls authorizePayment' {
    #FEAT-42
    metadata { op 'authorizePayment' }
  }
}

views {
  view feat_42 {
    include *
  }
}
`;

/** The feature of section 6, with whatever `Covers:` line the test is about. */
function coversFixture(covers: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": UNLINKED_LANDSCAPE,
    "services/payment-service/spec.md": PAYMENT_SPEC,
    "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
    "services/checkout-web/spec.md": CHECKOUT_SPEC,
    "features/FEAT-42-retry/delta.likec4": CONTAINER_EDGE_DELTA,
    "features/FEAT-42-retry/specs/payment-service/arch.spec.md": `# payment-service — arch delta for FEAT-42

## ADDED Requirements

### Requirement: A retried authorization stays one authorization
The service SHALL treat a retried authorizePayment as the authorization it repeats.
${covers}
#### Scenario: Checkout retries a timed-out authorization
- **Given** an authorization whose response was lost
- **When** checkout retries it
- **Then** exactly one authorization exists
`,
    "features/FEAT-42-retry/intent.md": `# Make the checkout call idempotent

A retried authorization must not authorize twice.
`,
  };
}

describe("a Covers: line may name the service the container belongs to", () => {
  it("matches the edge into the container, and reports no covers.unknown", async () => {
    // This is the exact line the c4.uncovered message asks for — the control
    // below shows the message spelling it — and answering it with
    // `covers.unknown` was the loop the fix closes: do what the finding says
    // and get a second finding for doing it.
    //
    // Established by reverting `coversEdge`'s fourth argument in a scratch
    // copy of the tree (`coversEdge(c, r, elements)` and a CoverageScope with
    // no `known`): `paymentService.api` then resolves to the container's title
    // 'api', the entry's target 'payment-service' matches nothing, and BOTH
    // assertions below fail — the entry is reported unresolved AND the edge it
    // covers is reported uncovered.
    const p = await makeProject(coversFixture("\nCovers: checkout-web -> payment-service\n"));
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-42", "--json");
      expect(ofCode(res.stdout, "covers.unknown")).toEqual([]);
      expect(ofCode(res.stdout, "c4.uncovered")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("and the same feature without it is told, in service names, what to write", async () => {
    // The control: without the Covers: line the fixture is not vacuously
    // green — the finding fires, and it fires naming payment-service, which is
    // what makes the line above the answer to it rather than a guess.
    const p = await makeProject(coversFixture(""));
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-42", "--json");
      const uncovered = ofCode(res.stdout, "c4.uncovered");
      expect(uncovered).toHaveLength(1);
      expect(uncovered[0]!.subject).toBe("payment-service");
      expect(uncovered[0]!.message).toContain("edge checkout-web → payment-service");
    } finally {
      await p.destroy();
    }
  });

  it("resolves the same line in a LIVING arch.spec.md, where no feature is in play", async () => {
    // Service scope reaches the matcher by its own route — `archAxisFindings`
    // builds the CoverageScope, not `deltaArchCoverage` — and a living
    // arch.spec.md is where a fleet's standing architectural obligations
    // actually live, so the two routes disagreeing would mean the same
    // sentence is accepted in a feature delta and rejected once archived into
    // the service it describes.
    //
    // Established by dropping `known` from that scope in a scratch copy of the
    // tree (`{ elements, relationships, health: health.ids }`, the shape
    // `ArchAxis` had): the landscape's `paymentService.api` endpoint resolves
    // to the container's title, the entry's 'payment-service' target matches
    // no relationship, and the assertion below fails with covers.unknown on a
    // line naming a service that plainly exists.
    const p = await makeProject({
      ...nestedFleet(),
      "services/payment-service/arch.spec.md": `---
service: payment-service
status: verified
---

# payment-service — architecture spec

## Requirements

### Requirement: A retried authorization stays one authorization
The service SHALL treat a retried authorizePayment as the authorization it repeats.

Covers: checkout-web -> payment-service

#### Scenario: Checkout retries a timed-out authorization
- **Given** an authorization whose response was lost
- **When** checkout retries it
- **Then** exactly one authorization exists
`,
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--service", "payment-service", "--json");
      expect(ofCode(res.stdout, "covers.unknown")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 7. The delta projection agrees with the gate about the owner         */
/* ------------------------------------------------------------------ */

describe("the delta projection agrees with the gate about the owner", () => {
  it("shows the provider its inbound call and names the provider to the consumer", async () => {
    // `loam delta` is the brief an agent implements from, and it used to
    // disagree with the validator it would then be graded by: for the one
    // edge `checkoutWeb -> paymentService.api`, the provider was told "no
    // architecture change" and the consumer was told it calls 'api'.
    //
    // Established by reverting the call in a scratch copy of the tree to
    // `archSlice(deltaDoc, service, id)` — no fleet set, so `svcOf` falls
    // through to the container's own title. `inbound` comes back empty for
    // payment-service (the toEqual below fails on []) and the consumer's
    // outbound edge comes back with `service: "api"`.
    const p = await makeProject({
      "architecture/landscape.likec4": UNLINKED_LANDSCAPE,
      "services/payment-service/spec.md": PAYMENT_SPEC,
      "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
      "services/checkout-web/spec.md": CHECKOUT_SPEC,
      "features/FEAT-43-retry/delta.likec4": CONTAINER_EDGE_DELTA.replace(/FEAT-42/g, "FEAT-43").replace(
        "feat_42",
        "feat_43",
      ),
      "features/FEAT-43-retry/intent.md": `# Make the checkout call idempotent

A retried authorization must not authorize twice.
`,
    });
    try {
      const call = { service: "checkout-web", op: "authorizePayment", title: "Calls authorizePayment" };

      const provider = await runLoam(p.workDir, "delta", "FEAT-43", "--service", "payment-service", "--json");
      expect(provider.code).toBe(0);
      const providerArch = JSON.parse(provider.stdout).architecture;
      expect(providerArch.inbound).toEqual([call]);
      expect(providerArch.outbound).toEqual([]);

      const consumer = await runLoam(p.workDir, "delta", "FEAT-43", "--service", "checkout-web", "--json");
      expect(consumer.code).toBe(0);
      const consumerArch = JSON.parse(consumer.stdout).architecture;
      expect(consumerArch.outbound).toEqual([
        { ...call, service: "payment-service" },
      ]);
      expect(consumerArch.inbound).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 8. A service the feature introduces, drawn inside an existing one    */
/* ------------------------------------------------------------------ */

/**
 * The `specs/` half of the fleet set, on the two surfaces section 5 does not
 * reach: the Covers matcher and `loam delta`'s projection.
 *
 * The edge is drawn from ledger-service ON PURPOSE. The living landscape draws
 * no ledger-service → payment-service edge, so when the resolver mistakes the
 * introduced service for its parent box the already-living exemption is NOT
 * standing by to swallow the finding — which is what lets one fixture show
 * both halves of the loop the fix closes: the Covers: line the finding asks
 * for must silence it, rather than earning a covers.unknown for obeying.
 */
const INTRODUCED_CONTAINER_DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-44
}

model {
  ledgerService = softwareSystem 'ledger-service'
  paymentService = softwareSystem 'payment-service' {
    split = container 'payment-split-service' {
      #FEAT-44
    }
  }

  ledgerService -> paymentService.split 'Calls createSplit' {
    #FEAT-44
    metadata { op 'createSplit' }
  }
}

views {
  view feat_44 {
    include *
  }
}
`;

/**
 * FEAT-44 on a living fleet of three, with whatever `Covers:` lines the test is
 * about. The element entry is inert with respect to the resolver — `Covers:
 * payment-split-service` matches the container by its own title either way —
 * and is there so the edge assertion can be about an EMPTY finding list rather
 * than about which of two findings is which.
 */
function introducedFixture(covers: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": COVERAGE_LANDSCAPE,
    "services/payment-service/spec.md": PAYMENT_SPEC,
    "services/payment-service/openapi.yaml": PAYMENT_OPENAPI,
    "services/checkout-web/spec.md": CHECKOUT_SPEC,
    "services/ledger-service/spec.md": LEDGER_SPEC,
    "features/FEAT-44-split/delta.likec4": INTRODUCED_CONTAINER_DELTA,
    "features/FEAT-44-split/specs/payment-split-service/spec.md": SPLIT_SPEC.replace(
      "FEAT-40",
      "FEAT-44",
    ),
    "features/FEAT-44-split/specs/payment-split-service/openapi.yaml": SPLIT_OPENAPI,
    "features/FEAT-44-split/specs/payment-split-service/arch.spec.md": `# payment-split-service — arch delta for FEAT-44

## ADDED Requirements

### Requirement: A split is recorded before it is paid out
The service SHALL record every share of a split before any share is paid out.
${covers}
#### Scenario: Shares are recorded first
- **Given** a payment to split
- **When** the split is requested
- **Then** every share is recorded before payout
`,
    "features/FEAT-44-split/intent.md": `# Carve the split out of payments

The split is being carved out of payment-service as a service of its own.
`,
  };
}

describe("a service the feature introduces, drawn inside an existing one", () => {
  it("accepts a Covers: line naming it, though only its own specs/ knows the name", async () => {
    // The enumerated fleet cannot vouch for payment-split-service — there is no
    // services/ directory for it yet, which is what "introduced" means — so the
    // matcher only reaches it through the feature's own specs/ names.
    //
    // Established by dropping `...featureServices` from `known` in a scratch
    // copy of the tree: `paymentService.split` then resolves to the parent
    // payment-service, the entry's 'payment-split-service' target matches
    // nothing, and BOTH assertions fail — covers.unknown on the line, and
    // c4.uncovered on the very edge that line was written to cover.
    const p = await makeProject(
      introducedFixture("\nCovers: payment-split-service, ledger-service -> payment-split-service\n"),
    );
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-44", "--json");
      expect(ofCode(res.stdout, "covers.unknown")).toEqual([]);
      expect(ofCode(res.stdout, "c4.uncovered")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("and without the line is told to cover an edge into the service, not into the box", async () => {
    // The control, and the reason the line above is an ANSWER rather than a
    // guess: the finding it silences exists, and it is phrased in the service
    // names the fixture then writes back.
    const p = await makeProject(introducedFixture(""));
    try {
      const res = await runLoam(p.workDir, "validate", "--feature", "FEAT-44", "--json");
      const edge = ofCode(res.stdout, "c4.uncovered").find((f) => f.message.includes("edge "));
      expect(edge).toBeDefined();
      expect(edge!.subject).toBe("payment-split-service");
      expect(edge!.message).toContain("edge ledger-service → payment-split-service");
    } finally {
      await p.destroy();
    }
  });

  it("gets the inbound call in its own delta brief, and its parent does not", async () => {
    // `loam delta --service payment-split-service` is the brief the agent
    // building the new service reads. The projection unions the feature's own
    // specs/ names into the fleet set for exactly this case; without them the
    // call is filed under the box the service is currently drawn inside, so the
    // agent building it sees no inbound call at all and the parent's agent sees
    // one it is not being asked to serve.
    //
    // Established by reverting the call in a scratch copy of the tree to
    // `archSlice(deltaDoc, service, id, new Set(living))` — the enumerated half
    // alone: the introduced service's `inbound` comes back `[]` and
    // payment-service's comes back holding the createSplit call, so both
    // assertions below fail.
    const p = await makeProject(introducedFixture(""));
    try {
      const introduced = await runLoam(p.workDir, "delta", "FEAT-44", "--service", "payment-split-service", "--json");
      expect(introduced.code).toBe(0);
      const arch = JSON.parse(introduced.stdout).architecture;
      expect(arch.isNew).toBe(true);
      expect(arch.inbound).toEqual([
        { service: "ledger-service", op: "createSplit", title: "Calls createSplit" },
      ]);

      const parent = await runLoam(p.workDir, "delta", "FEAT-44", "--service", "payment-service", "--json");
      expect(parent.code).toBe(0);
      expect(JSON.parse(parent.stdout).architecture.inbound).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});
