/**
 * The AUTHORED business tree: `capabilities/<id>/spec.md` as a fourth top-level
 * corpus beside architecture/, services/ and features/.
 *
 * Three properties carry the axis and each is here to fail against a plausible
 * wrong implementation rather than to restate the right one.
 *
 * THE OPT-IN WIDENED WITHOUT MOVING. `architecture/capabilities.yaml` was this
 * axis's only opt-in, and the tree is a second one — so a fleet holding NEITHER
 * must still be silent (the case that fails if the walk is read as "the fleet
 * declares no capabilities" instead of "there is nothing to grade against"),
 * while a fleet holding ONLY the tree must be graded (the case that fails if
 * the vocabulary is still read from the YAML alone).
 *
 * THE DIRECTORY IS THE LIST, so nesting is spelled by the tree and a directory
 * is a capability if and only if it holds the document. `payments` being a
 * capability in its own right beside `payments/refunds` is the shape that
 * separates a real classification from "the deepest directory wins".
 *
 * THE DOCUMENT'S TWO RULES ARE STRUCTURAL. `capability.requirement-service-scoped`
 * fires on the four lines that resolve against a service's own contract and
 * NOT on `Requires:`, because a permission is a domain fact; and it is not a
 * word scan, which is why a requirement whose prose names a service passes.
 * That last assertion is the one that fails if somebody later "improves" the
 * check into the heuristic loam refuses.
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

/**
 * A capability document. `body` replaces the requirement's body lines, which is
 * where every rule under test is written or omitted.
 */
function capabilityDoc(name: string, body: string): string {
  return `# ${name}

Customers expect this to work. The narrative slot is not decoration: it is
where the analyst says what the capability is for, in words a customer would
recognise.

## Requirements

### Requirement: ${name}
${body}

#### Scenario: It works
- **Given** a customer who wants it
- **When** they ask for it
- **Then** they get it
`;
}

/** The well-formed document — a stable id, and no service-level join. */
const GOOD_DOC = capabilityDoc("Refund a payment", "Requirement-ID: CAP-REFUND-1\nThe fleet SHALL return a customer's money within five days.");

/** A living service spec whose requirement claims `capability`. */
function specWith(capability: string): string {
  return `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Operations: authorizePayment
Capability: ${capability}

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`;
}

/** Findings of one code from a `--json` validate run. */
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

