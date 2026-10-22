/**
 * How loam reads a relationship's direction and spelling, and the three places
 * where it used to decide something in silence (SCHEMA.md, "Which way an edge
 * points"):
 *
 *  - the consumer census behind `landscape.datastore-shared` and
 *    `landscape.platform-candidate` counted an infrastructure element's users
 *    only where they were drawn as an edge's SOURCE, so a read drawn as the
 *    data's flow (`store -> service`) and every consumer drawn the way loam's
 *    own event doctrine asks (`topic -> service`) went uncounted;
 *  - a `publishes`/`consumes` key on the wrong end of its edge bound nothing
 *    and said nothing, at service scope and feature scope alike: now
 *    `spine.message-unbound`;
 *  - a `Covers:` entry spelled the way a kinded edge is written,
 *    `a -[kind]-> b`, split at the `->` after the `]` and was `covers.unknown`.
 *
 * Neutral shapes only: order-service, payment-service, billing-service, a
 * kafka broker and a ledger store.
 */
import { describe, expect, it } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

interface Finding {
  severity: "ok" | "warn" | "error";
  code: string;
  subject?: string;
  message: string;
}
interface Target {
  kind: string;
  id: string;
  findings: Finding[];
}

async function withProject(files: Record<string, string>, fn: (p: Project) => Promise<void>): Promise<void> {
  const p = await makeProject(files);
  // `subsystem.views-stale` on every `--all` run otherwise — landscape.test.ts says why.
  await runLoam(p.workDir, "subsystem", "sync");
  try {
    await fn(p);
  } finally {
    await p.destroy();
  }
}

async function validate(p: Project, ...args: string[]): Promise<{ code: number; targets: Target[] }> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  return { code: res.code, targets: (JSON.parse(res.stdout) as { targets: Target[] }).targets };
}

const findingsIn = (targets: Target[], code: string): Finding[] =>
  targets.flatMap((t) => t.findings.filter((f) => f.code === code));

function landscape(body: string): string {
  return `specification {
  element softwareSystem
  element container
  element database
  element topic
  element person
  tag external
  tag platform
}

model {
  orderService = softwareSystem 'order-service' {
    metadata { service 'order-service' }
  }
  paymentService = softwareSystem 'payment-service' {
    metadata { service 'payment-service' }
  }
  billingService = softwareSystem 'billing-service' {
    metadata { service 'billing-service' }
  }
${body}
}

views {
  view landscape {
    include *
  }
}
`;
}

/** The smallest standalone model a service target passes with. */
function serviceModel(svc: string): string {
  return `specification { element softwareSystem }

model {
  s = softwareSystem '${svc}'
}

views {
  view index {
    include *
  }
}
`;
}

/** An extending model: parsed inside the map's project, so its ids ARE the map's. */
function extendingModel(body: string): string {
  return `model {
${body}
}
`;
}

