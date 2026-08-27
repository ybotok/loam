/**
 * `#req-<slug>` — a use case claiming one of a capability's named promises,
 * end to end through `loam validate --all`.
 *
 * This is the join the business axis was built for and the one `Realizes:`
 * cannot make. A criterion that crosses services — "I enter a login and a
 * password and I am in" — belongs to no single service's spec, because each
 * promises only its own part; a flow can carry it, because it IS the hop
 * sequence. So the assertions that matter here are the ones about what the
 * claim DOES, not merely about what it parses to:
 *
 * A RESOLVED CLAIM KEEPS THE PROMISE. `capability.requirement-unrealized` must
 * fall silent for a requirement a flow claims, or the axis contradicts itself —
 * the fleet would be told nobody realizes a promise it demonstrably keeps.
 *
 * A BROKEN CLAIM KEEPS NOTHING. The same warning must go on firing beside
 * `usecase.requirement-unresolved`, because a typo that silenced it would turn
 * a mistake into a green fleet. That pair of assertions is the whole safety
 * property, and each fails against the opposite wrong implementation.
 *
 * AND A RUN THAT CANNOT SEE THE FLOWS MUST NOT JUDGE THEM. An `architecture/`
 * that does not parse suspends the unrealized warning entirely: loam did not
 * look, which is never the same answer as "there is nothing there".
 */
import { describe, expect, it } from "vitest";
import { makeProject, runLoam, type Project } from "./helpers/harness.js";

interface JsonFinding {
  severity: string;
  code: string;
  subject?: string;
  message: string;
}

function findingsOf(stdout: string, code: string): JsonFinding[] {
  const payload = JSON.parse(stdout) as { targets: Array<{ findings: JsonFinding[] }> };
  return payload.targets.flatMap((t) => t.findings).filter((f) => f.code === code);
}

/**
 * The fleet map. Every tag any case below writes is declared here, because
 * LikeC4 refuses an undeclared tag and one `specification` block serves the
 * whole `architecture/` project.
 */
const LANDSCAPE = `specification {
  element service
  tag cap-checkout
  tag cap-identity-tokens
  tag cap-shipping
  tag cap-empty
  tag req-CHK-ONCE
  tag req-CHK-PRICE
  tag req-CHK-ONC
  tag req-SHIP-1
}

model {
  web = service 'checkout-web' {
    metadata { service 'checkout-web' }
  }
  payments = service 'payment-service' {
    metadata { service 'payment-service' }
  }

  web -> payments 'Calls authorizePayment' {
    metadata { op 'authorizePayment' }
  }
}
`;

const CAPABILITIES = `capabilities:
  checkout: {}
  identity/tokens: {}
  shipping: {}
`;

/** A capability document declaring the given `Requirement-ID`s. */
function capabilityDoc(ids: string[]): string {
  return `# A capability

What a customer expects.

## Requirements
${ids
  .map(
    (id) => `
### Requirement: Promise ${id}
Requirement-ID: ${id}
The fleet SHALL keep promise ${id}.

#### Scenario: It is kept
- **Given** a customer
- **When** they ask
- **Then** it is kept
`,
  )
  .join("")}`;
}

function spec(service: string): string {
  return `---\nservice: ${service}\n---\n\n# ${service}\n`;
}

/** A `views { }` file holding one dynamic view carrying `tags`, in order. */
function usecase(id: string, tags: string[]): string {
  const carried = tags.map((t) => `    #${t}\n`).join("");
  return `views {\n  dynamic view ${id} {\n${carried}    web -> payments 'authorizes the payment'\n  }\n}\n`;
}

function fleet(files: Record<string, string>): Record<string, string> {
  return {
    "architecture/landscape.likec4": LANDSCAPE,
    "architecture/capabilities.yaml": CAPABILITIES,
    "services/checkout-web/spec.md": spec("checkout-web"),
    "services/payment-service/spec.md": spec("payment-service"),
    ...files,
  };
}

async function validated(files: Record<string, string>): Promise<{ out: string; code: number; p: Project }> {
  const p = await makeProject(fleet(files));
  const res = await runLoam(p.workDir, "validate", "--all", "--json");
  return { out: res.stdout, code: res.code, p };
}

