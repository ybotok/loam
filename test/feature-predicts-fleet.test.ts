/**
 * The feature gate predicts the fleet its archive leaves.
 *
 * Every case here is one the real-fleet review (2026-10-21) found: a feature
 * that `validate --feature` called clean — `loam status` said "ready", and the
 * archive gate agreed — archived at exit 0 under "living spec + landscape are
 * now complete + current.", and the next `validate --all` reported the fleet
 * red. Each is reproduced on a copy of the shipped example and nothing else.
 *
 * Every case pins BOTH halves: the finding the feature scope now raises before
 * the archive, and the finding `validate --all` raises after it (the archive
 * forced with `--approve` where the gate now refuses). Pinning the prediction
 * to the outcome it predicts is the point — a gate that grew stricter than the
 * fleet would be as wrong as one that was laxer, and either change breaks a
 * case here.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cp, readdir, rm } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Finding } from "../src/core/vocabulary/report.js";
import { makeTmpDir, pinFor, runLoam } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const SHIPPED_EXAMPLE = fileURLToPath(new URL("../examples/docs", import.meta.url));

interface Fleet {
  dir: string;
  read(rel: string): string;
  write(rel: string, text: string): void;
}

/**
 * A byte copy of the shipped example — its loam.json names itself as the docs
 * root — holding only the in-flight features a case names, so no other
 * feature's findings stand beside the ones graded.
 */
async function exampleFleet(keep: readonly string[] = []): Promise<Fleet> {
  const root = await makeTmpDir("loam-predicts-");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "fleet");
  await cp(SHIPPED_EXAMPLE, dir, { recursive: true });
  for (const entry of await readdir(join(dir, "features"))) {
    if (entry !== "archive" && !keep.includes(entry)) await rm(join(dir, "features", entry), { recursive: true });
  }
  return {
    dir,
    read: (rel) => readFileSync(join(dir, rel), "utf8"),
    write: (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text, "utf8");
    },
  };
}

/** The intent a feature needs before anything else is graded. */
function intent(f: Fleet, dirName: string, services: readonly string[]): void {
  const id = /^FEAT-\d+/.exec(dirName)![0];
  f.write(
    `features/${dirName}/intent.md`,
    `---\nfeature: ${id}\ntitle: ${dirName}\nstatus: in_progress\nowner: orders-team\nservices: [${services.join(", ")}]\n---\n\n# ${id}\n\n## Why\nThe fleet needs it.\n`,
  );
}

async function findingsOf(dir: string, ...args: string[]): Promise<Finding[]> {
  const run = await runLoam(dir, "validate", ...args, "--json");
  return (JSON.parse(run.stdout) as { targets: Array<{ findings: Finding[] }> }).targets.flatMap((t) => t.findings);
}

const ofCode = (all: readonly Finding[], code: string): Finding[] => all.filter((f) => f.code === code);

/** Archive, refused first where the gate refuses, then forced — the fleet `validate --all` is about to grade. */
async function archiveForced(dir: string, id: string): Promise<string> {
  const refused = await runLoam(dir, "archive", id, "--json");
  expect(refused.code).toBe(1);
  expect((JSON.parse(refused.stdout) as { error: { code: string } }).error.code).toBe("not-coherent");
  const forced = await runLoam(dir, "archive", id, "--approve");
  expect(forced.code).toBe(0);
  // The claim the review caught printing over a red fleet, withheld.
  expect(forced.stdout).not.toContain("complete + current");
  return forced.stdout;
}

/* ------------------------------------------------------------------ */
/* 1. A consumer the feature adds, with nothing to send its message    */
/* ------------------------------------------------------------------ */

const SHIPMENT_CONSUMER_SPEC = `# order-service — delta for FEAT-201

## ADDED Requirements

### Requirement: A dispatched shipment ships the order

Requirement-ID: ORD-SHIPPED
The service SHALL mark an order shipped when its shipment is dispatched.

Consumes: shipping.ShipmentDispatched

#### Scenario: Shipment dispatched
- **Given** a paid order
- **When** its shipment is dispatched
- **Then** the order is marked shipped
`;

