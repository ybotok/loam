/**
 * `Realizes: <capability-id>#<Requirement-ID>` — the join from a service
 * requirement into the authored business tree, graded in both directions.
 *
 * What these tests hold that a plausible wrong implementation would break:
 *
 * FIVE FAILURES, FIVE MESSAGES. An entry can fail to resolve for reasons whose
 * fixes have nothing in common — a typo, an undeclared capability, a declared
 * one nobody has documented, a document with no requirements yet, a wrong id.
 * Collapsing them to "does not resolve" would pass a shallower suite and leave
 * an author with no idea which of the five happened, so each arm is asserted on
 * its own words.
 *
 * THE SEPARATOR IS THE LAST `#`. Asserted through a capability id that
 * CONTAINS one, which is the only case that can tell `lastIndexOf` from
 * `indexOf` — and the failure it guards against is silent, because a first-`#`
 * split would report a perfectly real capability as undeclared.
 *
 * REALIZING A REQUIREMENT REALIZES ITS CAPABILITY. A requirement that writes
 * only `Realizes:` and no `Capability:` must not leave the capability reading
 * as realized by nobody. That is the assertion that fails if the two joins are
 * ever counted separately, and the bug it prevents is one spurious
 * `capability.unrealized` per carefully documented capability.
 *
 * AND THE TWO UNREALIZED GRADES ARE NOT THE SAME GRADE. A capability with two
 * requirements, one realized, is silent through `capability.unrealized` and
 * loud through `capability.requirement-unrealized`. A suite that only tested a
 * fully unrealized capability could not tell them apart.
 */
import { describe, expect, it, afterEach } from "vitest";
import { coherentFixture, makeProject, runLoam, type Project } from "./helpers/harness.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function project(files: Record<string, string>): Promise<Project> {
  const p = await makeProject(files, { service: "payment-service" });
  cleanups.push(() => p.destroy());
  return p;
}

/** A capability document declaring `body`'s requirements. */
function capabilityDoc(reqs: Array<{ id: string; name: string }>): string {
  return `# A capability

What a customer expects, in words they would recognise.

## Requirements
${reqs
  .map(
    (r) => `
### Requirement: ${r.name}
Requirement-ID: ${r.id}
The fleet SHALL keep this promise.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`,
  )
  .join("")}`;
}

const CHECKOUT_DOC = capabilityDoc([
  { id: "CHK-ONCE", name: "Charge exactly once" },
  { id: "CHK-PRICE", name: "The price shown is charged" },
]);