describe("the capabilities/ tree declares capabilities", () => {
  it("a document alone declares the id — no capabilities.yaml anywhere", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": GOOD_DOC,
      "services/payment-service/spec.md": specWith("refunds"),
    });
    expect(p.exists("architecture/capabilities.yaml")).toBe(false);
    expect(await findings(p, "capability.unknown", "--all")).toEqual([]);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);

    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    const rows = JSON.parse(list.stdout).capabilities as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        id: "refunds",
        realizedBy: [{ service: "payment-service", file: "spec.md", requirement: "Authorize a payment" }],
        services: ["payment-service"],
        statuses: { verified: 1 },
        // The document's own requirements ride the same row. Realized by
        // nobody here: the spec claims the capability with `Capability:` and
        // names no individual promise, which is the whole distinction between
        // the two joins.
        requirements: [{ id: "CAP-REFUND-1", name: "Refund a payment", realizedBy: [] }],
      },
    ]);
  });

  it("the tree alone OPTS THE FLEET IN — an undeclared name is an error against it", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": GOOD_DOC,
      "services/payment-service/spec.md": specWith("refnuds"),
    });
    const found = await findings(p, "capability.unknown", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("Did you mean: refunds");
    // The message must offer BOTH homes, since either declaration would fix it.
    expect(found[0]!.message).toContain("architecture/capabilities.yaml");
    expect(found[0]!.message).toContain("capabilities/refnuds/spec.md");
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code).not.toBe(0);
  });

  it("NEITHER file is total silence — the same spec, graded nowhere", async () => {
    const p = await project({
      ...coherentFixture(),
      "services/payment-service/spec.md": specWith("refnuds"),
    });
    for (const code of ["capability.unknown", "capability.unrealized", "capability.doc-missing"]) {
      expect(await findings(p, code, "--all"), code).toEqual([]);
    }
  });

  it("the YAML and the tree are UNIONED, and the YAML keeps the fields the document has no slot for", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": "capabilities:\n  refunds:\n    description: give the money back\n    owner: payments-team\n  chargebacks: {}\n",
      "capabilities/refunds/spec.md": GOOD_DOC,
      "capabilities/disputes/spec.md": capabilityDoc("Raise a dispute", "Requirement-ID: CAP-DISPUTE-1\nThe fleet SHALL let a customer dispute a charge."),
      "services/payment-service/spec.md": specWith("disputes"),
    });
    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    const rows = JSON.parse(list.stdout).capabilities as Array<{ id: string; owner?: string; description?: string }>;
    expect(rows.map((r) => r.id)).toEqual(["chargebacks", "disputes", "refunds"]);
    // Declared on both sides: the YAML's metadata survives, because the
    // document has no field to overwrite it with.
    expect(rows.find((r) => r.id === "refunds")).toMatchObject({
      description: "give the money back",
      owner: "payments-team",
    });
    // Declared only by the tree: no owner, and that is honest — nobody wrote one.
    expect(rows.find((r) => r.id === "disputes")!.owner).toBeUndefined();
  });

  it("capability.unrealized names the side that declared the id", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": "capabilities:\n  chargebacks: {}\n",
      "capabilities/refunds/spec.md": GOOD_DOC,
      "services/payment-service/spec.md": specWith("refunds"),
    });
    const found = await findings(p, "capability.unrealized", "--all");
    expect(found.map((f) => f.subject)).toEqual(["chargebacks"]);
    expect(found[0]!.message).toContain("architecture/capabilities.yaml");
    expect(found[0]!.message).not.toContain("capabilities/chargebacks/spec.md");
  });

  it("a tree-declared capability nothing realizes warns, and names its document", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": GOOD_DOC,
    });
    const found = await findings(p, "capability.unrealized", "--all");
    expect(found.map((f) => f.subject)).toEqual(["refunds"]);
    expect(found[0]!.message).toContain("capabilities/refunds/spec.md");
  });
});

describe("nesting is spelled by the tree", () => {
  it("a nested document declares the slashed id, and its parent may be a capability too", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/payments/spec.md": capabilityDoc("Take a payment", "Requirement-ID: CAP-PAY-1\nThe fleet SHALL take money."),
      "capabilities/payments/refunds/spec.md": GOOD_DOC,
      "services/payment-service/spec.md": specWith("payments/refunds"),
    });
    expect(await findings(p, "capability.unknown", "--all")).toEqual([]);
    expect(await findings(p, "capability.doc-missing", "--all")).toEqual([]);
    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    const rows = JSON.parse(list.stdout).capabilities as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["payments", "payments/refunds"]);
  });

  it("a GROUP directory holding only a nested capability earns no finding", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/payments/refunds/spec.md": GOOD_DOC,
      "services/payment-service/spec.md": specWith("payments/refunds"),
    });
    expect(await findings(p, "capability.doc-missing", "--all")).toEqual([]);
    const list = await runLoam(p.workDir, "list", "capabilities", "--json");
    expect((JSON.parse(list.stdout).capabilities as Array<{ id: string }>).map((r) => r.id)).toEqual([
      "payments/refunds",
    ]);
  });

  it("a directory with neither a document nor a capability beneath it is capability.doc-missing", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": GOOD_DOC,
      "capabilities/chargebacks/.gitkeep": "",
      "services/payment-service/spec.md": specWith("refunds"),
    });
    const found = await findings(p, "capability.doc-missing", "--all");
    expect(found.map((f) => f.subject)).toEqual(["capabilities/chargebacks"]);
    expect(found[0]!.message).toContain("capabilities/chargebacks/spec.md");
    // A warning, so it never gates: a half-created capability is somebody
    // mid-edit, not a broken tree.
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);
    // And it declares nothing, so naming it is still capability.unknown.
    expect(
      (await findings(p, "capability.unknown", "--all")).length +
        (await findings(p, "capability.unrealized", "--all")).filter((f) => f.subject === "chargebacks").length,
    ).toBe(0);
  });
});

