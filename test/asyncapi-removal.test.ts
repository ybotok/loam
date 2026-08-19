/**
 * Retiring a message through a feature delta — the GATE's half: marker
 * exactness, the removal↔REMOVED-requirement justification join, the
 * relocation exemption, and the fleet-consumer refusal
 * (core/coherence/events/). The MERGE's half — the marker deleting its slot
 * at archive and never reaching the living contract — lands with the
 * asyncapi merge and is pinned in its own suite then.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { gatesArchive, type Issue } from "../src/core/vocabulary/issue.js";
import { makeProject, pinFor, type Project } from "./helpers/harness.js";

const LIVING_SPEC = `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Legacy events
The service SHALL publish the legacy payment event.

Publishes: payment.Legacy

#### Scenario: Legacy event leaves
- **Given** a payment
- **When** it settles
- **Then** payment.Legacy is published
`;

const LIVING_EVENTS = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  legacyEvents:
    address: payment.legacy.v1
    messages:
      Legacy:
        $ref: '#/components/messages/Legacy'
operations:
  sendLegacy:
    action: send
    channel:
      $ref: '#/channels/legacyEvents'
components:
  messages:
    Legacy:
      name: payment.Legacy
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;

// The REMOVED requirement carries a Based-On pin because delta.baseline-missing
// gates archive; computed, not hard-coded, so the fixture survives a canonical-
// serialization change. Its Publishes: line is the removal's justification.
const REMOVED_SPEC = `# retirement

## REMOVED Requirements

### Requirement: Legacy events
Based-On: ${pinFor(LIVING_SPEC, "Legacy events")}

Publishes: payment.Legacy
`;

// A removal marker asserts a slot; it needs no x-loam-based-on — the
// remove-target checks guard the slot instead.
const REMOVAL_EVENTS = `asyncapi: 3.0.0
components:
  messages:
    Legacy:
      name: payment.Legacy
      x-loam-remove: true
`;

function fixture(over: Record<string, string | null> = {}): Record<string, string> {
  const files: Record<string, string | null> = {
    "services/payment-service/spec.md": LIVING_SPEC,
    "services/payment-service/asyncapi.yaml": LIVING_EVENTS,
    "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": REMOVED_SPEC,
    "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": REMOVAL_EVENTS,
    "features/FEAT-40-retire-legacy/intent.md": `# Retire legacy events

The legacy payment event is being retired from payment-service.
`,
    ...over,
  };
  return Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)) as Record<string, string>;
}

async function coherenceOf(files: Record<string, string>): Promise<Issue[]> {
  const p: Project = await makeProject(files);
  try {
    return await featureCoherence({
      docsDir: p.docsDir,
      featureDir: join(p.docsDir, "features", "FEAT-40-retire-legacy"),
      featureId: "FEAT-40",
    });
  } finally {
    await p.destroy();
  }
}

const only = (issues: Issue[], code: string): Issue[] => issues.filter((i) => i.code === code);
const asyncapiCodes = (issues: Issue[]): string[] =>
  issues.map((i) => i.code).filter((c) => c.startsWith("asyncapi."));

describe("a justified, exact removal is clean at the gate", () => {
  it("raises no asyncapi finding at all", async () => {
    expect(asyncapiCodes(await coherenceOf(fixture()))).toEqual([]);
  });
});

describe("marker exactness", () => {
  it("asyncapi.remove-target-missing — the marker addresses a slot the living contract lacks", async () => {
    const issues = await coherenceOf(
      fixture({
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": REMOVAL_EVENTS.replace(
          "    Legacy:\n      name: payment.Legacy",
          "    Ghost:\n      name: payment.Ghost",
        ),
        "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": REMOVED_SPEC.replace(
          "Publishes: payment.Legacy",
          "Publishes: payment.Ghost",
        ),
      }),
    );
    const [issue, ...rest] = only(issues, "asyncapi.remove-target-missing");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("components.messages.Ghost");
    expect(only(issues, "asyncapi.remove-target-mismatch")).toEqual([]);
  });

  it("asyncapi.remove-target-mismatch — the living declaration at that key carries a different name", async () => {
    const issues = await coherenceOf(
      fixture({
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": REMOVAL_EVENTS.replace(
          "name: payment.Legacy",
          "name: payment.Other",
        ),
        "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": REMOVED_SPEC.replace(
          "Publishes: payment.Legacy",
          "Publishes: payment.Other",
        ),
      }),
    );
    const [issue] = only(issues, "asyncapi.remove-target-mismatch");
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("payment.Other");
    expect(issue!.message).toContain("payment.Legacy");
  });
});

describe("the justification join, both directions", () => {
  it("asyncapi.remove-marker-missing — a REMOVED requirement walks away from a message the living contract still declares", async () => {
    // No feature asyncapi at all: the marker debt exists exactly because the
    // living contract still declares the message the requirement retires.
    const issues = await coherenceOf(
      fixture({ "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": null }),
    );
    const [issue, ...rest] = only(issues, "asyncapi.remove-marker-missing");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("payment.Legacy");
    expect(issue!.message).toContain("x-loam-remove");
  });

  it("owes no marker for a message the living contract does not declare", async () => {
    // An event contract is optional: retiring a requirement over a message
    // no contract carries must not demand a file nobody owes.
    const issues = await coherenceOf(
      fixture({
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": null,
        "services/payment-service/asyncapi.yaml": null,
      }),
    );
    expect(only(issues, "asyncapi.remove-marker-missing")).toEqual([]);
  });

  it("asyncapi.remove-marker-unjustified — a marker no REMOVED requirement's line names", async () => {
    const issues = await coherenceOf(
      fixture({ "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": null }),
    );
    const [issue] = only(issues, "asyncapi.remove-marker-unjustified");
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("payment.Legacy");
  });
});

describe("a relocation is not a removal", () => {
  it("marker plus redeclaration of the same name raises no removal finding", async () => {
    // Same message name, marker on the old key, declaration at a new one:
    // the message only changes address, so it needs no REMOVED requirement
    // and nothing here fires — declared.ts's netRemoved distinction on the
    // event axis.
    const relocation = `asyncapi: 3.0.0
components:
  messages:
    Legacy:
      name: payment.Legacy
      x-loam-remove: true
    LegacyV2:
      name: payment.Legacy
      payload:
        type: object
        properties:
          paymentId:
            type: string
`;
    const issues = await coherenceOf(
      fixture({
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": relocation,
        "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": null,
      }),
    );
    expect(asyncapiCodes(issues).filter((c) => c.startsWith("asyncapi.remove"))).toEqual([]);
  });
});

describe("asyncapi.remove-message-consumed — the fleet still consumes the message", () => {
  it("fires for a living landscape consumes-edge", async () => {
    const issues = await coherenceOf(
      fixture({
        "architecture/landscape.likec4": `specification {
  element softwareSystem
}

model {
  paymentService = softwareSystem 'payment-service'
  billingService = softwareSystem 'billing-service'

  paymentService -> billingService 'Delivers legacy events' {
    metadata { consumes 'payment.Legacy' }
  }
}
`,
      }),
    );
    const [issue, ...rest] = only(issues, "asyncapi.remove-message-consumed");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("billing-service");
    expect(issue!.message).toContain("payment.Legacy");
  });

  it("fires for another service's living Consumes: requirement", async () => {
    const issues = await coherenceOf(
      fixture({
        "services/billing-service/spec.md": `---
service: billing-service
status: verified
---

# billing-service

## Requirements

### Requirement: Reconcile legacy payments
The service SHALL reconcile from the legacy payment event.

Consumes: payment.Legacy

#### Scenario: Legacy event arrives
- **Given** a legacy event
- **When** it is delivered
- **Then** reconciliation runs
`,
      }),
    );
    const [issue] = only(issues, "asyncapi.remove-message-consumed");
    expect(issue!.message).toContain("billing-service's living requirement");
  });
});