/** The living spec, with whatever body lines the case is about. */
function specWith(lines: string, status = "verified"): string {
  return `---
service: payment-service
status: ${status}
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment
${lines}

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
}

async function findings(
  p: Project,
  code: string,
  ...args: string[]
): Promise<Array<{ subject?: string; message: string }>> {
  const res = await runLoam(p.workDir, "validate", ...args, "--json");
  const doc = JSON.parse(res.stdout);
  const targets: Array<{ findings: Array<{ code: string; subject?: string; message: string }> }> = doc.targets ?? [];
  return targets.flatMap((t) => t.findings.filter((f) => f.code === code));
}

describe("Realizes: resolves against a capability document's requirements", () => {
  it("a resolving entry passes, and the rollup files the requirement under the promise it serves", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "services/payment-service/spec.md": specWith("Realizes: checkout#CHK-ONCE"),
    });
    expect(await findings(p, "capability.realizes-unknown", "--all")).toEqual([]);

    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    const rows = JSON.parse(list.stdout).capabilities as Array<{
      id: string;
      requirements?: Array<{ id: string; name: string; realizedBy: unknown[] }>;
    }>;
    // `keptBy` is the use-case corpus's half of the same question, and `[]` on
    // both rows is a positive answer here rather than a filler: loam read the
    // fleet's flows and none of them claims either promise. The key would be
    // ABSENT if `architecture/` could not be read — see list-capability-flows.
    expect(rows.find((r) => r.id === "checkout")!.requirements).toEqual([
      {
        id: "CHK-ONCE",
        name: "Charge exactly once",
        realizedBy: [{ service: "payment-service", file: "spec.md", requirement: "Authorize a payment" }],
        keptBy: [],
      },
      { id: "CHK-PRICE", name: "The price shown is charged", realizedBy: [], keptBy: [] },
    ]);
  });

  it("realizing a REQUIREMENT realizes its capability — no Capability: line needed", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "services/payment-service/spec.md": specWith("Realizes: checkout#CHK-ONCE"),
    });
    // The spec carries no `Capability:` line at all. If the two joins were
    // counted separately this would warn about a capability the fleet is
    // demonstrably realizing.
    expect(await findings(p, "capability.unrealized", "--all")).toEqual([]);
  });

  it("a requirement carrying BOTH joins is counted once", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "services/payment-service/spec.md": specWith("Capability: checkout\nRealizes: checkout#CHK-ONCE"),
    });
    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    const row = (JSON.parse(list.stdout).capabilities as Array<{
      id: string;
      realizedBy: unknown[];
      statuses: Record<string, number>;
    }>).find((r) => r.id === "checkout")!;
    expect(row.realizedBy).toHaveLength(1);
    expect(row.statuses).toEqual({ verified: 1 });
  });

  it("an arch.spec.md requirement joins identically", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "services/payment-service/arch.spec.md": `# arch

## Requirements

### Requirement: Publish through an outbox
The service SHALL publish events through a transactional outbox.

Realizes: checkout#CHK-NOPE

#### Scenario: A crash between write and publish
- **Given** a crash after the write
- **When** the service restarts
- **Then** the event is still published
`,
    });
    const found = await findings(p, "capability.realizes-unknown", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("arch.spec.md");
  });

  it("a REMOVED requirement's entries are not graded", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "features/FEAT-1-split/specs/payment-split-service/spec.md": `# delta

## REMOVED Requirements

### Requirement: Split a payment
Realizes: checkout#GONE-FOREVER

#### Scenario: it went
- **Given** a split
- **When** it is retired
- **Then** it is gone
`,
    });
    expect(await findings(p, "capability.realizes-unknown", "--all")).toEqual([]);
  });

  it("grades nothing when the fleet has neither capabilities.yaml nor capabilities/", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("Realizes: checkout#CHK-ONCE"),
    });
    expect(await findings(p, "capability.realizes-unknown", "--all")).toEqual([]);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);
  });
});

describe("capability.realizes-unknown names WHICH of the five failures happened", () => {
  const cases: Array<{ what: string; files: Record<string, string>; entry: string; expect: string[] }> = [
    {
      what: "no separator at all",
      files: { "capabilities/checkout/spec.md": CHECKOUT_DOC },
      entry: "checkout",
      expect: ["<capability-id>#<Requirement-ID>", "`Capability:` line instead"],
    },
    {
      what: "a capability nothing declares",
      files: { "capabilities/checkout/spec.md": CHECKOUT_DOC },
      entry: "chekout#CHK-ONCE",
      expect: ["no such capability is declared", "Did you mean: checkout?"],
    },
    {
      what: "a capability declared in YAML with no document",
      files: { "architecture/capabilities.yaml": "capabilities:\n  shipping: {}\n" },
      entry: "shipping#SHIP-1",
      expect: ["has no capabilities/shipping/spec.md", "only a document can be realized"],
    },
    {
      what: "a document that declares no requirements yet",
      files: { "capabilities/shipping/spec.md": "# Shipping\n\nNo requirements written yet.\n" },
      entry: "shipping#SHIP-1",
      expect: ["declares no requirements yet", "`## Requirements`"],
    },
    {
      what: "an id that document does not declare",
      files: { "capabilities/checkout/spec.md": CHECKOUT_DOC },
      entry: "checkout#CHK-ONC",
      expect: ["declares no requirement with that id", "Did you mean: CHK-ONCE"],
    },
  ];

  it.each(cases)("$what", async ({ files, entry, expect: fragments }) => {
    const p = await project({
      ...coherentFixture(),
      ...files,
      "services/payment-service/spec.md": specWith(`Realizes: ${entry}`),
    });
    const found = await findings(p, "capability.realizes-unknown", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("payment-service");
    for (const fragment of fragments) expect(found[0]!.message).toContain(fragment);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code).not.toBe(0);
  });

  it("splits at the LAST separator, so a capability id containing one still resolves", async () => {
    // The only case that can tell `lastIndexOf` from `indexOf`, and the failure
    // it guards is silent: a first-`#` split would look for a capability called
    // `weird` and report a declared one as undeclared.
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": "capabilities:\n  weird#name: {}\n",
      "services/payment-service/spec.md": specWith("Realizes: weird#name#REQ-1"),
    });
    const found = await findings(p, "capability.realizes-unknown", "--all");
    expect(found).toHaveLength(1);
    // It reached the capability — the failure is the missing DOCUMENT, not a
    // missing declaration, which is what a first-`#` split would have said.
    expect(found[0]!.message).toContain("capability 'weird#name' is declared");
    expect(found[0]!.message).not.toContain("no such capability is declared");
  });

  it("a capability requirement with no Requirement-ID is not addressable by its heading", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": `# Checkout

## Requirements

### Requirement: Charge exactly once
The fleet SHALL charge once.

#### Scenario: It is kept
- **Given** a customer
- **When** they pay
- **Then** they pay once
`,
      "services/payment-service/spec.md": specWith("Realizes: checkout#Charge exactly once"),
    });
    // The document already earns capability.requirement-unidentified; letting
    // its heading work as an address would reintroduce identity-by-heading.
    expect(await findings(p, "capability.requirement-unidentified", "--all")).toHaveLength(1);
    expect(await findings(p, "capability.realizes-unknown", "--all")).toHaveLength(1);
  });
});

describe("capability.requirement-unrealized is the gap inside a healthy capability", () => {
  it("warns per unrealized requirement while capability.unrealized stays silent", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "services/payment-service/spec.md": specWith("Realizes: checkout#CHK-ONCE"),
    });
    // The capability IS realized, so the coarser code says nothing at all —
    // which is exactly the blind spot this one exists to cover.
    expect(await findings(p, "capability.unrealized", "--all")).toEqual([]);
    const found = await findings(p, "capability.requirement-unrealized", "--all");
    expect(found.map((f) => f.subject)).toEqual(["checkout#CHK-PRICE"]);
    expect(found[0]!.message).toContain("capabilities/checkout/spec.md");
    expect(found[0]!.message).toContain("The price shown is charged");
    // A warning, never a gate: writing the business document ahead of the fleet
    // is the intended use.
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);
  });

  it("sorts by capability then requirement id, so the list is diff-stable", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "capabilities/billing/spec.md": capabilityDoc([{ id: "BILL-1", name: "Bill monthly" }]),
      "services/payment-service/spec.md": specWith("Capability: checkout\nCapability: billing"),
    });
    const found = await findings(p, "capability.requirement-unrealized", "--all");
    expect(found.map((f) => f.subject)).toEqual(["billing#BILL-1", "checkout#CHK-ONCE", "checkout#CHK-PRICE"]);
  });
});

describe("the axis's own joins are refused INSIDE a capability document", () => {
  it.each([
    ["Capability:", "Capability: checkout", "claims the document it is already in"],
    ["Realizes:", "Realizes: checkout#CHK-ONCE", "is what gets realized, not what realizes"],
  ])("%s is capability.requirement-inert-join", async (_line, written, why) => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/checkout/spec.md": `# Checkout

## Requirements

### Requirement: Charge exactly once
Requirement-ID: CHK-ONCE
The fleet SHALL charge once.

${written}

#### Scenario: It is kept
- **Given** a customer
- **When** they pay
- **Then** they pay once
`,
    });
    const found = await findings(p, "capability.requirement-inert-join", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("checkout");
    expect(found[0]!.message).toContain(why);
    // The message hands back the line that WOULD work, on the service side.
    expect(found[0]!.message).toContain("Realizes: checkout#CHK-ONCE");
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code).not.toBe(0);
  });
});

describe("a feature's own capability delta widens what its service deltas may realize", () => {
  /** A capability delta adding one requirement under `## ADDED Requirements`. */
  const capabilityDelta = (id: string, name: string): string => `# ${id} — delta for FEAT-1

## ADDED Requirements

### Requirement: ${name}
Requirement-ID: ${id}
The fleet SHALL keep this promise.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`;

  /** The coherent feature, its service delta requirement carrying `entry`. */
  const featureRealizing = (entry: string): Record<string, string> => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = files[
      "features/FEAT-1-split/specs/payment-split-service/spec.md"
    ]!.replace("Operations: createSplit", `Operations: createSplit\nRealizes: ${entry}`);
    return files;
  };

  it("the headline flow: ADD the capability requirement here, Realizes: it from the service delta", async () => {
    // The whole reason the axis exists. Without the overlay the index is built
    // from the LIVING tree alone, so this is refused with
    // capability.realizes-unknown — an ERROR that gates archive — for a target
    // this very feature introduces two directories away.
    const p = await project({
      ...featureRealizing("checkout#CHK-REFUND"),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "features/FEAT-1-split/capabilities/checkout/spec.md": capabilityDelta("CHK-REFUND", "Refund within five days"),
    });
    expect(await findings(p, "capability.realizes-unknown", "--feature", "FEAT-1")).toEqual([]);
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).toBe(0);
    const archived = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(archived.code, archived.out).toBe(0);
  });

  it("a capability id the feature INTRODUCES resolves for `Capability:` too", async () => {
    // The other half of the overlay: widening `byCapability` without widening
    // `declared` leaves this as capability.unknown, because the id itself is
    // new to the fleet.
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = files[
      "features/FEAT-1-split/specs/payment-split-service/spec.md"
    ]!.replace("Operations: createSplit", "Operations: createSplit\nCapability: refunds\nRealizes: refunds#REF-1");
    const p = await project({
      ...files,
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "features/FEAT-1-split/capabilities/refunds/spec.md": capabilityDelta("REF-1", "Return the money"),
    });
    expect(await findings(p, "capability.unknown", "--feature", "FEAT-1")).toEqual([]);
    expect(await findings(p, "capability.realizes-unknown", "--feature", "FEAT-1")).toEqual([]);
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).toBe(0);
  });

  it("a requirement the delta only QUOTES does not widen anything — quoting merges nothing", async () => {
    // A `## Requirements` section inside a delta is legal: it quotes living
    // context for a reader. Its requirements are BASE, so the merge skips them
    // — which means an id that appears ONLY there will not exist after the
    // archive either. An overlay that widened on every kind would resolve this
    // `Realizes:` in silence and then leave the living fleet holding a pointer
    // at a promise nobody ever wrote, discovered by whoever runs
    // `validate --all` next.
    const p = await project({
      ...featureRealizing("checkout#CHK-GHOST"),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "features/FEAT-1-split/capabilities/checkout/spec.md": `# checkout — delta for FEAT-1

## ADDED Requirements

### Requirement: Refund within five days
Requirement-ID: CHK-REFUND
The fleet SHALL return a customer's money within five days.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept

## Requirements

### Requirement: A promise nobody has written yet
Requirement-ID: CHK-GHOST
The fleet SHALL do something one day.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`,
    });
    const found = await findings(p, "capability.realizes-unknown", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("CHK-GHOST");
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--json")).code).toBe(1);
  });

  it("still refuses an entry NEITHER the living tree nor this feature declares", async () => {
    // The overlay widens; it must not blind. A typo next to a real addition is
    // the case that fails if the widening is applied as "anything goes".
    const p = await project({
      ...featureRealizing("checkout#CHK-REFUNDS"),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
      "features/FEAT-1-split/capabilities/checkout/spec.md": capabilityDelta("CHK-REFUND", "Refund within five days"),
    });
    const found = await findings(p, "capability.realizes-unknown", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    // And the near-name candidates are drawn from the WIDENED set, so the id
    // this same feature is adding is offered. An overlay that widened only the
    // resolution and not the diagnosis would list CHK-ONCE and CHK-PRICE and
    // send the author looking at requirements they were not writing about.
    expect(found[0]!.message).toContain("CHK-REFUND?");
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).toBe(1);
    expect((await runLoam(p.workDir, "archive", "FEAT-1", "--json")).code).toBe(1);
  });
});