describe("a capability document is held to two rules of its own", () => {
  it("a requirement with no Requirement-ID is an ERROR", async () => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": capabilityDoc("Refund a payment", "The fleet SHALL return a customer's money."),
      "services/payment-service/spec.md": specWith("refunds"),
    });
    const found = await findings(p, "capability.requirement-unidentified", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.subject).toBe("refunds");
    expect(found[0]!.message).toContain("capabilities/refunds/spec.md");
    expect(found[0]!.message).toContain("Refund a payment");
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code).not.toBe(0);
  });

  it.each([
    ["Operations:", "Operations: authorizePayment"],
    ["Covers:", "Covers: paymentService"],
    ["Publishes:", "Publishes: PaymentAuthorized"],
    ["Consumes:", "Consumes: OrderPlaced"],
  ])("a %s line is capability.requirement-service-scoped", async (line, written) => {
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": capabilityDoc(
        "Refund a payment",
        `Requirement-ID: CAP-REFUND-1\nThe fleet SHALL return a customer's money.\n\n${written}`,
      ),
      "services/payment-service/spec.md": specWith("refunds"),
    });
    const found = await findings(p, "capability.requirement-service-scoped", "--all");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain(line);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code).not.toBe(0);
  });

  it("Requires: is NOT service-scoped — a permission is a domain fact", async () => {
    const p = await project({
      ...coherentFixture(),
      "architecture/permissions.yaml": "subjects:\n  user: {}\npermissions:\n  user:\n    refund:\n      description: ask for money back\n",
      "capabilities/refunds/spec.md": capabilityDoc(
        "Refund a payment",
        "Requirement-ID: CAP-REFUND-1\nThe fleet SHALL return a customer's money.\n\nRequires: user/refund",
      ),
      "services/payment-service/spec.md": specWith("refunds"),
    });
    expect(await findings(p, "capability.requirement-service-scoped", "--all")).toEqual([]);
  });

  it("naming a service IN PROSE is not checked — the rule is structural, never a word scan", async () => {
    // This is the assertion that fails if the check is ever "improved" into
    // matching declared service ids against the requirement's text. loam
    // refuses that class of heuristic; PR review holds the prose rule.
    const p = await project({
      ...coherentFixture(),
      "capabilities/refunds/spec.md": capabilityDoc(
        "Refund a payment",
        "Requirement-ID: CAP-REFUND-1\nThe fleet SHALL return a customer's money, whatever payment-service does about it.",
      ),
      "services/payment-service/spec.md": specWith("refunds"),
    });
    expect(await findings(p, "capability.requirement-service-scoped", "--all")).toEqual([]);
    const run = await runLoam(p.workDir, "validate", "--all", "--json");
    expect(run.code, run.out).toBe(0);
  });

  it("the tree's own grades survive an unreadable capabilities.yaml", async () => {
    // The suppression behind `capability.invalid` is about grades that RESOLVE
    // against the vocabulary. A directory holding no document, and a
    // requirement with no stable id, are facts about files that a broken YAML
    // does not make untrue.
    const p = await project({
      ...coherentFixture(),
      "architecture/capabilities.yaml": "capabilities: [not, a, mapping]\n",
      "capabilities/refunds/spec.md": capabilityDoc("Refund a payment", "The fleet SHALL return a customer's money."),
      "capabilities/chargebacks/.gitkeep": "",
      "services/payment-service/spec.md": specWith("refunds"),
    });
    expect(await findings(p, "capability.invalid", "--all")).toHaveLength(1);
    expect(await findings(p, "capability.unknown", "--all")).toEqual([]);
    expect(await findings(p, "capability.unrealized", "--all")).toEqual([]);
    expect(await findings(p, "capability.doc-missing", "--all")).toHaveLength(1);
    expect(await findings(p, "capability.requirement-unidentified", "--all")).toHaveLength(1);
  });
});
