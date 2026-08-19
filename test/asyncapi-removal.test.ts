/**
 * Retiring a message through a feature delta — the GATE's half: marker
 * exactness, the removal↔REMOVED-requirement justification join, the
 * relocation exemption, and the fleet-consumer refusal
 * (core/coherence/events/). The MERGE's half closes the file: `loam archive`
 * deletes the marked slots from the living contract, and the marker itself
 * never reaches it.
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { parse } from "yaml";
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { pinAsyncapiSlots } from "../src/core/asyncapi/merge/pin.js";
import { gatesArchive, type Issue } from "../src/core/vocabulary/issue.js";
import { makeProject, pinFor, runLoam, type Project } from "./helpers/harness.js";

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

/**
 * The living contract with payment.Legacy declared ONLY inline under its
 * channel — the shape SCHEMA.md retires through the channel's own marker,
 * because an inline message is channel interior and has no slot of its own.
 */
const LIVING_EVENTS_INLINE = `asyncapi: 3.0.0
info:
  title: payment-service events
  version: "1.0"
channels:
  legacyEvents:
    address: payment.legacy.v1
    messages:
      Legacy:
        name: payment.Legacy
        payload:
          type: object
operations:
  sendLegacy:
    action: send
    channel:
      $ref: '#/channels/legacyEvents'
`;

/** The SCHEMA-sanctioned retirement of an inline-declared message: the channel goes, interior and all. */
const CHANNEL_REMOVAL_EVENTS = `asyncapi: 3.0.0
channels:
  legacyEvents:
    x-loam-remove: true
operations:
  sendLegacy:
    x-loam-remove: true
`;

/** The consumer the retirement would strand: a living landscape consumes-edge. */
const CONSUMES_LANDSCAPE = `specification {
  element softwareSystem
}

model {
  paymentService = softwareSystem 'payment-service'
  billingService = softwareSystem 'billing-service'

  paymentService -> billingService 'Delivers legacy events' {
    metadata { consumes 'payment.Legacy' }
  }
}
`;