describe("a use case can keep a business promise", () => {
  it("a resolved #cap- + #req- pair silences capability.requirement-unrealized for that promise", async () => {
    const { out, code, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE", "CHK-PRICE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    });
    try {
      expect(findingsOf(out, "usecase.requirement-unresolved")).toEqual([]);
      // CHK-ONCE is kept by the flow; CHK-PRICE is kept by nobody. Both facts
      // in one assertion — a suppression that swallowed the second would pass a
      // test that only checked the first.
      expect(findingsOf(out, "capability.requirement-unrealized").map((f) => f.subject)).toEqual([
        "checkout#CHK-PRICE",
      ]);
      // A warning, so it never gates. The exit code itself is not asserted:
      // these fixtures carry no model.likec4, which is its own error.
      expect(findingsOf(out, "capability.requirement-unrealized")[0]!.severity).toBe("warn");
      void code;
    } finally {
      await p.destroy();
    }
  });

  it("two #req- tags on one view keep two promises", async () => {
    const { out, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE", "CHK-PRICE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", [
        "cap-checkout",
        "req-CHK-ONCE",
        "req-CHK-PRICE",
      ]),
    });
    try {
      expect(findingsOf(out, "usecase.requirement-unresolved")).toEqual([]);
      expect(findingsOf(out, "capability.requirement-unrealized")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a BROKEN #req- tag keeps nothing — the unrealized warning fires beside the error", async () => {
    // The safety property. A typo that silenced the warning would turn a
    // mistake into a green fleet, so only a RESOLVED claim may count.
    const { out, code, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONC"]),
    });
    try {
      expect(findingsOf(out, "usecase.requirement-unresolved")).toHaveLength(1);
      expect(findingsOf(out, "capability.requirement-unrealized").map((f) => f.subject)).toEqual([
        "checkout#CHK-ONCE",
      ]);
      expect(code).not.toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("suspends the unrealized warning entirely when architecture/ does not parse", async () => {
    // loam did not look, which is never the same answer as "there is nothing
    // there" — and a use case is one of the two things that could have kept it.
    const { out, code, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/broken.likec4": "views {\n  dynamic view uc_broken {\n    this is not likec4\n",
    });
    try {
      expect(findingsOf(out, "landscape.invalid")).toHaveLength(1);
      expect(findingsOf(out, "capability.requirement-unrealized")).toEqual([]);
      expect(code).not.toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("grades no #req- tag at all when the fleet declares no capability vocabulary", async () => {
    const p = await makeProject({
      "architecture/landscape.likec4": LANDSCAPE,
      "services/checkout-web/spec.md": spec("checkout-web"),
      "services/payment-service/spec.md": spec("payment-service"),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    });
    try {
      const res = await runLoam(p.workDir, "validate", "--all", "--json");
      expect(findingsOf(res.stdout, "usecase.requirement-unresolved")).toEqual([]);
      expect(findingsOf(res.stdout, "usecase.capability-unresolved")).toEqual([]);
    } finally {
      await p.destroy();
    }
  });
});

describe("usecase.requirement-unresolved names WHICH of the six failures happened", () => {
  it("a #req- tag with no resolved capability has no scope", async () => {
    const { out, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["req-CHK-ONCE"]),
    });
    try {
      // No `#cap-` tag at all, so the view is not even a graded use case — but
      // the `#req-` tag still has to be answered, because a view that asked to
      // be graded must not be silently ungraded.
      const found = findingsOf(out, "usecase.requirement-unresolved");
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("no `#cap-` tag that resolves");
      expect(found[0]!.message).toContain("unique only inside its own document");
    } finally {
      await p.destroy();
    }
  });

  it("a #req- tag under TWO resolved capabilities is ambiguous", async () => {
    const { out, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "capabilities/identity/tokens/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", [
        "cap-checkout",
        "cap-identity-tokens",
        "req-CHK-ONCE",
      ]),
    });
    try {
      const found = findingsOf(out, "usecase.requirement-unresolved");
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("resolves 2 capabilities (checkout, identity/tokens)");
      expect(found[0]!.message).toContain("split the flow");
    } finally {
      await p.destroy();
    }
  });

  it("a capability declared with no document has no promises to keep", async () => {
    const { out, p } = await validated({
      "architecture/usecases/ship.likec4": usecase("uc_ship", ["cap-shipping", "req-SHIP-1"]),
    });
    try {
      const found = findingsOf(out, "usecase.requirement-unresolved");
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("has no capabilities/shipping/spec.md");
      expect(found[0]!.message).toContain("only a document has promises a flow can keep");
    } finally {
      await p.destroy();
    }
  });

  it("a document declaring no requirements yet", async () => {
    const { out, p } = await validated({
      "capabilities/shipping/spec.md": "# Shipping\n\nNothing written yet.\n",
      "architecture/usecases/ship.likec4": usecase("uc_ship", ["cap-shipping", "req-SHIP-1"]),
    });
    try {
      const found = findingsOf(out, "usecase.requirement-unresolved");
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("declares no requirements yet");
    } finally {
      await p.destroy();
    }
  });

  it("an id the document does not declare, with close names spelled as TAGS", async () => {
    const { out, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONC"]),
    });
    try {
      const found = findingsOf(out, "usecase.requirement-unresolved");
      expect(found).toHaveLength(1);
      // Both spellings: the id is what the document holds, the tag is what the
      // view must carry, and an author handed only one writes the other wrong.
      expect(found[0]!.message).toContain("Did you mean: CHK-ONCE (#req-CHK-ONCE)?");
    } finally {
      await p.destroy();
    }
  });

  it("two requirement ids flattening to ONE slug are refused, never guessed", async () => {
    // The lossy slug, one join deeper than the capability tag's own `many` arm:
    // `CHK.ONCE` and `CHK-ONCE` are distinct legal ids that a tag cannot tell
    // apart, and guessing would report the wrong promise as kept.
    const { out, code, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK.ONCE", "CHK-ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    });
    try {
      const found = findingsOf(out, "usecase.requirement-unresolved");
      expect(found).toHaveLength(1);
      expect(found[0]!.message).toContain("2 requirements of 'checkout' flatten to 'CHK-ONCE' (CHK-ONCE, CHK.ONCE)");
      expect(code).not.toBe(0);
    } finally {
      await p.destroy();
    }
  });

  it("a DOT in a Requirement-ID is reachable through the flattened tag", async () => {
    // The measurement this design rests on: a tag name accepts no `.`, and
    // `REQUIREMENT_ID_RE` allows one. Flattening is what keeps such an id
    // claimable at all — and it resolves as long as nothing collides with it.
    const { out, code, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK.ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    });
    try {
      expect(findingsOf(out, "usecase.requirement-unresolved")).toEqual([]);
      expect(findingsOf(out, "capability.requirement-unrealized")).toEqual([]);
      void code;
    } finally {
      await p.destroy();
    }
  });
});
