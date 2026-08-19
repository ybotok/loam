/**
 * The event axis of the feature gate: tagged edges' publishes/consumes
 * metadata, requirement deltas' Publishes:/Consumes: lines, and the
 * asyncapi contracts, graded against each other by featureCoherence
 * (core/coherence/events/).
 *
 * Families:
 *  - c4-event: an edge's claim against the bound service's feature∪living contract
 *  - spec-event: a delta requirement line's claim, same join
 *  - the in-flight downgrades: *-pending when another feature introduces the message
 *  - asyncapi.message-conflict: two features declaring one (service, message)
 *  - asyncapi.invalid: a broken feature contract suspends the service's event checks
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { featureCoherence } from "../src/core/coherence/coherence.js";
import { gatesArchive, type Issue } from "../src/core/vocabulary/issue.js";
import { coherentFixture, FEATURE_SPEC, makeProject, pinFor, type Project } from "./helpers/harness.js";

/** coherentFixture's delta plus one tagged event edge: the split service announces completion. */
const EVENT_DELTA = `specification {
  element softwareSystem
  tag FEAT-1
}

model {
  paymentService = softwareSystem 'payment-service'
  paymentSplitService = softwareSystem 'payment-split-service' {
    #FEAT-1
    description 'Splits a payment across payees'
  }

  paymentService -> paymentSplitService 'Calls createSplit' {
    #FEAT-1
    metadata { op 'createSplit' }
  }
  paymentSplitService -> paymentService 'Emits SplitCompleted' {
    #FEAT-1
    metadata { publishes 'payment.SplitCompleted' }
  }
}

views {
  view feat_1 {
    include *
  }
}
`;

/** The feature contract that makes the edge true: payment-split-service sends the message. */
const SPLIT_EVENTS = `asyncapi: 3.0.0
info:
  title: payment-split-service events
  version: "1.0"
channels:
  splitEvents:
    address: payment.splits.v1
    messages:
      SplitCompleted:
        $ref: '#/components/messages/SplitCompleted'
operations:
  sendSplitCompleted:
    action: send
    channel:
      $ref: '#/channels/splitEvents'
components:
  messages:
    SplitCompleted:
      name: payment.SplitCompleted
      payload:
        type: object
        properties:
          splitId:
            type: string
`;

async function coherenceOf(files: Record<string, string>): Promise<Issue[]> {
  const p: Project = await makeProject(files);
  try {
    return await featureCoherence({
      docsDir: p.docsDir,
      featureDir: join(p.docsDir, "features", "FEAT-1-split"),
      featureId: "FEAT-1",
    });
  } finally {
    await p.destroy();
  }
}

const only = (issues: Issue[], code: string): Issue[] => issues.filter((i) => i.code === code);

/** The base: coherentFixture with the event edge in the delta. */
function fixture(over: Record<string, string> = {}): Record<string, string> {
  return {
    ...coherentFixture(),
    "features/FEAT-1-split/delta.likec4": EVENT_DELTA,
    ...over,
  };
}

/** A second feature in flight whose asyncapi delta introduces the same message. */
function inFlight(files: Record<string, string>): Record<string, string> {
  return {
    ...files,
    "features/FEAT-9-relay/intent.md": `---\nfeature: FEAT-9\nstatus: proposed\n---\n\n# Relay split events\n\nIntroduce the split-completion event.\n`,
    "features/FEAT-9-relay/specs/payment-split-service/asyncapi.yaml": SPLIT_EVENTS,
  };
}

describe("c4-event: tagged edges against the bound service's contract", () => {
  it("errors when nothing — feature or living — declares the published message", async () => {
    const [issue, ...rest] = only(await coherenceOf(fixture()), "c4-event.message-undefined");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("payment.SplitCompleted");
    expect(issue!.message).toContain("action: send");
  });

  it("is silent when the feature's own asyncapi delta declares the send", async () => {
    const issues = await coherenceOf(
      fixture({ "features/FEAT-1-split/specs/payment-split-service/asyncapi.yaml": SPLIT_EVENTS }),
    );
    expect(only(issues, "c4-event.message-undefined")).toEqual([]);
    // The service is new — no living contract — so no baseline family fires
    // either: a wholly new contract has nothing to be based on.
    expect(issues.filter((i) => i.code.startsWith("asyncapi.baseline"))).toEqual([]);
  });

  it("downgrades to c4-event.message-pending when another feature in flight introduces the message", async () => {
    const issues = await coherenceOf(inFlight(fixture()));
    expect(only(issues, "c4-event.message-undefined")).toEqual([]);
    const [issue] = only(issues, "c4-event.message-pending");
    expect(issue!.severity).toBe("warn");
    expect(issue!.message).toContain("FEAT-9");
  });
});

