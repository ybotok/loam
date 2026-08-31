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
 *
 * The last describe block holds the same three properties as `loam list
 * capabilities` states them, and it is here rather than in a file of its own
 * because they are one claim: the grade and the listing must never give
 * different answers to "is this business promise kept". They used to — the
 * listing carried only the `Realizes:` corpus, so a promise kept by a flow read
 * as realized by nobody while `validate --all` correctly stayed silent — and a
 * suite that graded each surface in its own file is how that drift survived.
 * Where the listing goes further than the grade it is in naming WHICH flow, and
 * in distinguishing "no flow keeps this" (`keptBy: []`) from "nobody could look"
 * (the key ABSENT), which is asserted on the key's presence and not its value.
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

interface RequirementRow {
  id: string;
  name: string;
  realizedBy: unknown[];
  /** Absent — not `[]` — when loam could not read the fleet's flows. */
  keptBy?: string[];
}

interface ListPayload {
  capabilities?: Array<{ id: string; realizedBy: unknown[]; requirements?: RequirementRow[] }>;
  useCases?: { unreadable: boolean; error?: string };
}

/** `loam list capabilities --json` over the same fleet `validated` grades. */
async function listed(
  files: Record<string, string>,
): Promise<{ payload: ListPayload; out: string; p: Project }> {
  const p = await makeProject(fleet(files));
  const res = await runLoam(p.workDir, "list", "capabilities", "--json");
  expect(res.code, res.out).toBe(0);
  return { payload: JSON.parse(res.stdout) as ListPayload, out: res.stdout, p };
}