/** One message on one channel, sent or received — the two halves of the payment.Captured spine. */
function asyncapi(svc: string, action: "send" | "receive"): string {
  return `asyncapi: 3.0.0
info:
  title: ${svc} events
  version: "1.0"
channels:
  paymentEvents:
    address: payment.events.v1
    messages:
      Captured:
        $ref: '#/components/messages/Captured'
operations:
  ${action}Captured:
    action: ${action}
    channel:
      $ref: '#/channels/paymentEvents'
components:
  messages:
    Captured:
      name: payment.Captured
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;
}

function threeModels(): Record<string, string> {
  return {
    "services/order-service/model.likec4": serviceModel("order-service"),
    "services/payment-service/model.likec4": serviceModel("payment-service"),
    "services/billing-service/model.likec4": serviceModel("billing-service"),
  };
}

const KAFKA = `  kafka = softwareSystem 'kafka' {
    #external
    paymentEvents = topic 'payment.events'
  }`;

describe("the consumer census counts a service at either end of an edge into infrastructure", () => {
  it("counts a reader drawn as the data's flow — store -> service — as a second consumer of the store", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  ledgerDb = database 'ledger-db'
  orderService -> ledgerDb 'Writes ledger rows'
  ledgerDb -> billingService 'Feeds invoicing'`),
      ...threeModels(),
    };
    await withProject(files, async (p) => {
      const { targets } = await validate(p, "--all");
      const [f, ...rest] = findingsIn(targets, "landscape.datastore-shared");
      expect(f, "the reversed reader was not counted").toBeDefined();
      expect(rest).toEqual([]);
      expect(f!.subject).toBe("ledger-db");
      expect(f!.message).toContain("shared by 2 services (billing-service, order-service)");
    });
  });

  it("counts an inbound call an extending model draws FROM the store", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  ledgerDb = database 'ledger-db'
  orderService -> ledgerDb 'Writes ledger rows'`),
      "services/order-service/model.likec4": serviceModel("order-service"),
      "services/payment-service/model.likec4": serviceModel("payment-service"),
      "services/billing-service/model.likec4": extendingModel(`  extend billingService {
    api = container 'api'
  }
  ledgerDb -> billingService.api 'Feeds invoicing'`),
    };
    await withProject(files, async (p) => {
      const { targets } = await validate(p, "--all");
      const [f] = findingsIn(targets, "landscape.datastore-shared");
      expect(f, "the model's inbound call from the store was not counted").toBeDefined();
      expect(f!.message).toContain("(billing-service, order-service)");
    });
  });

  it("counts a broker's consumers drawn topic -> service toward landscape.platform-candidate", async () => {
    // loam's own event doctrine draws every consumer this way round, so a
    // census reading only the source end counted the publisher alone.
    const files = {
      "architecture/landscape.likec4": landscape(`${KAFKA}
  paymentService -> kafka.paymentEvents 'Publishes Captured'
  kafka.paymentEvents -> orderService 'Captured completes the order'
  kafka.paymentEvents -> billingService 'Captured opens an invoice'`),
      ...threeModels(),
    };
    await withProject(files, async (p) => {
      const { targets } = await validate(p, "--all");
      const [f] = findingsIn(targets, "landscape.platform-candidate");
      expect(f, "the topic's consumers were not counted").toBeDefined();
      expect(f!.subject).toBe("kafka");
      expect(f!.message).toContain("consumed by 3 services (billing-service, order-service, payment-service)");
    });
  });

  it("still reads the arrow out of a system that is not infrastructure — a caller INTO the fleet is not consumed", async () => {
    const files = {
      "architecture/landscape.likec4": landscape(`  identityProvider = softwareSystem 'identity-provider' {
    #external
  }
  identityProvider -> orderService 'Pushes revocations'
  identityProvider -> paymentService 'Pushes revocations'
  identityProvider -> billingService 'Pushes revocations'`),
      ...threeModels(),
    };
    await withProject(files, async (p) => {
      const { targets } = await validate(p, "--all");
      expect(findingsIn(targets, "landscape.platform-candidate")).toEqual([]);
    });
  });
});

/** A living spec whose one requirement governs the message, so the spine can call itself covered. */
function eventSpec(svc: string, line: string): string {
  return `---
service: ${svc}
status: draft
---

# ${svc}

## Requirements

### Requirement: Handle a captured payment

The service SHALL act on every captured payment exactly once.

${line}

#### Scenario: A payment is captured
- **Given** an authorized payment
- **When** it is captured
- **Then** the capture is acted on once
`;
}

/** payment-service publishes payment.Captured to the topic; billing-service consumes it. */
function eventFleet(edges: string): Record<string, string> {
  return {
    "architecture/landscape.likec4": landscape(`${KAFKA}
  crm = softwareSystem 'crm' {
    #external
  }
  crm -> kafka.paymentEvents 'Publishes CustomerUpdated' {
    metadata { publishes 'crm.CustomerUpdated' }
  }
${edges}`),
    ...threeModels(),
    "services/payment-service/asyncapi.yaml": asyncapi("payment-service", "send"),
    "services/billing-service/asyncapi.yaml": asyncapi("billing-service", "receive"),
    "services/payment-service/spec.md": eventSpec("payment-service", "Publishes: payment.Captured"),
    "services/billing-service/spec.md": eventSpec("billing-service", "Consumes: payment.Captured"),
  };
}

const PUBLISH = `  paymentService -> kafka.paymentEvents 'Publishes Captured' {
    metadata { publishes 'payment.Captured' }
  }`;
const CONSUME = `  kafka.paymentEvents -> billingService 'Captured opens an invoice' {
    metadata { consumes 'payment.Captured' }
  }`;

describe("spine.message-unbound: an event key on the wrong end of its edge", () => {
  it("is silent on the drawing the doctrine asks for — and on an #external party at the bound end, which the key describes truly", async () => {
    // An outside producer drawn straight at its consumer, and a fleet producer
    // drawn straight at an outside consumer: the bound end is no service, and
    // the key is still right — it is not a topic, so nothing is reversed.
    const outside = `  partner = softwareSystem 'partner' {
    #external
  }
  crm -> billingService 'Pushes CustomerUpdated' {
    metadata { publishes 'crm.CustomerUpdated' }
  }
  paymentService -> partner 'Captured settles the partner ledger' {
    metadata { consumes 'payment.Captured' }
  }`;
    await withProject(eventFleet(`${PUBLISH}\n${CONSUME}\n${outside}`), async (p) => {
      const { code, targets } = await validate(p, "--all");
      expect(findingsIn(targets, "spine.message-unbound")).toEqual([]);
      expect(findingsIn(targets, "spine.message-undefined")).toEqual([]);
      const payment = targets.find((t) => t.id === "payment-service")!;
      expect(payment.findings.map((f) => f.code)).toContain("event.covered");
      expect(code).toBe(0);
    });
  });

  it("says to split an edge that carries both keys, where turning it round only moves the warning", async () => {
    const both = `  billingService -> kafka.paymentEvents 'Reads captures, writes invoices' {
    metadata {
      publishes 'billing.Invoiced'
      consumes 'payment.Captured'
    }
  }`;
    await withProject(eventFleet(`${PUBLISH}\n${both}`), async (p) => {
      const { targets } = await validate(p, "--service", "billing-service");
      const [f, ...rest] = findingsIn(targets, "spine.message-unbound");
      expect(f, "the topic-bound consume key was silent").toBeDefined();
      expect(rest).toEqual([]);
      expect(f!.message).toContain("move consumes 'payment.Captured' onto an edge of its own, kafka.paymentEvents -> billingService");
      expect(f!.message).not.toContain("draw it");
    });
  });

  it("warns on the consumer when its consume edge points at the topic, and the spine stops calling it covered", async () => {
    const reversed = `  billingService -> kafka.paymentEvents 'Captured opens an invoice' {
    metadata { consumes 'payment.Captured' }
  }`;
    await withProject(eventFleet(`${PUBLISH}\n${reversed}`), async (p) => {
      const { code, targets } = await validate(p, "--all");
      // A warning: the drawing is legal and nothing that used to pass fails now.
      expect(code).toBe(0);
      const [f, ...rest] = findingsIn(targets, "spine.message-unbound");
      expect(f, "the reversed consume edge was still silent").toBeDefined();
      expect(rest).toEqual([]);
      expect(f!.severity).toBe("warn");
      expect(f!.subject).toBe("billing-service");
      expect(f!.message).toContain("consumes 'payment.Captured'");
      expect(f!.message).toContain("binds the edge's TARGET");
      expect(f!.message).toContain("draw it kafka.paymentEvents -> billingService");
      const billing = targets.find((t) => t.id === "billing-service")!;
      expect(billing.findings.map((f) => f.code)).not.toContain("event.covered");
    });
  });

  it("warns on the producer when its publish edge points from the topic", async () => {
    const reversed = `  kafka.paymentEvents -> paymentService 'Publishes Captured' {
    metadata { publishes 'payment.Captured' }
  }`;
    await withProject(eventFleet(`${reversed}\n${CONSUME}`), async (p) => {
      const { targets } = await validate(p, "--service", "payment-service");
      const [f] = findingsIn(targets, "spine.message-unbound");
      expect(f, "the reversed publish edge was still silent").toBeDefined();
      expect(f!.subject).toBe("payment-service");
      expect(f!.message).toContain("binds the edge's SOURCE");
      expect(f!.message).toContain("draw it paymentService -> kafka.paymentEvents");
    });
  });

  it("is graded at feature scope too, on a tagged consume edge the delta draws the wrong way round", async () => {
    const living = landscape(`${KAFKA}
${PUBLISH}`);
    const delta = (edge: string): string => `specification {
  element softwareSystem
  element topic
  tag FEAT-1
}

model {
  kafka = softwareSystem 'kafka' {
    paymentEvents = topic 'payment.events'
  }
  billingService = softwareSystem 'billing-service'
${edge}
}

views {
  view feat_1 {
    include *
  }
}
`;
    const files = (edge: string): Record<string, string> => ({
      ...eventFleet(PUBLISH),
      "architecture/landscape.likec4": living,
      "features/FEAT-1-invoices/intent.md": `---\nfeature: FEAT-1\nstatus: proposed\n---\n\n# Invoice on capture\n\nOpen an invoice when a payment is captured.\n`,
      "features/FEAT-1-invoices/delta.likec4": delta(edge),
    });
    const reversed = `  billingService -> kafka.paymentEvents 'Captured opens an invoice' {
    #FEAT-1
    metadata { consumes 'payment.Captured' }
  }`;
    await withProject(files(reversed), async (p) => {
      const { targets } = await validate(p, "--feature", "FEAT-1");
      const [f] = findingsIn(targets, "spine.message-unbound");
      expect(f, "the delta's reversed consume edge was still silent").toBeDefined();
      expect(f!.severity).toBe("warn");
      expect(f!.message).toContain("draw it kafka.paymentEvents -> billingService");
    });
    const forward = `  kafka.paymentEvents -> billingService 'Captured opens an invoice' {
    #FEAT-1
    metadata { consumes 'payment.Captured' }
  }`;
    await withProject(files(forward), async (p) => {
      const { targets } = await validate(p, "--feature", "FEAT-1");
      expect(findingsIn(targets, "spine.message-unbound")).toEqual([]);
    });
  });
});