/** An event contract delta declaring one message in one direction. */
function shipmentContract(title: string, action: "send" | "receive"): string {
  return `asyncapi: 3.0.0
info:
  title: ${title}
  version: "1.0"
channels:
  shipmentEvents:
    address: shipment.events.v1
    messages:
      ShipmentDispatched:
        $ref: '#/components/messages/ShipmentDispatched'
operations:
  ${action}ShipmentDispatched:
    action: ${action}
    channel:
      $ref: '#/channels/shipmentEvents'
    messages:
      - $ref: '#/channels/shipmentEvents/messages/ShipmentDispatched'
components:
  messages:
    ShipmentDispatched:
      name: shipping.ShipmentDispatched
      payload:
        type: object
        properties:
          orderId:
            type: string
`;
}

function shipmentConsumer(f: Fleet): void {
  intent(f, "FEAT-201-shipments", ["order-service"]);
  f.write("features/FEAT-201-shipments/specs/order-service/spec.md", SHIPMENT_CONSUMER_SPEC);
  f.write("features/FEAT-201-shipments/specs/order-service/asyncapi.yaml", shipmentContract("order-service events", "receive"));
}

describe("a consumer this feature adds, with nothing to send its message", () => {
  it("is spine.message-unproduced before the archive — the error validate --all reports once it lands", async () => {
    const f = await exampleFleet();
    shipmentConsumer(f);

    const before = ofCode(await findingsOf(f.dir, "--feature", "FEAT-201"), "spine.message-unproduced");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ severity: "error", subject: "order-service" });
    expect(before[0]!.message).toContain("requirement 'A dispatched shipment ships the order'");

    await archiveForced(f.dir, "FEAT-201");
    const after = ofCode(await findingsOf(f.dir, "--all"), "spine.message-unproduced");
    expect(after.map((x) => [x.severity, x.subject])).toEqual([["error", "order-service"]]);
  });

  it("is satisfied by an #external publisher the same delta draws — the map the merge leaves sends it", async () => {
    const f = await exampleFleet();
    shipmentConsumer(f);
    f.write(
      "features/FEAT-201-shipments/delta.likec4",
      `specification {
  element group
  element softwareSystem
  tag external
  tag FEAT-201
}
model {
  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      metadata {
        service 'order-service'
      }
    }
  }
  carrier = softwareSystem 'carrier' {
    #external
    #FEAT-201
    description 'The parcel carrier'
  }
  carrier -> marketplace.orderService 'Publishes ShipmentDispatched' {
    #FEAT-201
    metadata {
      publishes 'shipping.ShipmentDispatched'
    }
  }
}
`,
    );

    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-201"), "spine.message-unproduced")).toEqual([]);
    const archived = await runLoam(f.dir, "archive", "FEAT-201");
    expect(archived.code).toBe(0);
    expect(ofCode(await findingsOf(f.dir, "--all"), "spine.message-unproduced")).toEqual([]);
  });

  it("is satisfied by a LIVING #external system the delta re-declares as an untagged stub — the merge keeps its tag", async () => {
    // A delta quotes the neighbourhood its edges attach to, and a quote carries
    // no tags: `salesforce` is #external on the living map, a bare stub here.
    // The tagged edge lands, the living element keeps its tag, and the fleet
    // `validate --all` reads has the producer — so the gate must too.
    const f = await exampleFleet();
    shipmentConsumer(f);
    f.write(
      "features/FEAT-201-shipments/delta.likec4",
      `specification {
  element group
  element softwareSystem
  tag FEAT-201
}
model {
  marketplace = group 'Marketplace' {
    orderService = softwareSystem 'order-service' {
      metadata {
        service 'order-service'
      }
    }
  }
  salesforce = softwareSystem 'salesforce'
  salesforce -> marketplace.orderService 'Publishes ShipmentDispatched' {
    #FEAT-201
    metadata {
      publishes 'shipping.ShipmentDispatched'
    }
  }
}
`,
    );

    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-201"), "spine.message-unproduced")).toEqual([]);
    const archived = await runLoam(f.dir, "archive", "FEAT-201");
    expect(archived.code).toBe(0);
    expect(ofCode(await findingsOf(f.dir, "--all"), "spine.message-unproduced")).toEqual([]);
  });

  it("is softened to a pending warning while its only sender is in flight, and the archive withholds its closing line", async () => {
    const f = await exampleFleet();
    shipmentConsumer(f);
    intent(f, "FEAT-202-shipping", ["payment-service"]);
    f.write("features/FEAT-202-shipping/specs/payment-service/asyncapi.yaml", shipmentContract("payment-service events", "send"));
    f.write(
      "features/FEAT-202-shipping/specs/payment-service/spec.md",
      `# payment-service — delta for FEAT-202

## ADDED Requirements

### Requirement: A dispatched shipment is announced

Requirement-ID: PAY-DISPATCH
The service SHALL announce a dispatched shipment.

Publishes: shipping.ShipmentDispatched

#### Scenario: Dispatch
- **Given** a paid order
- **When** it ships
- **Then** ShipmentDispatched is published
`,
    );

    const before = await findingsOf(f.dir, "--feature", "FEAT-201");
    expect(ofCode(before, "spine.message-unproduced")).toEqual([]);
    const pending = ofCode(before, "spec-event.message-pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.message).toContain("in-flight FEAT-202");

    const archived = await runLoam(f.dir, "archive", "FEAT-201");
    expect(archived.code).toBe(0);
    expect(archived.stdout).not.toContain("complete + current");
    expect(archived.stdout).toContain("ahead of 1 change(s) still in flight");
    expect(ofCode(await findingsOf(f.dir, "--service", "order-service"), "spine.message-unproduced")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* 2–3. A feature's own flows, graded as the fleet will grade them     */
/* ------------------------------------------------------------------ */

/**
 * A requirement tag the map declares and no capability document carries yet —
 * declared, so a flow carrying it PARSES and only the grade can convict it.
 * Either line ending: the example is checked out CRLF on Windows.
 */
function declareTwice(f: Fleet): void {
  const map = f.read("architecture/landscape.likec4");
  const declared = map.replace(/( {2}tag req-NOTIFY-ONCE)(\r?\n)/, "$1$2  tag req-NOTIFY-TWICE$2");
  expect(declared).not.toBe(map);
  f.write("architecture/landscape.likec4", declared);
}

function flow(f: Fleet, dirName: string, body: string): void {
  intent(f, dirName, ["checkout-web"]);
  f.write(`features/${dirName}/usecases/journey.likec4`, `views {\n${body}\n}\n`);
}

describe("a feature flow's #req- tag", () => {
  it("that no #cap- tag scopes, or that names no requirement, is usecase.requirement-unresolved before the archive", async () => {
    const f = await exampleFleet();
    declareTwice(f);
    flow(
      f,
      "FEAT-203-flows",
      `  dynamic view uc_unscoped {
    #req-NOTIFY-ONCE
    title 'Unscoped'
    marketplace.checkoutWeb -> marketplace.orderService 'places the order'
  }
  dynamic view uc_unknown {
    #cap-order-notifications
    #req-NOTIFY-TWICE
    title 'Unknown'
    marketplace.checkoutWeb -> marketplace.orderService 'places the order'
  }`,
    );

    const before = ofCode(await findingsOf(f.dir, "--feature", "FEAT-203"), "usecase.requirement-unresolved");
    expect(before.map((x) => [x.severity, x.subject])).toEqual([
      ["error", "uc_unknown"],
      ["error", "uc_unscoped"],
    ]);
    // Named by the file the author is still editing, never the living path.
    for (const x of before) expect(x.message).toContain("features/FEAT-203-flows/usecases/journey.likec4 — dynamic view");

    await archiveForced(f.dir, "FEAT-203");
    const after = ofCode(await findingsOf(f.dir, "--all"), "usecase.requirement-unresolved");
    expect(after.map((x) => x.subject).sort()).toEqual(["uc_unknown", "uc_unscoped"]);
  });

  it("resolves against a requirement the same feature's capability delta adds — the merge lands both", async () => {
    const f = await exampleFleet();
    declareTwice(f);
    flow(
      f,
      "FEAT-203-flows",
      `  dynamic view uc_twice {
    #cap-order-notifications
    #req-NOTIFY-TWICE
    title 'Twice'
    marketplace.checkoutWeb -> marketplace.orderService 'places the order'
  }`,
    );
    f.write(
      "features/FEAT-203-flows/capabilities/order-notifications/spec.md",
      `# Order notifications — delta

## ADDED Requirements

### Requirement: A cancelled order is told once
Requirement-ID: NOTIFY-TWICE
The fleet SHALL tell a customer once that their order was cancelled.

#### Scenario: The order is cancelled
- **Given** a placed order
- **When** it is cancelled
- **Then** the customer receives one cancellation notice
`,
    );

    const before = await findingsOf(f.dir, "--feature", "FEAT-203");
    expect(ofCode(before, "usecase.requirement-unresolved")).toEqual([]);
    expect(ofCode(before, "capability.uncovered")).toEqual([]);
  });
});

describe("a feature flow's hop", () => {
  const RECEIPT = `  dynamic view uc_receipt {
    #cap-order-notifications
    title 'Receipt'
    marketplace.checkoutWeb -> marketplace.notificationService 'asks for a receipt'
  }`;

  it("between two services nothing connects is usecase.step-unbacked before the archive", async () => {
    const f = await exampleFleet();
    flow(f, "FEAT-204-receipt", RECEIPT);

    const before = ofCode(await findingsOf(f.dir, "--feature", "FEAT-204"), "usecase.step-unbacked");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ severity: "error", subject: "uc_receipt" });
    expect(before[0]!.message).toContain("features/FEAT-204-receipt/usecases/journey.likec4 — dynamic view 'uc_receipt' step 1");
    expect(before[0]!.locations?.[0]).toEqual({ path: "features/FEAT-204-receipt/usecases/journey.likec4", role: "primary" });

    await archiveForced(f.dir, "FEAT-204");
    expect(ofCode(await findingsOf(f.dir, "--all"), "usecase.step-unbacked").map((x) => x.subject)).toEqual(["uc_receipt"]);
  });

  it("over an edge the same delta draws is backed — graded against the map the merge leaves", async () => {
    const f = await exampleFleet();
    flow(f, "FEAT-204-receipt", RECEIPT);
    f.write(
      "features/FEAT-204-receipt/delta.likec4",
      `specification {
  element group
  element softwareSystem
  tag FEAT-204
}
model {
  marketplace = group 'Marketplace' {
    checkoutWeb = softwareSystem 'checkout-web'
    notificationService = softwareSystem 'notification-service'
  }
  marketplace.checkoutWeb -> marketplace.notificationService 'Requests a receipt' {
    #FEAT-204
  }
}
`,
    );

    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-204"), "usecase.step-unbacked")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 4. A MODIFIED arch requirement that drops a Covers: sli: line       */
/* ------------------------------------------------------------------ */

const SIGNALS = "Order placement is measured and paged";

function signalsDelta(f: Fleet, covers: string): void {
  intent(f, "FEAT-205-signals", ["order-service"]);
  f.write(
    "features/FEAT-205-signals/specs/order-service/arch.spec.md",
    `# order-service — arch delta for FEAT-205

## MODIFIED Requirements

### Requirement: ${SIGNALS}

Requirement-ID: ARCH-ORD-SIGNALS
Based-On: ${pinFor(f.read("services/order-service/arch.spec.md"), SIGNALS)}
The service SHALL export an availability SLI and SHALL page the orders on-call when placements
fail at a sustained rate.

Covers: ${covers}

#### Scenario: Sustained placement failures page the on-call
- **Given** more than 2% of \`createOrder\` calls failing over five minutes
- **When** the alert rules are evaluated
- **Then** \`order_placement_failures\` pages the orders on-call with the runbook link
`,
  );
}

describe("a MODIFIED arch requirement that drops a Covers: sli: line", () => {
  it("is health.uncovered before the archive — the warning validate --all gives the service after it", async () => {
    const f = await exampleFleet();
    signalsDelta(f, "sli:availability, alert:order_placement_failures");

    const before = ofCode(await findingsOf(f.dir, "--feature", "FEAT-205"), "health.uncovered");
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ severity: "warn", subject: "order-service" });
    expect(before[0]!.message).toContain("SLI 'order_placement_latency_p95_ms'");

    // Advisory, so the archive lands — and the fleet says the same thing.
    const archived = await runLoam(f.dir, "archive", "FEAT-205");
    expect(archived.code).toBe(0);
    const after = ofCode(await findingsOf(f.dir, "--all"), "health.uncovered");
    expect(after).toHaveLength(1);
    expect(after[0]!.message).toContain("SLI 'order_placement_latency_p95_ms'");
  });

  it("is silent when the delta keeps every entry the living requirement had", async () => {
    const f = await exampleFleet();
    signalsDelta(f, "sli:availability, sli:order_placement_latency_p95_ms, alert:order_placement_failures");
    expect(ofCode(await findingsOf(f.dir, "--feature", "FEAT-205"), "health.uncovered")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Covers: spelled in the delta's own ids                            */
/* ------------------------------------------------------------------ */

/** A delta re-declaring order-service at the TOP level, where the living map nests it in `marketplace`. */
const STUB_DELTA = `specification {
  element softwareSystem
  element container
  tag FEAT-206
}
model {
  orderService = softwareSystem 'order-service' {
    metadata {
      service 'order-service'
    }
    auditLog = container 'audit-log' {
      #FEAT-206
      description 'Append-only audit of order changes'
    }
  }
  notificationService = softwareSystem 'notification-service' {
    metadata {
      service 'notification-service'
    }
  }
  orderService -> notificationService 'Notifies on cancellation' {
    #FEAT-206
  }
}
`;

function stubDelta(f: Fleet, covers: readonly string[]): void {
  intent(f, "FEAT-206-stub", ["order-service"]);
  f.write("features/FEAT-206-stub/delta.likec4", STUB_DELTA);
  f.write(
    "features/FEAT-206-stub/specs/order-service/arch.spec.md",
    `# order-service — arch delta for FEAT-206

## ADDED Requirements

${covers
  .map(
    (line, i) => `### Requirement: Obligation ${i + 1}

Requirement-ID: ARCH-ORD-AUDIT-${i + 1}
The service SHALL meet obligation ${i + 1}.

Covers: ${line}

#### Scenario: Obligation ${i + 1} holds
- **Given** an order
- **When** it changes
- **Then** obligation ${i + 1} holds
`,
  )
  .join("\n")}`,
  );
}

describe("Covers: spelled in the delta's own ids", () => {
  it("is covers.unknown before the archive when the map the merge leaves spells the element differently", async () => {
    const f = await exampleFleet();
    stubDelta(f, ["orderService -> notificationService", "orderService.auditLog"]);

    const before = ofCode(await findingsOf(f.dir, "--feature", "FEAT-206"), "covers.unknown");
    expect(before).toHaveLength(2);
    // Each says what to write instead: the service form for an edge, and the
    // id the merge gives an element that stands for no service.
    expect(before.map((x) => x.message).join("\n")).toContain("'order-service -> notification-service' resolves in both");
    expect(before.map((x) => x.message).join("\n")).toContain("'marketplace.orderService.auditLog' resolves in both");

    const archived = await runLoam(f.dir, "archive", "FEAT-206");
    expect(archived.code).toBe(0);
    const after = ofCode(await findingsOf(f.dir, "--all"), "covers.unknown").map((x) => x.message);
    expect(after).toHaveLength(2);
    expect(after.join("\n")).toContain("'orderService -> notificationService'");
    expect(after.join("\n")).toContain("'orderService.auditLog'");
  });

  it("the spellings it recommends resolve before AND after the archive", async () => {
    const f = await exampleFleet();
    stubDelta(f, ["order-service -> notification-service", "marketplace.orderService.auditLog"]);

    const before = await findingsOf(f.dir, "--feature", "FEAT-206");
    expect(ofCode(before, "covers.unknown")).toEqual([]);
    expect(ofCode(before, "c4.uncovered")).toEqual([]);

    const archived = await runLoam(f.dir, "archive", "FEAT-206");
    expect(archived.code).toBe(0);
    expect(ofCode(await findingsOf(f.dir, "--all"), "covers.unknown")).toEqual([]);
  });

  it("c4.uncovered recommends the spelling that survives, never the delta's own id", async () => {
    const f = await exampleFleet();
    stubDelta(f, ["sli:availability"]);
    const hints = ofCode(await findingsOf(f.dir, "--feature", "FEAT-206"), "c4.uncovered").map((x) => x.message);
    expect(hints).toHaveLength(2);
    expect(hints.join("\n")).toContain("add 'Covers: marketplace.orderService.auditLog'");
    expect(hints.join("\n")).toContain("add 'Covers: order-service -> notification-service'");
    expect(hints.join("\n")).not.toContain("Covers: orderService");
  });
});

/* ------------------------------------------------------------------ */
/* 6–7. What the dry run says, and at which severity                    */
/* ------------------------------------------------------------------ */

describe("archive --dry-run says what the real run says in place of its closing line", () => {
  /**
   * FEAT-101, plus a service it puts on the map ALONE — a binding with no
   * `specs/<svc>/`, so no directory and no model. Since the archive writes the
   * model of every service whose directory it creates, that is the shape that
   * still owes `service.no-model` (payment-split-service no longer does).
   */
  async function withMapOnlyService(): Promise<Fleet> {
    const f = await exampleFleet(["FEAT-101-payment-splitting"]);
    const rel = "features/FEAT-101-payment-splitting/delta.likec4";
    const anchor = "  marketplace = group 'Marketplace' {\n";
    const text = f.read(rel).replace(/\r\n/g, "\n");
    expect(text).toContain(anchor);
    const mapOnly = "    fraudCheck = softwareSystem 'fraud-check' {\n      #FEAT-101\n      metadata {\n        service 'fraud-check'\n      }\n    }\n";
    f.write(rel, text.replace(anchor, anchor + mapOnly));
    return f;
  }

  it("prints the plan's service.no-model in text, as --json and the real run do — and never claims the docs complete", async () => {
    const f = await withMapOnlyService();
    const dry = await runLoam(f.dir, "archive", "FEAT-101", "--dry-run");
    expect(dry.code).toBe(0);
    const owed = dry.stdout.indexOf("⚠ fraud-check: this archive puts 'fraud-check' in the landscape");
    expect(owed).toBeGreaterThan(dry.stdout.indexOf("plan — "));
    expect(owed).toBeLessThan(dry.stdout.indexOf("dry run — nothing was written."));
    expect(dry.stdout).not.toContain("complete + current");

    const real = await runLoam(f.dir, "archive", "FEAT-101");
    expect(real.code).toBe(0);
    expect(real.stdout).toContain("⚠ fraud-check: this archive puts 'fraud-check' in the landscape");
    expect(real.stdout).not.toContain("complete + current");
  });

  it("files service.no-model at the severity validate gives the same fact, without gating the merge", async () => {
    const f = await withMapOnlyService();
    const dry = await runLoam(f.dir, "archive", "FEAT-101", "--dry-run", "--json");
    const warnings = (JSON.parse(dry.stdout) as { warnings: Finding[] }).warnings;
    expect(ofCode(warnings, "service.no-model")).toMatchObject([{ severity: "error", gates: false, subject: "fraud-check" }]);

    expect((await runLoam(f.dir, "archive", "FEAT-101")).code).toBe(0);
    // A binding with no directory behind it: the fleet map's code, at the same severity.
    const after = await findingsOf(f.dir, "--all");
    expect(ofCode(after, "landscape.binding-unknown").map((x) => x.severity)).toEqual(["error"]);
    expect(ofCode(after, "service.no-model")).toEqual([]);
  });
});