describe("the archive gate", () => {
  /** The coherent feature, its delta requirement carrying `entry`. */
  const featureRealizing = (entry: string): Record<string, string> => {
    const files = coherentFixture();
    files["features/FEAT-1-split/specs/payment-split-service/spec.md"] = files[
      "features/FEAT-1-split/specs/payment-split-service/spec.md"
    ]!.replace("Operations: createSplit", `Operations: createSplit\nRealizes: ${entry}`);
    return files;
  };

  it("an unresolvable Realizes: in a delta gates validate --feature and refuses archive; --approve overrides", async () => {
    const p = await project({
      ...featureRealizing("checkout#CHK-NOPE"),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
    });
    const found = await findings(p, "capability.realizes-unknown", "--feature", "FEAT-1");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("Did you mean: CHK-ONCE");
    expect((await runLoam(p.workDir, "validate", "--feature", "FEAT-1", "--json")).code).not.toBe(0);

    const refused = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.stdout).error.code).toBe("not-coherent");
    expect(refused.stdout).toContain("capability.realizes-unknown");
    expect(p.exists("features/FEAT-1-split/intent.md")).toBe(true);

    const approved = await runLoam(p.workDir, "archive", "FEAT-1", "--approve", "--json");
    expect(approved.code, approved.out).toBe(0);
  });

  it("a resolving Realizes: in a delta merges without a word", async () => {
    const p = await project({
      ...featureRealizing("checkout#CHK-ONCE"),
      "capabilities/checkout/spec.md": CHECKOUT_DOC,
    });
    const archived = await runLoam(p.workDir, "archive", "FEAT-1", "--json");
    expect(archived.code, archived.out).toBe(0);
    // And the line survives the merge into the living document, which is what
    // makes the join outlive the feature that introduced it.
    expect(await p.read("services/payment-split-service/spec.md")).toContain("Realizes: checkout#CHK-ONCE");
  });
});