/** order-service's own model, with a kinded edge between two of its containers. */
const KINDED_MODEL = `specification {
  element softwareSystem
  element container
  relationship async
}

model {
  orderService = softwareSystem 'order-service' {
    api = container 'api'
    outbox = container 'outbox'
  }
  orderService.api -[async]-> orderService.outbox 'Stages OrderPlaced'
}

views {
  view index {
    include *
  }
}
`;

function archSpec(covers: string): string {
  return `---
service: order-service
status: draft
---

# order-service — architecture spec

## Requirements

### Requirement: OrderPlaced is staged in the outbox

The service SHALL stage every OrderPlaced in the outbox inside the order's own transaction.

Covers: ${covers}

#### Scenario: The broker is down when an order is placed
- **Given** an accepted order
- **When** the broker is unreachable
- **Then** OrderPlaced waits in the outbox until the broker returns
`;
}

describe("a Covers: edge entry spelled with the relationship's kind", () => {
  const files = (covers: string): Record<string, string> => ({
    "architecture/landscape.likec4": landscape(""),
    "services/order-service/model.likec4": KINDED_MODEL,
    "services/order-service/arch.spec.md": archSpec(covers),
  });

  it("resolves `a -[kind]-> b` exactly as `a -> b` does", async () => {
    for (const covers of ["orderService.api -[async]-> orderService.outbox", "orderService.api -> orderService.outbox"]) {
      await withProject(files(covers), async (p) => {
        const { targets } = await validate(p, "--service", "order-service");
        expect(findingsIn(targets, "covers.unknown"), covers).toEqual([]);
      });
    }
  });

  it("is no free pass — a kinded entry naming an edge the model does not draw is still covers.unknown", async () => {
    await withProject(files("orderService.outbox -[async]-> orderService.api"), async (p) => {
      const { targets } = await validate(p, "--service", "order-service");
      const [f] = findingsIn(targets, "covers.unknown");
      expect(f, "a reversed kinded entry resolved").toBeDefined();
      expect(f!.message).toContain("orderService.outbox -[async]-> orderService.api");
    });
  });

  it("counts toward a feature's coverage — the kinded entry answers c4.uncovered for the edge the delta adds", async () => {
    const fixture = coherentFixture();
    const kindedDelta = fixture["features/FEAT-1-split/delta.likec4"]!.replace(
      "  tag FEAT-1",
      "  relationship async\n  tag FEAT-1",
    ).replace("paymentService -> paymentSplitService", "paymentService -[async]-> paymentSplitService");
    const featureArch = `# payment-split-service — architecture delta for FEAT-1

## ADDED Requirements

### Requirement: createSplit is idempotent under retries

The service SHALL treat createSplit as idempotent by payment id.

Covers: payment-split-service, payment-service -[async]-> payment-split-service

#### Scenario: payment-service retries createSplit
- **Given** a split already recorded for a payment
- **When** the same createSplit arrives again
- **Then** the original split is returned
`;
    const living = fixture["architecture/landscape.likec4"]!.replace(
      "  element person",
      "  element person\n  relationship async",
    );
    const all = {
      ...fixture,
      "architecture/landscape.likec4": living,
      "features/FEAT-1-split/delta.likec4": kindedDelta,
      "features/FEAT-1-split/specs/payment-split-service/arch.spec.md": featureArch,
    };
    await withProject(all, async (p) => {
      const { targets } = await validate(p, "--feature", "FEAT-1");
      expect(findingsIn(targets, "covers.unknown")).toEqual([]);
      expect(findingsIn(targets, "c4.uncovered")).toEqual([]);
    });
  });
});