describe("spec-event: delta requirement lines against the same contract", () => {
  const withLine = (files: Record<string, string>): Record<string, string> => ({
    ...files,
    "features/FEAT-1-split/specs/payment-split-service/spec.md": FEATURE_SPEC.replace(
      "Operations: createSplit",
      "Operations: createSplit\nPublishes: payment.SplitCompleted",
    ),
  });

  it("errors — and gates — on a line no contract backs", async () => {
    const [issue, ...rest] = only(await coherenceOf(withLine(fixture())), "spec-event.message-undefined");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("payment.SplitCompleted");
  });

  it("is silent once the feature's asyncapi delta declares the message", async () => {
    const issues = await coherenceOf(
      withLine(fixture({ "features/FEAT-1-split/specs/payment-split-service/asyncapi.yaml": SPLIT_EVENTS })),
    );
    expect(only(issues, "spec-event.message-undefined")).toEqual([]);
  });

  it("downgrades to spec-event.message-pending for an in-flight introduction", async () => {
    const issues = await coherenceOf(inFlight(withLine(fixture())));
    expect(only(issues, "spec-event.message-undefined")).toEqual([]);
    const [issue] = only(issues, "spec-event.message-pending");
    expect(issue!.severity).toBe("warn");
    expect(issue!.message).toContain("FEAT-9");
  });
});

describe("asyncapi.message-conflict — two features, one (service, message)", () => {
  it("warns when an in-flight feature adds or edits the same declaration", async () => {
    const issues = await coherenceOf(
      inFlight(fixture({ "features/FEAT-1-split/specs/payment-split-service/asyncapi.yaml": SPLIT_EVENTS })),
    );
    const [issue, ...rest] = only(issues, "asyncapi.message-conflict");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("warn");
    expect(issue!.message).toContain("payment.SplitCompleted");
    expect(issue!.message).toContain("FEAT-9");
  });
});

describe("asyncapi.invalid — a broken feature contract suspends the service's event checks", () => {
  it("reports the file once and grades nothing event-shaped against the empty parse", async () => {
    const issues = await coherenceOf(
      fixture({ "features/FEAT-1-split/specs/payment-split-service/asyncapi.yaml": "channels: [unclosed\n" }),
    );
    const [issue, ...rest] = only(issues, "asyncapi.invalid");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    // The edge's claim is NOT graded against the unreadable contract — one
    // breach, one finding, the unreadableApis discipline on the event axis.
    expect(only(issues, "c4-event.message-undefined")).toEqual([]);
  });
});

describe("a retired message stops answering the requirement-line join", () => {
  /** payment-service's living pair: one requirement publishing payment.Legacy, one contract sending it. */
  const LEGACY_LIVING_SPEC = `---
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

  const LEGACY_EVENTS = `asyncapi: 3.0.0
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
`;

  /** A justified, exact full retirement of payment.Legacy. */
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

  it("errors on a leftover Publishes: line in a SURVIVING requirement naming a message this feature retires", async () => {
    // The retirement itself is justified and exact, so the gate used to
    // answer the leftover line from LIVING's send set and pass — archive
    // then deleted the declaration, and the next `validate --all` broke on
    // spec-event.message-undefined over the merged living spec, in a repo
    // nobody was working in. The join now grades the contract as the merge
    // would leave it, so the same breach fails here, before anything writes.
    const issues = await coherenceOf({
      ...coherentFixture(),
      "services/payment-service/spec.md": LEGACY_LIVING_SPEC,
      "services/payment-service/asyncapi.yaml": LEGACY_EVENTS,
      "features/FEAT-1-split/specs/payment-service/spec.md": `# payment-service — delta for FEAT-1

## ADDED Requirements

### Requirement: Ledger export
The service SHALL export a settlement ledger.

Publishes: payment.Legacy

#### Scenario: Ledger exported
- **Given** a settled payment
- **When** the ledger runs
- **Then** an entry is exported

## REMOVED Requirements

### Requirement: Legacy events
Based-On: ${pinFor(LEGACY_LIVING_SPEC, "Legacy events")}

Publishes: payment.Legacy
`,
      "features/FEAT-1-split/specs/payment-service/asyncapi.yaml": FULL_REMOVAL_EVENTS,
    });
    // The removal owes nothing — the leftover line is the only breach.
    expect(only(issues, "asyncapi.remove-marker-missing")).toEqual([]);
    const [issue, ...rest] = only(issues, "spec-event.message-undefined");
    expect(rest).toEqual([]);
    expect(issue!.severity).toBe("error");
    expect(gatesArchive(issue!)).toBe(true);
    expect(issue!.message).toContain("'Ledger export'");
    expect(issue!.message).toContain("payment.Legacy");
  });
});