describe("retiring an inline-declared message — the channel marker IS the marker", () => {
  it("a channel-slot removal satisfies the REMOVED requirement's marker debt for its inline interior", async () => {
    // This shape used to be a two-sided deadlock: the SCHEMA-sanctioned
    // channel marker graded asyncapi.remove-marker-missing (the message-slot
    // set could not see it), and the components.messages marker that error's
    // own advice suggested graded asyncapi.remove-target-missing — no
    // authoring passed the gate short of --approve.
    const issues = await coherenceOf(
      fixture({
        "services/payment-service/asyncapi.yaml": LIVING_EVENTS_INLINE,
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": CHANNEL_REMOVAL_EVENTS,
      }),
    );
    expect(asyncapiCodes(issues)).toEqual([]);
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

  it("fires when a channel removal deletes an INLINE declaration a live consumer depends on", async () => {
    // The declaration leaves with its channel (no components.messages marker
    // exists to look at), so the components-only set used to stay silent:
    // coherence said ✓, archive merged, and `validate --all` went red on
    // billing-service — a repository whose author was never in this feature.
    const issues = await coherenceOf(
      fixture({
        "services/payment-service/asyncapi.yaml": LIVING_EVENTS_INLINE,
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": CHANNEL_REMOVAL_EVENTS,
        "architecture/landscape.likec4": CONSUMES_LANDSCAPE,
      }),
    );
    const [issue, ...rest] = only(issues, "asyncapi.remove-message-consumed");
    // The net-removal set and the wire diff agree here — one finding, not two.
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("payment.Legacy");
    expect(issue!.message).toContain("billing-service");
  });

  it("fires when the feature retires only the send OPERATION — the declaration survives, production stops", async () => {
    // No declaration is deleted and no justification is owed (operation
    // slots need exactness only), but the merged contract no longer sends
    // the message: the post-archive fleet is red with
    // spine.message-unproduced on the consumer. The wire half of the
    // consumer question, asked of the simulated merge's sent-set diff.
    const issues = await coherenceOf(
      fixture({
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": `asyncapi: 3.0.0
operations:
  sendLegacy:
    x-loam-remove: true
`,
        "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": null,
        "architecture/landscape.likec4": CONSUMES_LANDSCAPE,
      }),
    );
    const [issue, ...rest] = only(issues, "asyncapi.remove-message-consumed");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("would no longer declare an action: send operation for 'payment.Legacy'");
    expect(issue!.message).toContain("billing-service");
  });
});

describe("the merge's half: archive retires the slots", () => {
  // The whole retirement, exactness-only for the channel and operation slots:
  // leaving either behind would strand a `$ref` at the message's grave, which
  // the plan's own asyncapi.ref-unresolved gate would (rightly) refuse.
  const FULL_REMOVAL_EVENTS = `asyncapi: 3.0.0
channels:
  legacyEvents:
    x-loam-remove: true
operations:
  sendLegacy:
    x-loam-remove: true
components:
  messages:
    Legacy:
      name: payment.Legacy
      x-loam-remove: true
`;

  it("a justified, exact removal deletes the slots at archive, and the marker never reaches living", async () => {
    const p = await makeProject(
      fixture({ "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": FULL_REMOVAL_EVENTS }),
    );
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-40", "--json");
      expect(res.code).toBe(0);
      const payload = JSON.parse(res.stdout);
      expect(payload.asyncapiRemovals).toEqual([
        {
          service: "payment-service",
          slots: ["channels.legacyEvents", "operations.sendLegacy", "'payment.Legacy' (components.messages.Legacy)"],
        },
      ]);
      // Removals are deletions, never overwrites — no *-modified warn rides along.
      expect((payload.warnings as Array<{ code: string }>).some((w) => w.code.endsWith("-modified"))).toBe(false);
      const living = await p.read("services/payment-service/asyncapi.yaml");
      expect(living).not.toContain("x-loam-remove");
      expect(living).not.toContain("Legacy");
      const doc = parse(living);
      // Every section emptied by its removal goes with its last slot.
      expect(doc.channels).toBeUndefined();
      expect(doc.operations).toBeUndefined();
      expect(doc.components).toBeUndefined();
    } finally {
      await p.destroy();
    }
  });

  it("asyncapi.remove-marker-inline — a marker nested on an inline channel message gates the archive by name", async () => {
    // The nested marker retires nothing (an inline message is channel
    // interior, not a slot), and with the channel otherwise unchanged the
    // merge deduplicates the restatement away — before this code existed the
    // removal was silently dropped: no write, no plan line, no finding on
    // any surface. openapi.remove-marker-path-level's discipline, nested.
    const nested = `asyncapi: 3.0.0
channels:
  legacyEvents:
    address: payment.legacy.v1
    messages:
      Legacy:
        name: payment.Legacy
        x-loam-remove: true
        payload:
          type: object
`;
    // Pinned as `loam rebase` would, so the refusal under test is the only
    // gate in play — an unpinned delta would trip asyncapi.baseline-missing
    // first and this test would pass for the wrong reason.
    const pinned = pinAsyncapiSlots(nested, LIVING_EVENTS_INLINE, "payment-service").text!;
    const p = await makeProject(
      fixture({
        "services/payment-service/asyncapi.yaml": LIVING_EVENTS_INLINE,
        "features/FEAT-40-retire-legacy/specs/payment-service/asyncapi.yaml": pinned,
        "features/FEAT-40-retire-legacy/specs/payment-service/spec.md": null,
      }),
    );
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-40", "--json");
      expect(res.code).toBe(1);
      const refusal = JSON.parse(res.stdout);
      expect(refusal.error.code).toBe("not-coherent");
      const inline = (refusal.issues as Array<{ code: string; message: string }>).filter(
        (i) => i.code === "asyncapi.remove-marker-inline",
      );
      expect(inline).toHaveLength(1);
      expect(inline[0]!.message).toContain("channels.legacyEvents.messages.Legacy");
      expect(await p.read("services/payment-service/asyncapi.yaml")).toBe(LIVING_EVENTS_INLINE);
    } finally {
      await p.destroy();
    }
  });

  it("retiring only the message while its channel still $refs it gates as a dangling reference", async () => {
    // REMOVAL_EVENTS retires just components.messages.Legacy; the living
    // channel keeps `$ref: '#/components/messages/Legacy'`, so the MERGED
    // document would point at a grave — the plan refuses before a byte moves.
    const p = await makeProject(fixture());
    try {
      const res = await runLoam(p.workDir, "archive", "FEAT-40", "--json");
      expect(res.code).toBe(1);
      const refusal = JSON.parse(res.stdout);
      expect(refusal.error.code).toBe("not-coherent");
      expect(
        (refusal.issues as Array<{ code: string }>).filter((i) => i.code === "asyncapi.ref-unresolved"),
      ).toHaveLength(1);
      expect(await p.read("services/payment-service/asyncapi.yaml")).toBe(LIVING_EVENTS);
    } finally {
      await p.destroy();
    }
  });
});