/** The requirement rows of one capability, or a failure naming what was listed instead. */
function promisesOf(payload: ListPayload, capability: string): RequirementRow[] {
  const row = payload.capabilities?.find((c) => c.id === capability);
  expect(row, `no '${capability}' row in ${JSON.stringify(payload.capabilities)}`).toBeDefined();
  expect(row!.requirements, `'${capability}' carries no requirements`).toBeDefined();
  return row!.requirements!;
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

describe("`loam list capabilities` reports the same kept promises, and names the flow", () => {
  it("a promise kept only by a flow is named with the view id, and validate agrees about the other", async () => {
    // The gap this closes. No service requirement writes `Realizes:` at all, so
    // the whole answer for CHK-ONCE lives in the use-case corpus — and the two
    // rows in one assertion are what stops an implementation that swallowed the
    // second from passing.
    const files = {
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE", "CHK-PRICE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    };
    const { payload, p } = await listed(files);
    try {
      expect(promisesOf(payload, "checkout")).toEqual([
        { id: "CHK-ONCE", name: "Promise CHK-ONCE", realizedBy: [], keptBy: ["uc_checkout"] },
        { id: "CHK-PRICE", name: "Promise CHK-PRICE", realizedBy: [], keptBy: [] },
      ]);
    } finally {
      await p.destroy();
    }
    // The same fleet graded: the promise the listing calls kept is exactly the
    // one `capability.requirement-unrealized` stays silent about. That equality
    // is the point — the two surfaces used to disagree here.
    const graded = await validated(files);
    try {
      expect(findingsOf(graded.out, "capability.requirement-unrealized").map((f) => f.subject)).toEqual([
        "checkout#CHK-PRICE",
      ]);
    } finally {
      await graded.p.destroy();
    }
  });

  it("every flow keeping one promise is named, sorted by id rather than by document", async () => {
    // The files sort a → z and the view ids sort the other way, so a payload
    // ordered by the staging order of `architecture/` comes back reversed.
    const files = {
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/a-flow.likec4": usecase("uc_zulu", ["cap-checkout", "req-CHK-ONCE"]),
      "architecture/usecases/z-flow.likec4": usecase("uc_alpha", ["cap-checkout", "req-CHK-ONCE"]),
    };
    const { payload, out, p } = await listed(files);
    try {
      expect(promisesOf(payload, "checkout")[0]!.keptBy).toEqual(["uc_alpha", "uc_zulu"]);
      // And nothing in the payload depends on a Map's iteration order: a second
      // run over the same fleet is the same bytes.
      const again = await runLoam(p.workDir, "list", "capabilities", "--json");
      expect(again.stdout).toBe(out);
    } finally {
      await p.destroy();
    }
  });

  it("the two corpora are reported side by side — a promise carrying both shows both", async () => {
    const { payload, p } = await listed({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE", "CHK-PRICE"]),
      "services/payment-service/spec.md": `---
service: payment-service
status: verified
---

# payment-service

## Requirements

### Requirement: Authorize a payment
The service SHALL authorize a payment before capture.

Realizes: checkout#CHK-ONCE

#### Scenario: Successful authorization
- **Given** a valid card
- **When** authorization is requested
- **Then** the payment is authorized
`,
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    });
    try {
      const rows = promisesOf(payload, "checkout");
      // Two independent pieces of evidence for one promise, stated side by side
      // rather than collapsed into a verdict: a reader judging whether it really
      // is kept needs to know which of the two is doing the work.
      expect(rows[0]!.realizedBy).toEqual([
        { service: "payment-service", file: "spec.md", requirement: "Authorize a payment" },
      ]);
      expect(rows[0]!.keptBy).toEqual(["uc_checkout"]);
      expect(rows[1]!.keptBy).toEqual([]);
    } finally {
      await p.destroy();
    }
  });

  it("a typo'd #req- tag leaves the real promise unkept in the listing too", async () => {
    const { payload, p } = await listed({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE", "CHK-PRICE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONC"]),
    });
    try {
      // A claim that guessed at the nearest id would silence the warning over a
      // mistake AND print a flow beside a promise that flow does not keep.
      expect(promisesOf(payload, "checkout").map((r) => r.keptBy)).toEqual([[], []]);
    } finally {
      await p.destroy();
    }
  });

  it("two requirement ids behind one slug keep neither, and two capabilities behind one slug keep nothing", async () => {
    // Both `many` arms, which are the only shapes where a guess would land on a
    // REAL promise: picking one of `CHK.ONCE` / `CHK-ONCE`, or one of
    // `identity/tokens` / `identity-tokens`, reports the wrong promise as kept.
    const ambiguousRequirement = await listed({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK.ONCE", "CHK-ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    });
    try {
      expect(promisesOf(ambiguousRequirement.payload, "checkout").map((r) => [r.id, r.keptBy])).toEqual([
        ["CHK-ONCE", []],
        ["CHK.ONCE", []],
      ]);
    } finally {
      await ambiguousRequirement.p.destroy();
    }

    const ambiguousCapability = await listed({
      "capabilities/identity/tokens/spec.md": capabilityDoc(["CHK-ONCE"]),
      "capabilities/identity-tokens/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/tokens.likec4": usecase("uc_tokens", ["cap-identity-tokens", "req-CHK-ONCE"]),
    });
    try {
      for (const id of ["identity/tokens", "identity-tokens"]) {
        expect(promisesOf(ambiguousCapability.payload, id).map((r) => r.keptBy), id).toEqual([[]]);
      }
    } finally {
      await ambiguousCapability.p.destroy();
    }
  });

  it("an architecture/ nobody could read omits keptBy entirely rather than answering '[]'", async () => {
    const files = {
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE", "CHK-PRICE"]),
      // Mentions the reserved prefix, so the cheap byte gate cannot short-circuit
      // and the project load is what fails.
      "architecture/usecases/checkout.likec4": `views {\n  dynamic view uc_checkout {\n    #cap-checkout\n    this is not likec4\n`,
    };
    const { payload, p } = await listed(files);
    try {
      for (const row of promisesOf(payload, "checkout")) {
        // `in`, not a value compare: `[]` here would be the vacuously-green
        // claim that no flow keeps the promise, made over flows nobody read.
        expect("keptBy" in row, `${row.id} answered "kept by no flow" over an unreadable project`).toBe(false);
      }
      expect(payload.useCases?.unreadable).toBe(true);
      expect(payload.useCases?.error).toBeTruthy();
      // It DEGRADES rather than refusing: the rows come from capabilities.yaml
      // and the capabilities/ tree, both perfectly readable. Taking the listing
      // away while somebody fixes a use-case document would be the wrong trade —
      // `validate` already reports that document as landscape.invalid.
      expect(payload.capabilities?.some((c) => c.id === "checkout")).toBe(true);
      const text = await runLoam(p.workDir, "list", "capabilities");
      expect(text.code, text.out).toBe(0);
      expect(text.stdout).toContain("UNKNOWN here, not none");
      expect(text.stdout).toContain("(flows unread)");
    } finally {
      await p.destroy();
    }
  });

  it("a broken document that never mentions the prefix stays READ — the cheap gate is sound, not a guess", async () => {
    // A use case is a view carrying `#cap-<slug>` and LikeC4 refuses an
    // undeclared tag, so a document set without those bytes declares no use case
    // however badly it parses: `views: []` is the true answer and no LikeC4
    // workspace is started. Its own landscape, because the shared one DECLARES
    // the tags and so contains the prefix itself — the gate scans every
    // `architecture/` document, not only the views.
    const p = await makeProject({
      "architecture/landscape.likec4":
        `specification {\n  element service\n}\n\nmodel {\n  web = service 'checkout-web' {\n    metadata { service 'checkout-web' }\n  }\n}\n`,
      "services/checkout-web/spec.md": spec("checkout-web"),
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/junk.likec4": "views {\n  dynamic view uc_junk {\n    this is not likec4\n",
    });
    try {
      const res = await runLoam(p.workDir, "list", "capabilities", "--json");
      expect(res.code, res.out).toBe(0);
      const payload = JSON.parse(res.stdout) as ListPayload;
      expect(payload.useCases).toEqual({ unreadable: false });
      expect(promisesOf(payload, "checkout").map((r) => r.keptBy)).toEqual([[]]);
    } finally {
      await p.destroy();
    }
  });

  it("a fleet whose only reserved mention is `req-` is READ — the gate takes both prefixes", async () => {
    // The mirror of the case above, and the one that made the reader-side
    // widening worth anything. `#req-<slug>` is a reserved prefix in its own
    // right, so a fleet whose only flow carries one declares `tag req-…` and
    // writes `cap-` NOWHERE — and a `cap-`-only byte scan short-circuited before
    // any predicate ran. `list capabilities` then answered `keptBy: []` for every
    // promise off an `architecture/` nobody had opened, which is the vacuously
    // green claim this whole axis exists to refuse.
    //
    // The use-case document is UNPARSEABLE on purpose: `unreadable: true` is
    // reachable only if the gate opened on `req-` alone, so this measures the
    // scan rather than asserting it.
    const p = await makeProject({
      "architecture/landscape.likec4":
        `specification {\n  element service\n  tag req-CHK-ONCE\n}\n\nmodel {\n  web = service 'checkout-web' {\n    metadata { service 'checkout-web' }\n  }\n}\n`,
      "services/checkout-web/spec.md": spec("checkout-web"),
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/junk.likec4":
        "views {\n  dynamic view uc_junk {\n    #req-CHK-ONCE\n    this is not likec4\n",
    });
    try {
      const res = await runLoam(p.workDir, "list", "capabilities", "--json");
      expect(res.code, res.out).toBe(0);
      const payload = JSON.parse(res.stdout) as ListPayload;
      expect(payload.useCases?.unreadable).toBe(true);
      expect(payload.useCases?.error).toBeTruthy();
      for (const row of promisesOf(payload, "checkout")) {
        // `in` again, and for the same reason: `[]` here would be "no flow keeps
        // this promise", stated about flows the gate refused to look at.
        expect("keptBy" in row, `${row.id} answered over an architecture/ the gate skipped`).toBe(false);
      }
    } finally {
      await p.destroy();
    }
  });

  it("plain `loam list --json` carries neither key — the frozen default payload is unchanged", async () => {
    const p = await makeProject(
      fleet({
        "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
        "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
      }),
    );
    try {
      const res = await runLoam(p.workDir, "list", "--json");
      expect(res.code, res.out).toBe(0);
      const payload = JSON.parse(res.stdout) as Record<string, unknown>;
      expect("capabilities" in payload).toBe(false);
      expect("useCases" in payload).toBe(false);
    } finally {
      await p.destroy();
    }
  });
});

describe("a capability kept only by flows is not reported as realized by nobody", () => {
  it("capability.unrealized counts the flow corpus, not just the service one", async () => {
    // The contradiction this closes: NO service requirement names `checkout` by
    // `Capability:` or `Realizes:`, and a flow keeps its only promise. Counting
    // the service corpus alone told such a fleet "a promise nobody implemented
    // or a word nobody adopted" while loam's own report two lines down said the
    // promise was kept. A capability whose criteria all cross services is
    // exactly the shape that has no service-side realizer to find.
    const { out, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/checkout.likec4": usecase("uc_checkout", ["cap-checkout", "req-CHK-ONCE"]),
    });
    try {
      expect(findingsOf(out, "capability.requirement-unrealized")).toEqual([]);
      const unrealized = findingsOf(out, "capability.unrealized").map((f) => f.subject);
      expect(unrealized).not.toContain("checkout");
      // The other two declared ids ARE unrealized, so the code is still live —
      // an assertion that only checked `checkout` would pass against a mutation
      // that silenced the whole grade.
      expect(unrealized).toEqual(["identity/tokens", "shipping"]);
    } finally {
      await p.destroy();
    }
  });

  it("but a capability whose flows loam could not read still reports, rather than going silent", async () => {
    // Asymmetric with capability.requirement-unrealized ON PURPOSE, and the
    // asymmetry is what keeps a fleet with a vocabulary and no readable map
    // from losing the grade entirely: a capability has independent primary
    // evidence in the `Capability:`/`Realizes:` lines, so unreadable flows
    // leave it answering from less rather than from nothing.
    const { out, p } = await validated({
      "capabilities/checkout/spec.md": capabilityDoc(["CHK-ONCE"]),
      "architecture/usecases/broken.likec4": "views {\n  dynamic view uc_broken {\n    this is not likec4\n",
    });
    try {
      expect(findingsOf(out, "landscape.invalid")).toHaveLength(1);
      // Suspended, because a cross-service promise may have no other realizer.
      expect(findingsOf(out, "capability.requirement-unrealized")).toEqual([]);
      // NOT suspended — the service corpus was perfectly readable and says nothing names it.
      expect(findingsOf(out, "capability.unrealized").map((f) => f.subject)).toContain("checkout");
    } finally {
      await p.destroy();
    }
  });
});
